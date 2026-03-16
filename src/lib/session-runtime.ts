import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

type SessionMessageRole = 'user' | 'assistant';

type SessionMessage = {
  id: string;
  role: SessionMessageRole;
  content: string;
  timestamp: number;
  name?: string;
};

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
  tools?: {
    alsoAllow?: string[];
  };
};

type OpenClawConfig = {
  agents?: {
    list?: OpenClawAgent[];
  };
};

type DeliveryContext = {
  channel: 'clawchating';
  to: string;
  accountId: 'default';
};

type OriginContext = {
  label: string;
  provider: 'clawchating';
  surface: 'clawchating';
  chatType: 'direct';
  from: string;
  to: string;
  accountId: 'default';
};

type SessionStoreEntry = {
  sessionId: string;
  updatedAt: number;
  systemSent: boolean;
  abortedLastRun: boolean;
  chatType: 'direct';
  deliveryContext: DeliveryContext;
  lastChannel: 'clawchating';
  lastTo: string;
  lastAccountId: 'default';
  origin: OriginContext;
  sessionFile: string;
  compactionCount: number;
  capabilities: AgentCapabilities;
  workspaceDir: string;
  skillsSnapshot: {
    enabledSkills: string[];
    generatedAt: number;
  };
};

type SessionStore = Record<string, SessionStoreEntry>;

const DEFAULT_CAPABILITIES: AgentCapabilities = { read: true, write: true, exec: false, invite: false, skills: true };
const CLAWCHATING_SKILLS = ['clawchating-read', 'clawchating-write', 'clawchating-exec', 'clawchating-invite', 'openclaw-native-skills'];

function sanitizePeerId(value: string | undefined) {
  const v = (value || '').trim();
  if (!v) return 'ou_local_user';
  return v.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getCapabilitiesFromTools(alsoAllow: string[] | undefined): AgentCapabilities {
  const list = alsoAllow || [];
  return {
    read: list.includes('read'),
    write: list.includes('write') || list.includes('edit') || list.includes('apply_patch'),
    exec: list.includes('exec') || list.includes('process'),
    invite: list.includes('subagents') || list.includes('agents_list'),
    skills: list.includes('skills'),
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

async function loadOpenClawConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  return readJsonFile<OpenClawConfig>(configPath, {} as OpenClawConfig);
}

async function getAgentProfile(agentId: string) {
  const config = await loadOpenClawConfig();
  const list = Array.isArray(config.agents?.list) ? config.agents?.list : [];
  const found = list.find((a) => a.id === agentId);
  const capabilities = found ? getCapabilitiesFromTools(found.tools?.alsoAllow) : DEFAULT_CAPABILITIES;
  return {
    agentId,
    displayName: found?.name || agentId,
    workspaceDir: found?.workspace || path.join(process.cwd(), 'workspaces', 'default-workspace'),
    capabilities,
  };
}

function getAgentSessionsDir(agentId: string) {
  return path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions');
}

function getSessionsStorePath(agentId: string) {
  return path.join(getAgentSessionsDir(agentId), 'sessions.json');
}

function buildClawchatingSessionKey(agentId: string, peerId: string) {
  return `agent:${agentId}:clawchating:direct:${peerId}`;
}

function buildSemanticEnhancedUserMessage(params: {
  senderId: string;
  senderName: string;
  messageId: string;
  text: string;
  autoMentionName?: string;
}) {
  const { senderId, senderName, messageId, text, autoMentionName } = params;
  return `Conversation info (untrusted metadata):\n\`\`\`json\n${JSON.stringify(
    {
      message_id: messageId,
      sender_id: senderId,
      sender: senderName,
      timestamp: new Date().toISOString(),
    },
    null,
    2
  )}\n\`\`\`\n\nSender (untrusted metadata):\n\`\`\`json\n${JSON.stringify(
    {
      label: `${senderName} (${senderId})`,
      id: senderId,
      name: senderName,
    },
    null,
    2
  )}\n\`\`\`\n\n[message_id: ${messageId}]\n${senderName}: ${text}\n\n[System: The content may include mention tags in the form <at user_id=\"...\">name</at>. Treat these as real mentions of Clawchating entities.]${
    autoMentionName
      ? `\n[System: Your reply will automatically @mention: ${autoMentionName}. Do not write @xxx yourself.]`
      : ''
  }`;
}

function extractDisplayUserText(text: string) {
  const normalized = text.trim();

  // Channel-enhanced payload format: keep only the user-entered text section for UI display.
  const withSystemTail = normalized.match(/\[message_id:[^\]]+\]\s*\n([\s\S]*?)\n\n\[System:/);
  const section = withSystemTail?.[1]?.trim() || normalized;

  // Remove leading sender label like "Clawchating User: ..." for cleaner rendering.
  return section.replace(/^[^:\n]{1,80}:\s*/, '').trim();
}

function parseMessageText(content: unknown, role: SessionMessageRole) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const raw = content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as { type?: unknown; text?: unknown };
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');

  if (!raw) return '';
  return role === 'user' ? extractDisplayUserText(raw) : raw;
}

async function appendJsonLine(filePath: string, payload: unknown) {
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
}

export async function ensureAgentSession(params: {
  agentId: string;
  peerId: string;
  senderLabel: string;
}) {
  const { agentId, peerId, senderLabel } = params;
  const profile = await getAgentProfile(agentId);
  const sessionsDir = getAgentSessionsDir(agentId);
  await fs.mkdir(sessionsDir, { recursive: true });

  const sessionKey = buildClawchatingSessionKey(agentId, sanitizePeerId(peerId));
  const sessionsStorePath = getSessionsStorePath(agentId);
  const store = await readJsonFile<SessionStore>(sessionsStorePath, {} as SessionStore);
  const existing = store[sessionKey];
  const sessionId = existing?.sessionId || randomUUID();
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  const to = `user:${sanitizePeerId(peerId)}`;
  const now = Date.now();

  store[sessionKey] = {
    sessionId,
    updatedAt: now,
    systemSent: true,
    abortedLastRun: false,
    chatType: 'direct',
    deliveryContext: {
      channel: 'clawchating',
      to,
      accountId: 'default',
    },
    lastChannel: 'clawchating',
    lastTo: to,
    lastAccountId: 'default',
    origin: {
      label: senderLabel,
      provider: 'clawchating',
      surface: 'clawchating',
      chatType: 'direct',
      from: `clawchating:${sanitizePeerId(peerId)}`,
      to,
      accountId: 'default',
    },
    sessionFile,
    compactionCount: existing?.compactionCount || 0,
    capabilities: profile.capabilities,
    workspaceDir: profile.workspaceDir,
    skillsSnapshot: {
      enabledSkills: CLAWCHATING_SKILLS,
      generatedAt: now,
    },
  };

  await fs.writeFile(sessionsStorePath, JSON.stringify(store, null, 2), 'utf-8');

  if (!existing) {
    await appendJsonLine(sessionFile, {
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: profile.workspaceDir,
    });
  }

  return {
    sessionId,
    sessionKey,
    sessionFile,
    profile,
  };
}

export async function appendSessionMessage(params: {
  agentId: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string;
  name?: string;
  usage?: unknown;
}) {
  const { agentId, sessionId, role, content, name, usage } = params;
  const sessionsDir = getAgentSessionsDir(agentId);
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const line: Record<string, unknown> = {
    type: 'message',
    id: randomUUID().slice(0, 8),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role,
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
      ...(name ? { name } : {}),
    },
  };
  if (usage) {
    (line.message as Record<string, unknown>).usage = usage;
  }
  await appendJsonLine(sessionFile, line);
}

export async function loadSessionMessages(params: {
  agentId: string;
  sessionKey: string;
  limit?: number;
}) {
  const { agentId, sessionKey, limit = 30 } = params;
  const store = await readJsonFile<SessionStore>(getSessionsStorePath(agentId), {} as SessionStore);
  const entry = store[sessionKey];
  if (!entry?.sessionId) return [] as SessionMessage[];

  const sessionFile = path.join(getAgentSessionsDir(agentId), `${entry.sessionId}.jsonl`);
  let content = '';
  try {
    content = await fs.readFile(sessionFile, 'utf-8');
  } catch {
    return [] as SessionMessage[];
  }

  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as {
          type?: string;
          message?: { role?: SessionMessageRole; content?: unknown; timestamp?: number; name?: string };
        };
      } catch {
        return null;
      }
    })
    .filter((line) => line?.type === 'message' && !!line?.message?.role) as Array<{
      message: { role: SessionMessageRole; content?: unknown; timestamp?: number; name?: string };
    }>;

  return rows
    .map((row) => ({
      id: randomUUID().slice(0, 8),
      role: row.message.role,
      content: parseMessageText(row.message.content, row.message.role),
      timestamp: row.message.timestamp || Date.now(),
      ...(row.message.name ? { name: row.message.name } : {}),
    }))
    .filter((row) => row.content)
    .slice(-limit);
}

export async function initializeGroupSessions(params: {
  groupId: string;
  channelId: string;
  ownerUserId?: string;
  ownerName?: string;
  memberAgentIds: string[];
}) {
  const peerId = sanitizePeerId(params.ownerUserId || params.channelId || `ou_group_${params.groupId}`);
  const senderLabel = params.ownerName || 'Clawchating User';

  const results: Array<{ agentId: string; sessionKey: string; sessionId: string }> = [];

  for (const agentId of params.memberAgentIds) {
    const session = await ensureAgentSession({
      agentId,
      peerId,
      senderLabel,
    });
    results.push({ agentId, sessionKey: session.sessionKey, sessionId: session.sessionId });
  }

  return results;
}

export function toSemanticInput(params: {
  senderId: string;
  senderName: string;
  rawText: string;
  autoMentionName?: string;
}) {
  const messageId = `msg_${Date.now()}_${randomUUID().slice(0, 6)}`;
  return {
    messageId,
    text: buildSemanticEnhancedUserMessage({
      senderId: sanitizePeerId(params.senderId),
      senderName: params.senderName || 'Clawchating User',
      messageId,
      text: params.rawText,
      autoMentionName: params.autoMentionName,
    }),
  };
}

export function resolvePeerId(senderId?: string, channelId?: string) {
  if (senderId && senderId.trim()) return sanitizePeerId(senderId);
  if (channelId && channelId.trim().startsWith('ou_')) return sanitizePeerId(channelId);
  return 'ou_local_user';
}
