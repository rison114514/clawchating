import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const CHANNEL_ID = 'clawchating';
const DEFAULT_ACCOUNT_ID = 'default';

function normalizeAccountId(accountId) {
  const value = String(accountId || '').trim();
  return value || DEFAULT_ACCOUNT_ID;
}

function getChannelSection(cfg) {
  return (cfg?.channels?.[CHANNEL_ID] && typeof cfg.channels[CHANNEL_ID] === 'object')
    ? cfg.channels[CHANNEL_ID]
    : {};
}

function getAccounts(section) {
  return (section?.accounts && typeof section.accounts === 'object')
    ? section.accounts
    : {};
}

function resolveAccount(cfg, accountId) {
  const section = getChannelSection(cfg);
  const accounts = getAccounts(section);
  const resolvedId = normalizeAccountId(accountId || section.defaultAccountId);
  const account = (accounts[resolvedId] && typeof accounts[resolvedId] === 'object')
    ? accounts[resolvedId]
    : {};
  const enabled = account.enabled !== undefined
    ? account.enabled !== false
    : (section.enabled !== false);

  return {
    accountId: resolvedId,
    enabled,
    configured: true,
    name: String(account.name || `clawchating-${resolvedId}`),
    defaultTo: String(account.defaultTo || section.defaultTo || ''),
  };
}

function ensureChannelConfig(cfg) {
  const root = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  const channels = root.channels && typeof root.channels === 'object' ? { ...root.channels } : {};
  const section = getChannelSection(root);
  const accounts = getAccounts(section);

  channels[CHANNEL_ID] = {
    ...section,
    enabled: section.enabled !== false,
    accounts: { ...accounts },
  };

  root.channels = channels;
  return root;
}

function parseClawchatingTarget(rawTo) {
  const to = String(rawTo || '').trim().replace(/^user:/i, '');
  const m = to.match(/^grp_([^_]+(?:-[^_]+)*)__ch_([^_]+(?:-[^_]+)*)__(.+)$/);
  if (!m) return null;

  return {
    groupId: m[1],
    channelId: m[2],
    peerId: m[3],
  };
}

async function appendTimelineMessage(params) {
  const { cfg, to, text } = params;
  const parsed = parseClawchatingTarget(to);
  if (!parsed) {
    throw new Error(`clawchating target format invalid: ${to}`);
  }

  const workspaceRoot = String(cfg?.workspace?.root || process.cwd());
  const timelinePath = path.join(
    workspaceRoot,
    'workspaces',
    parsed.groupId,
    `.timeline-${parsed.channelId}.jsonl`,
  );

  await fs.mkdir(path.dirname(timelinePath), { recursive: true });

  const messageId = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const line = {
    type: 'group_message',
    id: messageId,
    timestamp: new Date(now).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: now,
      name: 'openclaw',
      meta: {
        channel: CHANNEL_ID,
        plugin: 'clawchating-channel',
      },
    },
  };

  await fs.appendFile(timelinePath, `${JSON.stringify(line)}\n`, 'utf-8');

  return {
    channel: CHANNEL_ID,
    messageId,
    chatId: parsed.groupId,
    channelId: parsed.channelId,
  };
}

const clawchatingPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: 'Clawchating',
    selectionLabel: 'Clawchating',
    docsPath: '/channels/clawchating',
    docsLabel: 'clawchating',
    blurb: 'Local Clawchating timeline channel',
    aliases: ['clawchat'],
    order: 98,
  },
  capabilities: {
    chatTypes: ['direct', 'group'],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ['channels.clawchating'] },
  config: {
    listAccountIds: (cfg) => {
      const section = getChannelSection(cfg);
      const accounts = getAccounts(section);
      const ids = Object.keys(accounts).filter(Boolean);
      return ids.length > 0 ? ids : [normalizeAccountId(section.defaultAccountId)];
    },
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isEnabled: (account) => account.enabled !== false,
    isConfigured: () => true,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled !== false,
      configured: true,
      name: account.name,
    }),
    resolveDefaultTo: ({ cfg, accountId }) => resolveAccount(cfg, accountId).defaultTo || undefined,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => {
      const next = ensureChannelConfig(cfg);
      const id = normalizeAccountId(accountId);
      const section = next.channels[CHANNEL_ID];
      section.accounts[id] = {
        ...(section.accounts[id] || {}),
        name: String(name || section.accounts[id]?.name || `clawchating-${id}`),
      };
      return next;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const next = ensureChannelConfig(cfg);
      const id = normalizeAccountId(accountId);
      const section = next.channels[CHANNEL_ID];
      section.accounts[id] = {
        ...(section.accounts[id] || {}),
        enabled: true,
        name: String(input?.name || section.accounts[id]?.name || `clawchating-${id}`),
      };
      section.defaultAccountId = section.defaultAccountId || id;
      section.enabled = true;
      return next;
    },
  },
  outbound: {
    deliveryMode: 'direct',
    resolveTarget: ({ to, allowFrom, mode }) => {
      const normalized = String(to || '').trim();
      if (normalized) {
        return { ok: true, to: normalized };
      }
      if ((mode === 'implicit' || mode === 'heartbeat') && Array.isArray(allowFrom) && allowFrom[0]) {
        return { ok: true, to: String(allowFrom[0]) };
      }
      return { ok: false, error: new Error('clawchating target is required') };
    },
    sendText: async (ctx) => {
      return appendTimelineMessage({ cfg: ctx.cfg, to: ctx.to, text: ctx.text });
    },
    sendPayload: async (ctx) => {
      const text = String(ctx.payload?.text || '').trim();
      return appendTimelineMessage({ cfg: ctx.cfg, to: ctx.to, text });
    },
  },
};

const plugin = {
  id: 'clawchating-channel',
  name: 'clawchating-channel',
  description: 'Clawchating channel plugin',
  register(api) {
    api.registerChannel({ plugin: clawchatingPlugin });
  },
};

export default plugin;
