import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
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

export const maxDuration = 120;

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
  clawchating?: {
    skillsEnabled?: boolean;
  };
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

const execFileAsync = promisify(execFile);
const MAX_RELAY_DEPTH = 2;
const MAX_RELAY_TARGETS = 2;

const DEFAULT_CAPABILITIES: AgentCapabilities = { read: true, write: true, exec: false, invite: false, skills: true };

function getCapabilitiesFromOpenClawTools(agentConfig: OpenClawAgent | undefined, openClawConfig?: OpenClawConfig): AgentCapabilities {
  const alsoAllow: string[] = agentConfig?.tools?.alsoAllow || [];
  const globalNativeSkills = openClawConfig?.commands?.nativeSkills;
  const globalSkillsEnabled = globalNativeSkills !== 'off';
  const agentSkillsEnabled = typeof agentConfig?.clawchating?.skillsEnabled === 'boolean'
    ? agentConfig.clawchating.skillsEnabled
    : undefined;
  return {
    read: alsoAllow.includes('read'),
    write: alsoAllow.includes('write') || alsoAllow.includes('edit') || alsoAllow.includes('apply_patch'),
    exec: alsoAllow.includes('exec') || alsoAllow.includes('process'),
    invite: alsoAllow.includes('subagents') || alsoAllow.includes('agents_list'),
    skills: agentSkillsEnabled ?? (alsoAllow.includes('skills') || globalSkillsEnabled),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
    relayDepth = 0,
    relayChain = [],
    relayFrom,
    capabilities = DEFAULT_CAPABILITIES,
  } = await req.json();

  const requestedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  const openClawConfig = await getOpenClawConfig();
  const agentList = Array.isArray(openClawConfig?.agents?.list) ? openClawConfig.agents.list : [];
  const agentMap = new Map<string, OpenClawAgent>(agentList.map((agent) => [agent.id, agent]));

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
  const safeRelayChain = Array.isArray(relayChain) ? relayChain.map((item) => String(item)) : [];

  const groupMemberIds = sessionType === 'group' && Array.isArray(groupMembers)
    ? Array.from(new Set(groupMembers.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];
  const mentionAliasMap = buildMentionAliasMap(groupMemberIds, agentMap);

  const executeTurn = async (params: {
    targetAgentId: string;
    turnInputText: string;
    turnSenderId?: string;
    turnSenderName?: string;
    turnRelayDepth: number;
    turnRelayChain: string[];
    turnRelayFrom?: string;
    requestedCaps?: AgentCapabilities;
  }): Promise<{
    sessionKey: string;
    sessionId: string;
    message: { id: string; role: 'assistant'; content: string; name: string };
    usage: unknown;
    relayedMessages: Array<{ id: string; role: 'assistant'; content: string; name: string }>;
  }> => {
    const targetAgentId = params.targetAgentId.trim();
    const turnSenderName = (params.turnSenderName || '').trim() || 'Clawchating User';
    const turnInputText = String(params.turnInputText || '');

    const targetAgentConfig = agentMap.get(targetAgentId);
    if (agentMap.size > 0 && !targetAgentConfig) {
      throw new Error(`Unknown relay target agent: ${targetAgentId}`);
    }

    const targetDisplayName = targetAgentConfig?.name || targetAgentId;
    const openClawCapabilities = targetAgentConfig
      ? getCapabilitiesFromOpenClawTools(targetAgentConfig, openClawConfig)
      : DEFAULT_CAPABILITIES;
    const capSource = params.requestedCaps || DEFAULT_CAPABILITIES;
    const effectiveCapabilities: AgentCapabilities = {
      read: !!capSource.read && openClawCapabilities.read,
      write: !!capSource.write && openClawCapabilities.write,
      exec: !!capSource.exec && openClawCapabilities.exec,
      invite: !!capSource.invite && openClawCapabilities.invite,
      skills: !!capSource.skills && openClawCapabilities.skills,
    };

    const workspaceFolderName = sessionType === 'group'
      ? (groupId || channelId || 'default-workspace')
      : (channelId || 'default-workspace');
    const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
    const agentWorkspaceDir = targetAgentConfig?.workspace
      || openClawConfig?.agents?.defaults?.workspace
      || workspaceDir;
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(agentWorkspaceDir, { recursive: true });

    const basePeerId = resolvePeerId(typeof params.turnSenderId === 'string' ? params.turnSenderId : undefined, channelId);
    const peerId = sessionType === 'group'
      ? `grp_${groupId || 'unknown'}__ch_${channelId || 'default'}__${basePeerId}`
      : basePeerId;

    const session = await ensureAgentSession({
      agentId: targetAgentId,
      peerId,
      senderLabel: turnSenderName,
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

    if (sessionType === 'group' && groupId && params.turnRelayDepth === 0) {
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
        },
      });
    }

    const nativePrompt = [
      `[ClawchatingContext] mode=${sessionType} groupId=${groupId || ''} channelId=${channelId || ''}`,
      `[Identity] agentId=${targetAgentId} displayName=${targetDisplayName}`,
      `[Workspace] shared=${workspaceDir} agent=${agentWorkspaceDir}`,
      `[Capability] read=${effectiveCapabilities.read} write=${effectiveCapabilities.write} exec=${effectiveCapabilities.exec} invite=${effectiveCapabilities.invite} skills=${effectiveCapabilities.skills}`,
      sessionType === 'group'
        ? buildGroupMembersPromptSection(groupMemberIds, agentMap)
        : '[GroupMembersFromSystem]\n- n/a',
      sessionType === 'group'
        ? buildGroupCollaborationRulesSection()
        : '[GroupCollaborationProtocol]\n- n/a',
      effectiveCapabilities.skills
        ? `[EligibleSkills]\n${skillTips || '- none'}`
        : '[EligibleSkills]\n- disabled',
      '[UserMessage]',
      semanticInput.text,
    ].join('\n');

    const data = await runOpenClawJson(
      ['agent', '--agent', targetAgentId, '--session-id', session.sessionKey, '--message', nativePrompt, '--json', '--timeout', '120'],
      125000
    );
    const result = (data.result && typeof data.result === 'object') ? (data.result as Record<string, unknown>) : {};
    const payloads = Array.isArray(result.payloads) ? result.payloads : [];
    const responseText = payloads
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const record = item as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n') || JSON.stringify(data, null, 2);
    const usage = result.usage;

    await appendSessionMessage({
      agentId: targetAgentId,
      sessionId: session.sessionId,
      role: 'assistant',
      content: responseText,
      name: targetAgentId,
    });

    if (sessionType === 'group' && groupId) {
      await appendGroupTimelineMessage({
        groupId,
        channelId: channelId || 'default',
        role: 'assistant',
        content: responseText,
        name: targetAgentId,
        meta: {
          relayDepth: params.turnRelayDepth,
          relayFrom: params.turnRelayFrom || null,
        },
      });
    }

    const rawTargets = sessionType === 'group'
      ? extractMentionTargets(responseText, mentionAliasMap)
      : [];
    console.info('[mention_parse]', {
      groupId,
      channelId,
      sourceAgentId: targetAgentId,
      relayDepth: params.turnRelayDepth,
      parsedTargets: rawTargets,
    });

    const relayedMessages: Array<{ id: string; role: 'assistant'; content: string; name: string }> = [];
    if (sessionType === 'group' && groupId) {
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

          const relayResult = await executeTurn({
            targetAgentId: nextTarget,
            turnInputText: relayInput,
            turnSenderId: `agent_${targetAgentId}`,
            turnSenderName: targetDisplayName,
            turnRelayDepth: params.turnRelayDepth + 1,
            turnRelayChain: [...params.turnRelayChain, targetAgentId],
            turnRelayFrom: targetAgentId,
            requestedCaps: DEFAULT_CAPABILITIES,
          });

          relayedMessages.push(relayResult.message, ...relayResult.relayedMessages);
        }
      }
    }

    return {
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
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

  const result = await executeTurn({
    targetAgentId: requestedAgentId,
    turnInputText: typeof inputText === 'string' ? inputText : '',
    turnSenderId: typeof senderId === 'string' ? senderId : undefined,
    turnSenderName: typeof senderName === 'string' ? senderName : undefined,
    turnRelayDepth: safeRelayDepth,
    turnRelayChain: safeRelayChain,
    turnRelayFrom: typeof relayFrom === 'string' ? relayFrom : undefined,
    requestedCaps: capabilities,
  });

  return new Response(
    JSON.stringify(result),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
