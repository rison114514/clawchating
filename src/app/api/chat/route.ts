import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  appendGroupTimelineMessage,
  appendSessionMessage,
  ensureAgentSession,
  initializeGroupSessions,
  resolvePeerId,
  toSemanticInput,
} from '@/lib/session-runtime';

export const maxDuration = 600;

type AgentCapabilities = {
  read: boolean;
  write: boolean;
  exec: boolean;
  invite: boolean;
  skills: boolean;
};

type OpenClawAgent = {
  id: string;
  name?: string;
  workspace?: string;
  timeoutSeconds?: number;
  model?: string | { primary?: string };
  tools?: {
    alsoAllow?: string[];
  };
};

type OpenClawConfig = {
  commands?: {
    nativeSkills?: 'on' | 'off' | 'auto' | string;
  };
  agents?: {
    defaults?: {
      workspace?: string;
      timeoutSeconds?: number;
    };
    list?: OpenClawAgent[];
  };
  gateway?: {
    auth?: {
      token?: string;
    };
  };
};

type GroupRecord = {
  id: string;
  members: string[];
};

type OpenClawSkill = {
  name: string;
  description?: string;
  eligible?: boolean;
  filePath?: string;
};

type TurnType = 'group' | 'direct';

type ChatRouteError = Error & {
  status?: number;
  timelineNotified?: boolean;
  failureMeta?: Record<string, unknown>;
};

const execFileAsync = promisify(execFile);
const MAX_RELAY_DEPTH = 2;
const MAX_RELAY_TARGETS = 8;
const CHAT_TRACE_ENABLED = /^(1|true|yes)$/i.test(process.env.CLAWCHATING_CHAT_TRACE || '');

type GroupQueueState = {
  tail: Promise<void>;
  pending: number;
  nextSeq: number;
};

const GROUP_QUEUE_STORE_KEY = '__clawchatingGroupMessageQueueStore__';

function getGroupQueueStore() {
  const globalAny = globalThis as typeof globalThis & {
    [GROUP_QUEUE_STORE_KEY]?: Map<string, GroupQueueState>;
  };

  if (!globalAny[GROUP_QUEUE_STORE_KEY]) {
    globalAny[GROUP_QUEUE_STORE_KEY] = new Map<string, GroupQueueState>();
  }
  return globalAny[GROUP_QUEUE_STORE_KEY]!;
}

function buildGroupQueueKey(groupId: string, channelId: string | undefined) {
  return `${groupId}::${channelId || 'default'}`;
}

async function enqueueGroupTask<T>(
  queueKey: string,
  task: (ctx: { queueSeq: number; queuedAhead: number }) => Promise<T>
) {
  const store = getGroupQueueStore();
  let state = store.get(queueKey);
  if (!state) {
    state = {
      tail: Promise.resolve(),
      pending: 0,
      nextSeq: 1,
    };
    store.set(queueKey, state);
  }

  const queuedAhead = state.pending;
  const queueSeq = state.nextSeq;
  state.nextSeq += 1;
  state.pending += 1;

  const run = state.tail.then(async () => task({ queueSeq, queuedAhead }));
  state.tail = run.then(() => undefined, () => undefined);

  try {
    return await run;
  } finally {
    const latest = store.get(queueKey);
    if (latest) {
      latest.pending = Math.max(0, latest.pending - 1);
      if (latest.pending === 0) {
        store.delete(queueKey);
      }
    }
  }
}

const DEFAULT_CAPABILITIES: AgentCapabilities = { read: true, write: true, exec: false, invite: false, skills: true };

function getCapabilitiesFromOpenClawTools(agentConfig: OpenClawAgent | undefined, openClawConfig?: OpenClawConfig): AgentCapabilities {
  const alsoAllow: string[] = agentConfig?.tools?.alsoAllow || [];
  const globalNativeSkills = openClawConfig?.commands?.nativeSkills;
  const globalSkillsEnabled = globalNativeSkills !== 'off';
  return {
    read: alsoAllow.includes('read'),
    write: alsoAllow.includes('write') || alsoAllow.includes('edit') || alsoAllow.includes('apply_patch'),
    exec: alsoAllow.includes('exec') || alsoAllow.includes('process'),
    invite: alsoAllow.includes('subagents') || alsoAllow.includes('agents_list'),
    skills: alsoAllow.includes('skills') || globalSkillsEnabled,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function makeTraceId(incoming: unknown) {
  const text = typeof incoming === 'string' ? incoming.trim() : '';
  if (text) return text;
  return `chat_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function traceLog(traceId: string, event: string, payload: Record<string, unknown>) {
  if (!CHAT_TRACE_ENABLED) return;
  console.info('[chat_trace]', {
    traceId,
    event,
    ...payload,
  });
}

function pickString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function extractOpenClawSessionInfo(data: Record<string, unknown>) {
  const result = data.result && typeof data.result === 'object'
    ? (data.result as Record<string, unknown>)
    : {};
  return {
    dataSessionId: pickString(data, 'sessionId'),
    dataSessionKey: pickString(data, 'sessionKey'),
    resultSessionId: pickString(result, 'sessionId'),
    resultSessionKey: pickString(result, 'sessionKey'),
    resultId: pickString(result, 'id'),
  };
}

function summarizeSessionDiagnostics(data: Record<string, unknown>, requestedSessionKey: string) {
  const extracted = extractOpenClawSessionInfo(data);
  const returnedSessionKey = extracted.dataSessionKey || extracted.resultSessionKey || null;
  const returnedSessionId = extracted.dataSessionId || extracted.resultSessionId || extracted.resultId || null;
  return {
    requestedSessionKey,
    returnedSessionKey,
    returnedSessionId,
    raw: extracted,
  };
}

function extractSessionInfoFromResponseText(text: string) {
  const jsonText = tryExtractJsonObject(text);
  if (!jsonText) {
    return {
      sessionKey: null as string | null,
      sessionId: null as string | null,
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const result = parsed.result && typeof parsed.result === 'object'
      ? (parsed.result as Record<string, unknown>)
      : {};
    const meta = result.meta && typeof result.meta === 'object'
      ? (result.meta as Record<string, unknown>)
      : {};
    const systemPromptReport = meta.systemPromptReport && typeof meta.systemPromptReport === 'object'
      ? (meta.systemPromptReport as Record<string, unknown>)
      : {};

    return {
      sessionKey: pickString(systemPromptReport, 'sessionKey') || null,
      sessionId: pickString(systemPromptReport, 'sessionId') || null,
    };
  } catch {
    return {
      sessionKey: null as string | null,
      sessionId: null as string | null,
    };
  }
}

function makeChatRouteError(message: string, options?: {
  status?: number;
  timelineNotified?: boolean;
  failureMeta?: Record<string, unknown>;
}) {
  const error = new Error(message) as ChatRouteError;
  if (options?.status) error.status = options.status;
  if (options?.timelineNotified) error.timelineNotified = true;
  if (options?.failureMeta) error.failureMeta = options.failureMeta;
  return error;
}

function detectSessionDrift(params: {
  turnType: TurnType;
  requestedSessionKey: string;
  returnedSessionKey: string | null;
}) {
  if (params.turnType !== 'group') return null;
  const returned = params.returnedSessionKey;
  if (!returned) return null;
  if (returned.includes(':main')) return 'returned_main_session';
  if (returned !== params.requestedSessionKey) return 'returned_session_mismatch';
  return null;
}

function extractTextFromMessageContent(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function loadLatestAssistantFromMainSession(agentId: string, lookbackSeconds = 7200) {
  try {
    const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions');
    const storePath = path.join(sessionsDir, 'sessions.json');
    const rawStore = await fs.readFile(storePath, 'utf-8');
    const store = JSON.parse(rawStore) as Record<string, { sessionId?: string }>;

    const mainKeys = [`agent:${agentId}:main`, 'main', `agent:${agentId}:default`];
    const foundKey = mainKeys.find((key) => !!store[key]?.sessionId);
    const sessionId = foundKey ? store[foundKey]?.sessionId : undefined;
    if (!sessionId) return null;

    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
    const rawFile = await fs.readFile(sessionFile, 'utf-8');
    const threshold = Date.now() - Math.max(60, lookbackSeconds) * 1000;

    const lines = rawFile
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const candidates = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => !!item)
      .filter((item) => item.type === 'message')
      .map((item) => {
        const message = item.message && typeof item.message === 'object'
          ? (item.message as Record<string, unknown>)
          : {};
        const text = extractTextFromMessageContent(message.content);
        const timestamp = Number(message.timestamp || item.timestamp || 0);
        const role = typeof message.role === 'string' ? message.role : '';
        return {
          text,
          timestamp,
          role,
          name: typeof message.name === 'string' ? message.name : undefined,
        };
      })
      .filter((item) => item.role === 'assistant' && item.timestamp >= threshold && item.text.trim())
      .sort((a, b) => b.timestamp - a.timestamp);

    if (candidates.length === 0) return null;
    const latest = candidates[0];
    return {
      sessionKey: foundKey || null,
      sessionId,
      content: latest.text,
      timestamp: latest.timestamp,
      name: latest.name,
    };
  } catch {
    return null;
  }
}

function isSessionLockError(error: unknown) {
  const message = getErrorMessage(error);
  return /session file locked|\.lock|timeout 10000ms/i.test(message);
}

function resolveTimeoutSeconds(openClawConfig?: OpenClawConfig) {
  const configured = Number(openClawConfig?.agents?.defaults?.timeoutSeconds);
  if (!Number.isFinite(configured)) return 600;
  const safe = Math.floor(configured);
  return Math.min(600, Math.max(60, safe));
}

function parseTimeoutSeconds(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const safe = Math.floor(raw);
  if (safe < 60) return 60;
  if (safe > 900) return 900;
  return safe;
}

function resolveTurnTimeoutSeconds(params: {
  baseTimeoutSeconds: number;
  targetAgentId: string;
  targetAgentConfig?: OpenClawAgent;
  relayDepth: number;
  requestedTimeoutSeconds?: number | null;
}) {
  const { baseTimeoutSeconds, targetAgentId, targetAgentConfig, relayDepth, requestedTimeoutSeconds } = params;

  const envGlobal = parseTimeoutSeconds(process.env.CLAWCHATING_CHAT_TIMEOUT_SECONDS);
  const envLeader = targetAgentId === 'leader'
    ? parseTimeoutSeconds(process.env.CLAWCHATING_LEADER_TIMEOUT_SECONDS)
    : null;
  const agentTimeout = parseTimeoutSeconds(targetAgentConfig?.timeoutSeconds);

  let resolved = requestedTimeoutSeconds || envGlobal || baseTimeoutSeconds;
  if (!requestedTimeoutSeconds) {
    if (agentTimeout) {
      resolved = agentTimeout;
    }
    if (envLeader) {
      resolved = envLeader;
    }
  }

  if (relayDepth > 0) {
    resolved = Math.min(resolved, 600);
  }

  return parseTimeoutSeconds(resolved) || baseTimeoutSeconds;
}

function tryExtractJsonObject(text: string) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

async function runOpenClawJson(args: string[], timeoutMs = 15000) {
  const { stdout, stderr } = await execFileAsync('openclaw', args, {
    cwd: process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  const payload = tryExtractJsonObject(stdout) || tryExtractJsonObject(stderr);
  if (!payload) {
    throw new Error('Failed to parse OpenClaw JSON output.');
  }
  return JSON.parse(payload) as Record<string, unknown>;
}

async function runOpenClawAgentWithRetry(params: {
  agentId: string;
  sessionKey: string;
  routingChannel: string;
  routingTo: string;
  message: string;
  timeoutSeconds: number;
  traceId: string;
  relayDepth: number;
}) {
  const { agentId, sessionKey, routingChannel, routingTo, message, timeoutSeconds, traceId, relayDepth } = params;
  const timeoutMs = timeoutSeconds * 1000 + 5000;

  traceLog(traceId, 'openclaw_call_start', {
    agentId,
    requestedSessionKey: sessionKey,
    routingChannel,
    routingTo,
    timeoutSeconds,
    relayDepth,
  });

  const buildArgs = (toValue: string) => [
    'agent',
    '--agent',
    agentId,
    '--channel',
    routingChannel,
    '--to',
    toValue,
    '--message',
    message,
    '--json',
    '--timeout',
    String(timeoutSeconds),
  ];

  try {
    return await runOpenClawJson(buildArgs(routingTo), timeoutMs);
  } catch (error) {
    if (!isSessionLockError(error)) throw error;

    const retryRoutingTo = `${routingTo}:retry:${Date.now()}`;
    traceLog(traceId, 'openclaw_call_retry', {
      agentId,
      originalSessionKey: sessionKey,
      originalRoutingTo: routingTo,
      retryRoutingTo,
      reason: getErrorMessage(error),
      relayDepth,
    });

    return await runOpenClawJson(buildArgs(retryRoutingTo), timeoutMs);
  }
}

async function listEligibleSkills() {
  try {
    const data = await runOpenClawJson(['skills', 'list', '--eligible', '--json'], 20000);
    const list = Array.isArray(data.skills) ? data.skills : [];
    return list
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          name: typeof record.name === 'string' ? record.name : '',
          description: typeof record.description === 'string' ? record.description : '',
          eligible: !!record.eligible,
          filePath: typeof record.filePath === 'string' ? record.filePath : undefined,
        } as OpenClawSkill;
      })
      .filter((item) => item.name);
  } catch {
    return [] as OpenClawSkill[];
  }
}


async function getOpenClawConfig() {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as OpenClawConfig;
    return config;
  } catch {
    return {} as OpenClawConfig;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionAliasMap(
  groupMembers: string[],
  agentMap: Map<string, OpenClawAgent>
) {
  const aliasToAgentId = new Map<string, string>();
  for (const memberId of groupMembers) {
    const normalizedId = String(memberId || '').trim();
    if (!normalizedId) continue;
    aliasToAgentId.set(normalizedId.toLowerCase(), normalizedId);
    const displayName = String(agentMap.get(normalizedId)?.name || '').trim();
    if (displayName) {
      aliasToAgentId.set(displayName.toLowerCase(), normalizedId);
    }
  }
  return aliasToAgentId;
}

function extractMentionTargets(text: string, aliasToAgentId: Map<string, string>) {
  const targets = new Set<string>();

  for (const match of text.matchAll(/@([a-zA-Z0-9_-]+)/g)) {
    const alias = (match[1] || '').toLowerCase();
    const target = aliasToAgentId.get(alias);
    if (target) targets.add(target);
  }

  const aliases = Array.from(aliasToAgentId.keys()).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (!alias) continue;
    const pattern = new RegExp(`@${escapeRegExp(alias)}(?=\\s|$|[，。,.!?！？:：;；])`, 'gi');
    if (!pattern.test(text)) continue;
    const target = aliasToAgentId.get(alias);
    if (target) targets.add(target);
  }

  return Array.from(targets);
}

function buildGroupMembersPromptSection(groupMembers: string[], agentMap: Map<string, OpenClawAgent>) {
  const rows = groupMembers.map((memberId) => {
    const displayName = (agentMap.get(memberId)?.name || '').trim();
    const aliases = displayName && displayName !== memberId
      ? `${memberId}, ${displayName}`
      : memberId;
    return `- agentId=${memberId}; aliases=${aliases}`;
  });

  return [
    '[GroupMembersFromSystem]',
    '成员列表由系统直接提供，不要查询飞书或任何外部通讯录。',
    rows.join('\n') || '- none',
  ].join('\n');
}

function buildGroupCollaborationRulesSection() {
  return [
    '[GroupCollaborationProtocol]',
    '在群组模式下，若你要呼叫其他成员，直接在回复文本里写 @agentId 或 @显示名 即可。',
    '系统会自动解析并路由给对应成员，你不需要调用额外的消息发送工具。',
    '禁止声称“无法发送消息”“@mention失败”或“权限不足导致无法呼叫”。',
    '若要呼叫，请直接给出简洁明确的协作指令。',
  ].join('\n');
}

export async function POST(req: Request) {
  let traceId = makeTraceId(undefined);
  let requestSessionType: TurnType = 'direct';
  let requestGroupId = '';
  let requestChannelId = 'default';
  let requestRelayDepth = 0;
  let requestTargetAgentId = '';
  try {
    const body = await req.json();
    const {
      inputText,
      agentId,
      channelId,
      sessionType,
      groupId,
      groupMembers,
      senderId,
      senderName,
      autoMentionName,
      timeoutSeconds,
      relayDepth = 0,
      relayChain = [],
      relayFrom,
      traceId: incomingTraceId,
    } = body as Record<string, any>;
    traceId = makeTraceId(incomingTraceId);

    const requestedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    requestTargetAgentId = requestedAgentId;
    const openClawConfig = await getOpenClawConfig();
    const agentList = Array.isArray(openClawConfig?.agents?.list) ? openClawConfig.agents.list : [];
    const agentMap = new Map<string, OpenClawAgent>(agentList.map((agent) => [agent.id, agent]));
    const baseTimeoutSeconds = resolveTimeoutSeconds(openClawConfig);

    if (!requestedAgentId) {
      return new Response(JSON.stringify({ error: 'agentId is required.' }), { status: 400 });
    }

    if (agentMap.size > 0 && !agentMap.has(requestedAgentId)) {
      return new Response(JSON.stringify({ error: `Unknown agentId: ${requestedAgentId}` }), { status: 400 });
    }

    if (sessionType === 'group' && groupId && Array.isArray(groupMembers) && groupMembers.length > 0) {
      await initializeGroupSessions({
        groupId,
        channelId: channelId || 'default',
        ownerUserId: typeof senderId === 'string' ? senderId : undefined,
        ownerName: typeof senderName === 'string' ? senderName : undefined,
        memberAgentIds: groupMembers,
      });
    }

    const safeRelayDepth = Math.max(0, Number(relayDepth) || 0);
    const requestedTimeoutSeconds = parseTimeoutSeconds(timeoutSeconds);
    const safeRelayChain = Array.isArray(relayChain) ? relayChain.map((item) => String(item)) : [];
    requestSessionType = sessionType === 'group' ? 'group' : 'direct';
    requestGroupId = typeof groupId === 'string' ? groupId : '';
    requestChannelId = typeof channelId === 'string' && channelId.trim() ? channelId : 'default';
    requestRelayDepth = safeRelayDepth;

    const groupMemberIds = sessionType === 'group' && Array.isArray(groupMembers)
      ? Array.from(new Set(groupMembers.map((item) => String(item || '').trim()).filter(Boolean)))
      : [];
    const mentionAliasMap = buildMentionAliasMap(groupMemberIds, agentMap);

    traceLog(traceId, 'request_received', {
      requestedAgentId,
      sessionType: typeof sessionType === 'string' ? sessionType : '',
      groupId: typeof groupId === 'string' ? groupId : '',
      channelId: typeof channelId === 'string' ? channelId : '',
      senderId: typeof senderId === 'string' ? senderId : '',
      relayDepth: Math.max(0, Number(relayDepth) || 0),
      relayFrom: typeof relayFrom === 'string' ? relayFrom : '',
      groupMemberCount: groupMemberIds.length,
      baseTimeoutSeconds,
      requestedTimeoutSeconds,
    });

  const executeTurn = async (params: {
    targetAgentId: string;
    turnInputText: string;
    turnSenderId?: string;
    turnSenderName?: string;
    turnRelayDepth: number;
    turnRelayChain: string[];
    turnRelayFrom?: string;
    turnType: TurnType;
    sourceTurnType?: TurnType;
    queueSeq?: number;
  }): Promise<{
    sessionKey: string;
    sessionId: string;
    openClawSession: {
      requestedSessionKey: string;
      returnedSessionKey: string | null;
      returnedSessionId: string | null;
    };
    message: { id: string; role: 'assistant'; content: string; name: string };
    usage: unknown;
    relayedMessages: Array<{ id: string; role: 'assistant'; content: string; name: string }>;
  }> => {
    const targetAgentId = params.targetAgentId.trim();
    const turnSenderName = (params.turnSenderName || '').trim() || 'Clawchating User';
    const turnInputText = String(params.turnInputText || '');
    const turnType = params.turnType;

    if (params.turnRelayDepth > 0 && turnType === 'group' && params.sourceTurnType !== 'group') {
      throw makeChatRouteError('Relay source turn type mismatch: expected group source.', {
        status: 409,
        failureMeta: {
          executionState: 'relay_rejected',
          expectedSourceTurnType: 'group',
          actualSourceTurnType: params.sourceTurnType || null,
        },
      });
    }

    const targetAgentConfig = agentMap.get(targetAgentId);
    if (agentMap.size > 0 && !targetAgentConfig) {
      throw new Error(`Unknown relay target agent: ${targetAgentId}`);
    }

    const targetDisplayName = targetAgentConfig?.name || targetAgentId;
    const timeoutSeconds = resolveTurnTimeoutSeconds({
      baseTimeoutSeconds,
      targetAgentId,
      targetAgentConfig,
      relayDepth: params.turnRelayDepth,
    });
    const effectiveCapabilities = targetAgentConfig
      ? getCapabilitiesFromOpenClawTools(targetAgentConfig, openClawConfig)
      : DEFAULT_CAPABILITIES;

    const workspaceFolderName = turnType === 'group'
      ? (groupId || channelId || 'default-workspace')
      : (channelId || 'default-workspace');
    const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
    const agentWorkspaceDir = targetAgentConfig?.workspace
      || openClawConfig?.agents?.defaults?.workspace
      || workspaceDir;
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(agentWorkspaceDir, { recursive: true });

    const basePeerId = resolvePeerId(typeof params.turnSenderId === 'string' ? params.turnSenderId : undefined, channelId);
    const peerId = turnType === 'group'
      ? `grp_${groupId || 'unknown'}__ch_${channelId || 'default'}__${basePeerId}`
      : basePeerId;

    if (turnType === 'group' && !peerId.startsWith('grp_')) {
      throw makeChatRouteError('Group turn resolved non-group peerId.', {
        status: 409,
        failureMeta: {
          executionState: 'relay_rejected',
          peerId,
          turnType,
        },
      });
    }

    const session = await ensureAgentSession({
      agentId: targetAgentId,
      peerId,
      senderLabel: turnSenderName,
    });
    const routingChannel = 'clawchating';
    const routingTo = `user:${peerId}`;

    traceLog(traceId, 'session_resolved', {
      targetAgentId,
      relayDepth: params.turnRelayDepth,
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      peerId,
      queueSeq: params.queueSeq,
    });

    const eligibleSkills = effectiveCapabilities.skills ? await listEligibleSkills() : [];
    const skillTips = eligibleSkills
      .slice(0, 12)
      .map((s) => `- ${s.name}: ${(s.description || '').replace(/\s+/g, ' ').trim().slice(0, 100)}`)
      .join('\n');

    const semanticInput = toSemanticInput({
      senderId: peerId,
      senderName: turnSenderName,
      rawText: turnInputText,
      autoMentionName: typeof autoMentionName === 'string' ? autoMentionName : undefined,
    });

    await appendSessionMessage({
      agentId: targetAgentId,
      sessionId: session.sessionId,
      role: 'user',
      content: semanticInput.text,
    });

    if (turnType === 'group' && groupId && params.turnRelayDepth === 0) {
      await appendGroupTimelineMessage({
        groupId,
        channelId: channelId || 'default',
        role: 'user',
        content: turnInputText,
        name: turnSenderName,
        meta: {
          to: targetAgentId,
          relayDepth: params.turnRelayDepth,
          relayFrom: params.turnRelayFrom || null,
          queueSeq: params.queueSeq,
          traceId,
        },
      });
      traceLog(traceId, 'timeline_append_user', {
        targetAgentId,
        relayDepth: params.turnRelayDepth,
        queueSeq: params.queueSeq,
      });
    }

    const nativePrompt = [
      `[ClawchatingContext] mode=${sessionType} groupId=${groupId || ''} channelId=${channelId || ''}`,
      `[Identity] agentId=${targetAgentId} displayName=${targetDisplayName}`,
      `[Workspace] shared=${workspaceDir} agent=${agentWorkspaceDir}`,
      `[Capability] read=${effectiveCapabilities.read} write=${effectiveCapabilities.write} exec=${effectiveCapabilities.exec} invite=${effectiveCapabilities.invite} skills=${effectiveCapabilities.skills}`,
      turnType === 'group'
        ? buildGroupMembersPromptSection(groupMemberIds, agentMap)
        : '[GroupMembersFromSystem]\n- n/a',
      turnType === 'group'
        ? buildGroupCollaborationRulesSection()
        : '[GroupCollaborationProtocol]\n- n/a',
      effectiveCapabilities.skills
        ? `[EligibleSkills]\n${skillTips || '- none'}`
        : '[EligibleSkills]\n- disabled',
      '[UserMessage]',
      semanticInput.text,
    ].join('\n');

    let data: Record<string, unknown>;
    try {
      data = await runOpenClawAgentWithRetry({
        agentId: targetAgentId,
        sessionKey: session.sessionKey,
        routingChannel,
        routingTo,
        message: nativePrompt,
        timeoutSeconds,
        traceId,
        relayDepth: params.turnRelayDepth,
      });
    } catch (error) {
      const reason = getErrorMessage(error);
      const timeoutLike = /aborted|timeout|timed out|ETIMEDOUT/i.test(reason);
      throw makeChatRouteError(reason, {
        status: timeoutLike ? 504 : 500,
        failureMeta: {
          executionState: timeoutLike ? 'failed_timeout' : 'failed_runtime',
          requestedSessionKey: session.sessionKey,
          routingChannel,
          routingTo,
          timeoutSeconds,
          targetAgentId,
          relayDepth: params.turnRelayDepth,
        },
      });
    }
    let usage: unknown;
    let responseText = '';
    let resolvedSessionDiag = summarizeSessionDiagnostics(data, session.sessionKey);
    let driftReason: string | null = null;
    let driftRecoveryUsed = false;
    let mainSessionFallbackUsed = false;

    while (true) {
      const result = (data.result && typeof data.result === 'object') ? (data.result as Record<string, unknown>) : {};
      const payloads = Array.isArray(result.payloads) ? result.payloads : [];
      const sessionDiag = summarizeSessionDiagnostics(data, session.sessionKey);

      responseText = payloads
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const record = item as Record<string, unknown>;
          return typeof record.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n') || JSON.stringify(data, null, 2);
      usage = result.usage;

      const fallbackSession = extractSessionInfoFromResponseText(responseText);
      resolvedSessionDiag = {
        ...sessionDiag,
        returnedSessionKey: sessionDiag.returnedSessionKey || fallbackSession.sessionKey,
        returnedSessionId: sessionDiag.returnedSessionId || fallbackSession.sessionId,
      };
      driftReason = detectSessionDrift({
        turnType,
        requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
        returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
      });

      if (driftReason === 'returned_main_session') {
        const mainFallback = await loadLatestAssistantFromMainSession(targetAgentId);
        if (mainFallback?.content) {
          responseText = mainFallback.content;
          resolvedSessionDiag = {
            ...resolvedSessionDiag,
            returnedSessionKey: mainFallback.sessionKey || resolvedSessionDiag.returnedSessionKey,
            returnedSessionId: mainFallback.sessionId || resolvedSessionDiag.returnedSessionId,
          };
          mainSessionFallbackUsed = true;
          driftReason = null;

          traceLog(traceId, 'main_session_fallback_applied', {
            targetAgentId,
            relayDepth: params.turnRelayDepth,
            queueSeq: params.queueSeq,
            fallbackSessionKey: mainFallback.sessionKey,
            fallbackSessionId: mainFallback.sessionId,
            fallbackTimestamp: mainFallback.timestamp,
          });
        }
      }

      traceLog(traceId, 'openclaw_call_done', {
        targetAgentId,
        relayDepth: params.turnRelayDepth,
        queueSeq: params.queueSeq,
        payloadCount: payloads.length,
        requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
        returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
        returnedSessionId: resolvedSessionDiag.returnedSessionId,
        fallbackReturnedSessionKey: fallbackSession.sessionKey,
        fallbackReturnedSessionId: fallbackSession.sessionId,
        driftRecoveryUsed,
        mainSessionFallbackUsed,
        ...resolvedSessionDiag.raw,
      });

      if (
        driftReason === 'returned_main_session'
        && turnType === 'group'
        && !driftRecoveryUsed
      ) {
        driftRecoveryUsed = true;
        const driftRecoveryTo = `${routingTo}:driftfix:${Date.now()}`;
        traceLog(traceId, 'session_drift_retry', {
          targetAgentId,
          relayDepth: params.turnRelayDepth,
          queueSeq: params.queueSeq,
          requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
          returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
          returnedSessionId: resolvedSessionDiag.returnedSessionId,
          recoveryRoutingTo: driftRecoveryTo,
        });

        try {
          data = await runOpenClawAgentWithRetry({
            agentId: targetAgentId,
            sessionKey: session.sessionKey,
            routingChannel,
            routingTo: driftRecoveryTo,
            message: nativePrompt,
            timeoutSeconds,
            traceId,
            relayDepth: params.turnRelayDepth,
          });
          continue;
        } catch (error) {
          const reason = getErrorMessage(error);
          const timeoutLike = /aborted|timeout|timed out|ETIMEDOUT/i.test(reason);
          throw makeChatRouteError(reason, {
            status: timeoutLike ? 504 : 500,
            failureMeta: {
              executionState: timeoutLike ? 'failed_timeout' : 'failed_runtime',
              requestedSessionKey: session.sessionKey,
              routingChannel,
              routingTo: driftRecoveryTo,
              timeoutSeconds,
              targetAgentId,
              relayDepth: params.turnRelayDepth,
              driftRecoveryUsed,
            },
          });
        }
      }

      break;
    }

    const tolerateMainDrift = driftReason === 'returned_main_session'
      && turnType === 'group'
      && params.turnRelayDepth > 0;

    if (driftReason && !tolerateMainDrift) {
      traceLog(traceId, 'session_drift_detected', {
        targetAgentId,
        relayDepth: params.turnRelayDepth,
        queueSeq: params.queueSeq,
        driftReason,
        driftRecoveryUsed,
        requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
        returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
        returnedSessionId: resolvedSessionDiag.returnedSessionId,
      });

      if (turnType === 'group' && groupId) {
        await appendGroupTimelineMessage({
          groupId,
          channelId: channelId || 'default',
          role: 'assistant',
          content: `[SessionDrift] 已拦截本轮回复：执行会话发生漂移（${driftReason}）。`,
          name: targetAgentId,
          meta: {
            relayDepth: params.turnRelayDepth,
            relayFrom: params.turnRelayFrom || null,
            queueSeq: params.queueSeq,
            traceId,
            executionState: 'drift_blocked',
            driftDetected: true,
            driftReason,
            driftRecoveryUsed,
            requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
            returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
            returnedSessionId: resolvedSessionDiag.returnedSessionId,
          },
        });
      }

      throw makeChatRouteError(`Session drift detected: ${driftReason}`, {
        status: 409,
        timelineNotified: true,
        failureMeta: {
          executionState: 'drift_blocked',
          driftDetected: true,
          driftReason,
          driftRecoveryUsed,
          requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
          returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
          returnedSessionId: resolvedSessionDiag.returnedSessionId,
        },
      });
    }

    if (driftReason && tolerateMainDrift) {
      traceLog(traceId, 'session_drift_tolerated', {
        targetAgentId,
        relayDepth: params.turnRelayDepth,
        queueSeq: params.queueSeq,
        driftReason,
        driftRecoveryUsed,
        requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
        returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
        returnedSessionId: resolvedSessionDiag.returnedSessionId,
      });
    }

    await appendSessionMessage({
      agentId: targetAgentId,
      sessionId: session.sessionId,
      role: 'assistant',
      content: responseText,
      name: targetAgentId,
    });

    if (turnType === 'group' && groupId) {
      await appendGroupTimelineMessage({
        groupId,
        channelId: channelId || 'default',
        role: 'assistant',
        content: responseText,
        name: targetAgentId,
        meta: {
          relayDepth: params.turnRelayDepth,
          relayFrom: params.turnRelayFrom || null,
          queueSeq: params.queueSeq,
          traceId,
          driftTolerated: !!tolerateMainDrift,
          driftReason: tolerateMainDrift ? driftReason : null,
          mainSessionFallbackUsed,
          requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
          returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
          returnedSessionId: resolvedSessionDiag.returnedSessionId,
        },
      });
      traceLog(traceId, 'timeline_append_assistant', {
        targetAgentId,
        relayDepth: params.turnRelayDepth,
        queueSeq: params.queueSeq,
      });
    }

    const rawTargets = turnType === 'group'
      ? extractMentionTargets(responseText, mentionAliasMap)
      : [];
    console.info('[mention_parse]', {
      groupId,
      channelId,
      sourceAgentId: targetAgentId,
      relayDepth: params.turnRelayDepth,
      parsedTargets: rawTargets,
    });
    traceLog(traceId, 'mention_parse', {
      sourceAgentId: targetAgentId,
      relayDepth: params.turnRelayDepth,
      parsedTargets: rawTargets,
      queueSeq: params.queueSeq,
    });

    const relayedMessages: Array<{ id: string; role: 'assistant'; content: string; name: string }> = [];
    if (turnType === 'group' && groupId) {
      if (params.turnRelayDepth >= MAX_RELAY_DEPTH && rawTargets.length > 0) {
        console.info('[relay_drop]', {
          reason: 'max_depth_reached',
          groupId,
          channelId,
          sourceAgentId: targetAgentId,
          relayDepth: params.turnRelayDepth,
          targets: rawTargets,
        });
      } else {
        const nextTargets = rawTargets
          .filter((target) => target !== targetAgentId)
          .filter((target) => groupMemberIds.includes(target))
          .filter((target) => !params.turnRelayChain.includes(target))
          .slice(0, MAX_RELAY_TARGETS);

        if (nextTargets.length === 0 && rawTargets.length > 0) {
          console.info('[relay_drop]', {
            reason: 'invalid_or_duplicate_targets',
            groupId,
            channelId,
            sourceAgentId: targetAgentId,
            rawTargets,
            relayChain: params.turnRelayChain,
          });
        }

        for (const nextTarget of nextTargets) {
          console.info('[relay_dispatch]', {
            groupId,
            channelId,
            from: targetAgentId,
            to: nextTarget,
            relayDepth: params.turnRelayDepth + 1,
          });

          const relayInput = [
            `[Relay Task] 来自群成员 @${targetAgentId} 的协作请求。`,
            '请基于以下上下文执行，并给出可直接用于群协作的结果。',
            '[Original Message]',
            responseText,
          ].join('\n');

          try {
            const relayResult = await executeTurn({
              targetAgentId: nextTarget,
              turnInputText: relayInput,
              turnSenderId: `agent_${targetAgentId}`,
              turnSenderName: targetDisplayName,
              turnRelayDepth: params.turnRelayDepth + 1,
              turnRelayChain: [...params.turnRelayChain, targetAgentId],
              turnRelayFrom: targetAgentId,
              turnType: 'group',
              sourceTurnType: turnType,
              queueSeq: params.queueSeq,
            });

            relayedMessages.push(relayResult.message, ...relayResult.relayedMessages);
          } catch (error) {
            const reason = getErrorMessage(error);
            console.warn('[relay_skip]', {
              groupId,
              channelId,
              from: targetAgentId,
              to: nextTarget,
              relayDepth: params.turnRelayDepth + 1,
              reason,
            });

            await appendGroupTimelineMessage({
              groupId,
              channelId: channelId || 'default',
              role: 'assistant',
              content: `[RelayNotice] @${nextTarget} 本轮中继失败，已跳过。原因：${reason}`,
              name: targetAgentId,
              meta: {
                relayDepth: params.turnRelayDepth + 1,
                relayFrom: targetAgentId,
                queueSeq: params.queueSeq,
                relayError: true,
                traceId,
              },
            });
            traceLog(traceId, 'timeline_append_relay_notice', {
              from: targetAgentId,
              to: nextTarget,
              relayDepth: params.turnRelayDepth + 1,
              queueSeq: params.queueSeq,
              reason,
            });
          }
        }
      }
    }

    return {
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      openClawSession: {
        requestedSessionKey: resolvedSessionDiag.requestedSessionKey,
        returnedSessionKey: resolvedSessionDiag.returnedSessionKey,
        returnedSessionId: resolvedSessionDiag.returnedSessionId,
      },
      message: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: responseText,
        name: targetAgentId,
      },
      usage,
      relayedMessages,
    };
  };

    if (sessionType === 'group' && groupId) {
      const queueKey = buildGroupQueueKey(groupId, channelId);
      const queued = await enqueueGroupTask(queueKey, async ({ queueSeq, queuedAhead }) => {
        const result = await executeTurn({
          targetAgentId: requestedAgentId,
          turnInputText: typeof inputText === 'string' ? inputText : '',
          turnSenderId: typeof senderId === 'string' ? senderId : undefined,
          turnSenderName: typeof senderName === 'string' ? senderName : undefined,
          turnRelayDepth: safeRelayDepth,
          turnRelayChain: safeRelayChain,
          turnRelayFrom: typeof relayFrom === 'string' ? relayFrom : undefined,
          turnType: 'group',
          sourceTurnType: 'group',
          queueSeq,
        });

        return {
          result,
          queue: {
            key: queueKey,
            sequence: queueSeq,
            queuedAhead,
          },
        };
      });

      return new Response(
        JSON.stringify({
          ...queued.result,
          queue: queued.queue,
          traceId,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await executeTurn({
      targetAgentId: requestedAgentId,
      turnInputText: typeof inputText === 'string' ? inputText : '',
      turnSenderId: typeof senderId === 'string' ? senderId : undefined,
      turnSenderName: typeof senderName === 'string' ? senderName : undefined,
      turnRelayDepth: safeRelayDepth,
      turnRelayChain: safeRelayChain,
      turnRelayFrom: typeof relayFrom === 'string' ? relayFrom : undefined,
      turnType: 'direct',
      sourceTurnType: 'direct',
    });

    return new Response(
      JSON.stringify({ ...result, traceId }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = getErrorMessage(error);
    const looksLikeTimeout = /aborted|timeout|timed out|ETIMEDOUT/i.test(message);
    const chatError = error as ChatRouteError;
    const status = Number.isFinite(chatError.status || NaN)
      ? Number(chatError.status)
      : (looksLikeTimeout ? 504 : 500);

    if (requestSessionType === 'group' && requestGroupId && !chatError.timelineNotified) {
      const safeSummary = message.replace(/\s+/g, ' ').slice(0, 300);
      const failureMeta = chatError.failureMeta || {};
      try {
        await appendGroupTimelineMessage({
          groupId: requestGroupId,
          channelId: requestChannelId || 'default',
          role: 'assistant',
          content: `[SystemNotice] 本轮执行失败，已记录。原因：${safeSummary}`,
          name: requestTargetAgentId || 'system',
          meta: {
            relayDepth: requestRelayDepth,
            relayFrom: null,
            queueSeq: null,
            traceId,
            executionState: 'failed_visible',
            ...failureMeta,
          },
        });
      } catch (timelineError) {
        traceLog(traceId, 'timeline_append_failure_notice_failed', {
          message: getErrorMessage(timelineError),
          originalError: message,
        });
      }
    }

    traceLog(traceId, 'request_failed', {
      status,
      looksLikeTimeout,
      message,
    });
    return new Response(
      JSON.stringify({
        error: looksLikeTimeout
          ? `OpenClaw 请求超时或被中止：${message}`
          : message,
        traceId,
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
