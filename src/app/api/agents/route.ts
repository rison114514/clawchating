import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

type OpenClawAgent = {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  identity?: {
    avatar?: string;
    [key: string]: unknown;
  };
  avatar?: string;
  tools?: {
    alsoAllow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenClawConfig = {
  commands?: {
    nativeSkills?: 'on' | 'off' | 'auto' | string;
    [key: string]: unknown;
  };
  agents?: {
    list?: OpenClawAgent[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type NativeAgentSummary = {
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identityAvatar?: string;
  workspace?: string;
  isDefault?: boolean;
};

type OpenClawModelSummary = {
  key: string;
  name?: string;
  input?: string;
  contextWindow?: number;
  available: boolean;
  local?: boolean;
  tags: string[];
};

type ToolCatalogItem = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  source: 'core' | 'detected';
};

const execFileAsync = promisify(execFile);
const CORE_TOOL_CATALOG: ToolCatalogItem[] = [
  { id: 'read', label: 'read', description: 'Read file contents', sectionId: 'fs', source: 'core' },
  { id: 'write', label: 'write', description: 'Create or overwrite files', sectionId: 'fs', source: 'core' },
  { id: 'edit', label: 'edit', description: 'Make precise edits', sectionId: 'fs', source: 'core' },
  { id: 'apply_patch', label: 'apply_patch', description: 'Patch files (OpenAI)', sectionId: 'fs', source: 'core' },
  { id: 'exec', label: 'exec', description: 'Run shell commands', sectionId: 'runtime', source: 'core' },
  { id: 'process', label: 'process', description: 'Manage background processes', sectionId: 'runtime', source: 'core' },
  { id: 'web_search', label: 'web_search', description: 'Search the web', sectionId: 'web', source: 'core' },
  { id: 'web_fetch', label: 'web_fetch', description: 'Fetch web content', sectionId: 'web', source: 'core' },
  { id: 'memory_search', label: 'memory_search', description: 'Semantic search', sectionId: 'memory', source: 'core' },
  { id: 'memory_get', label: 'memory_get', description: 'Read memory files', sectionId: 'memory', source: 'core' },
  { id: 'sessions_list', label: 'sessions_list', description: 'List sessions', sectionId: 'sessions', source: 'core' },
  { id: 'sessions_history', label: 'sessions_history', description: 'Session history', sectionId: 'sessions', source: 'core' },
  { id: 'sessions_send', label: 'sessions_send', description: 'Send to session', sectionId: 'sessions', source: 'core' },
  { id: 'sessions_spawn', label: 'sessions_spawn', description: 'Spawn sub-agent', sectionId: 'sessions', source: 'core' },
  { id: 'subagents', label: 'subagents', description: 'Manage sub-agents', sectionId: 'sessions', source: 'core' },
  { id: 'session_status', label: 'session_status', description: 'Session status', sectionId: 'sessions', source: 'core' },
  { id: 'browser', label: 'browser', description: 'Control web browser', sectionId: 'ui', source: 'core' },
  { id: 'canvas', label: 'canvas', description: 'Control canvases', sectionId: 'ui', source: 'core' },
  { id: 'message', label: 'message', description: 'Send messages', sectionId: 'messaging', source: 'core' },
  { id: 'cron', label: 'cron', description: 'Schedule tasks', sectionId: 'automation', source: 'core' },
  { id: 'gateway', label: 'gateway', description: 'Gateway control', sectionId: 'automation', source: 'core' },
  { id: 'nodes', label: 'nodes', description: 'Nodes + devices', sectionId: 'nodes', source: 'core' },
  { id: 'agents_list', label: 'agents_list', description: 'List agents', sectionId: 'agents', source: 'core' },
  { id: 'image', label: 'image', description: 'Image understanding', sectionId: 'media', source: 'core' },
  { id: 'tts', label: 'tts', description: 'Text-to-speech conversion', sectionId: 'media', source: 'core' },
];
const CORE_TOOL_IDS = CORE_TOOL_CATALOG.map((item) => item.id);

function parseJsonFromMixedOutput(stdout: string, stderr: string) {
  const directCandidates = [stdout.trim(), stderr.trim()].filter(Boolean);
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // ignore
    }
  }

  const extractFromLines = (text: string) => {
    const lines = text.split('\n');
    const startIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      return (
        trimmed === '{' ||
        trimmed === '[' ||
        trimmed.startsWith('{"') ||
        trimmed.startsWith('[{') ||
        trimmed.startsWith('["')
      );
    });

    if (startIndex === -1) return null;
    const candidateLines = lines.slice(startIndex);
    for (let end = candidateLines.length; end > 0; end--) {
      const candidate = candidateLines.slice(0, end).join('\n').trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // continue trimming tail lines
      }
    }
    return null;
  };

  return extractFromLines(stdout) || extractFromLines(stderr);
}

async function loadNativeAgents() {
  try {
    const { stdout, stderr } = await execFileAsync('openclaw', ['agents', 'list', '--json'], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseJsonFromMixedOutput(stdout, stderr);
    if (!Array.isArray(parsed)) return [] as NativeAgentSummary[];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          id: typeof row.id === 'string' ? row.id : '',
          name: typeof row.name === 'string' ? row.name : undefined,
          identityName: typeof row.identityName === 'string' ? row.identityName : undefined,
          identityEmoji: typeof row.identityEmoji === 'string' ? row.identityEmoji : undefined,
          identityAvatar: typeof row.identityAvatar === 'string' ? row.identityAvatar : undefined,
          workspace: typeof row.workspace === 'string' ? row.workspace : undefined,
          isDefault: !!row.isDefault,
        };
      })
      .filter((item) => item.id);
  } catch {
    return [] as NativeAgentSummary[];
  }
}

async function loadAvailableModels() {
  const commandVariants: string[][] = [
    ['model', 'list', '--json'],
    ['models', 'list', '--json'],
  ];

  try {
    let parsed: unknown = null;

    for (const args of commandVariants) {
      try {
        const { stdout, stderr } = await execFileAsync('openclaw', args, {
          cwd: process.cwd(),
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        parsed = parseJsonFromMixedOutput(stdout, stderr);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          break;
        }
      } catch {
        // Try the next command variant.
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [] as OpenClawModelSummary[];

    const modelsRaw = Array.isArray((parsed as Record<string, unknown>).models)
      ? (parsed as Record<string, unknown>).models as unknown[]
      : [];

    return modelsRaw
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          key: typeof row.key === 'string' ? row.key : '',
          name: typeof row.name === 'string' ? row.name : undefined,
          input: typeof row.input === 'string' ? row.input : undefined,
          contextWindow: typeof row.contextWindow === 'number' ? row.contextWindow : undefined,
          available: !!row.available,
          local: typeof row.local === 'boolean' ? row.local : undefined,
          tags: Array.isArray(row.tags)
            ? row.tags.map((tag) => String(tag)).filter(Boolean)
            : [],
        } as OpenClawModelSummary;
      })
      .filter((model) => model.key && model.available);
  } catch {
    return [] as OpenClawModelSummary[];
  }
}

function setDefaultAgentsInConfig(config: OpenClawConfig, targetIds: string[]) {
  const list = config.agents?.list;
  if (!Array.isArray(list)) return false;
  const target = new Set(targetIds);
  config.agents!.list = list.map((agent) => ({
    ...agent,
    default: target.has(agent.id),
  }));
  return true;
}

function normalizeToolList(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return Array.from(new Set(input.map((item) => String(item || '').trim()).filter(Boolean)));
}

function collectKnownTools(config: OpenClawConfig) {
  const known = new Set<string>(CORE_TOOL_IDS);
  const list = Array.isArray(config.agents?.list) ? config.agents.list : [];
  for (const agent of list) {
    const alsoAllow = normalizeToolList(agent?.tools?.alsoAllow);
    for (const toolName of alsoAllow) known.add(toolName);
  }
  return Array.from(known).sort((a, b) => a.localeCompare(b));
}

function buildToolCatalog(config: OpenClawConfig) {
  const catalog = new Map<string, ToolCatalogItem>(CORE_TOOL_CATALOG.map((item) => [item.id, item]));
  const knownTools = collectKnownTools(config);
  for (const toolId of knownTools) {
    if (catalog.has(toolId)) continue;
    catalog.set(toolId, {
      id: toolId,
      label: toolId,
      description: 'Detected from current OpenClaw agent allowlist.',
      sectionId: 'custom',
      source: 'detected',
    });
  }
  return Array.from(catalog.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedResource = (searchParams.get('resource') || searchParams.get('type') || '').trim();
    if (requestedResource === 'models') {
      const models = await loadAvailableModels();
      return NextResponse.json({ models });
    }

    const homedir = os.homedir();
    const configPath = path.join(homedir, '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      return NextResponse.json({ agents: [] });
    }
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as OpenClawConfig;
    
    const systemAgents = Array.isArray(config.agents?.list) ? config.agents.list : [];
    const configAgentMap = new Map<string, OpenClawAgent>(systemAgents.map((agent) => [agent.id, agent]));
    const nativeAgents = await loadNativeAgents();
    const sourceAgents: NativeAgentSummary[] = nativeAgents.length > 0
      ? nativeAgents
      : systemAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          workspace: agent.workspace,
          identityName: undefined,
          identityEmoji: undefined,
          identityAvatar: undefined,
          isDefault: !!agent.default,
        }));
    
    // We add icons based on some keywords or randomly just to keep the UI looking nice.
    const UI_AGENTS = sourceAgents.map((agent, index: number) => {
      // Pick a color based on index or default
      const colors = ['text-indigo-500', 'text-purple-500', 'text-blue-500', 'text-emerald-500', 'text-yellow-500', 'text-slate-500', 'text-sky-500', 'text-rose-500'];
      const configAgent = configAgentMap.get(agent.id);

      const configIdentity = (configAgent?.identity && typeof configAgent.identity === 'object')
        ? configAgent.identity
        : undefined;
      const avatarPath = (agent.identityAvatar || configIdentity?.avatar || configAgent?.avatar || '').trim();
      const avatarEmoji = (agent.identityEmoji || '').trim();
      const configName = agent.identityName || agent.name || configAgent?.name || agent.id;
      const isDefault = typeof agent.isDefault === 'boolean' ? agent.isDefault : !!configAgent?.default;
      
      // Default guess an icon name based on ID
      let iconName = 'Bot';
      if (agent.id.includes('architect')) iconName = 'Cpu';
      if (agent.id.includes('dev')) iconName = 'Code';
      if (agent.id.includes('test')) iconName = 'Zap';
      if (agent.id.includes('vision') || agent.id.includes('image')) iconName = 'ImageIcon';

      return {
        id: agent.id,
        name: configName,
        iconName: iconName,
        color: colors[index % colors.length],
        avatarEmoji: avatarEmoji || undefined,
        hasAvatarImage: !!avatarPath,
        isDefault,
        toolsAlsoAllow: normalizeToolList(configAgent?.tools?.alsoAllow),
      };
    });

    // Make sure we have at least one fallback agent if parsing failed but system has config
    if (UI_AGENTS.length === 0) {
      UI_AGENTS.push({
        id: 'main',
        name: '默认节点',
        iconName: 'Bot',
        color: 'text-indigo-500',
        avatarEmoji: undefined,
        hasAvatarImage: false,
        isDefault: true,
        toolsAlsoAllow: [],
      });
    }
    
    const toolCatalog = buildToolCatalog(config);
    return NextResponse.json({
      agents: UI_AGENTS,
      availableTools: toolCatalog.map((item) => item.id),
      toolCatalog,
    });
  } catch (error) {
    console.error('Failed to parse openclaw config:', error);
    return NextResponse.json(
      {
        agents: [{
          id: 'main',
          name: '系统节点',
          iconName: 'Bot',
          color: 'text-indigo-500',
          avatarEmoji: undefined,
          hasAvatarImage: false,
          isDefault: true,
          toolsAlsoAllow: [],
        }],
        availableTools: CORE_TOOL_IDS,
        toolCatalog: CORE_TOOL_CATALOG,
      }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const { agentId, alsoAllow, action, availableTools } = await req.json() as {
      agentId?: string;
      alsoAllow?: string[];
      action?: 'all-on' | 'all-off';
      availableTools?: string[];
    };

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const homedir = os.homedir();
    const configPath = path.join(homedir, '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as OpenClawConfig;
    const list = config.agents?.list;

    if (!Array.isArray(list)) {
      return NextResponse.json({ error: 'Invalid openclaw agent config' }, { status: 500 });
    }

    const index = list.findIndex((agent) => agent.id === agentId);
    if (index === -1) {
      return NextResponse.json({ error: `Agent not found: ${agentId}` }, { status: 404 });
    }

    const agent = list[index];
    const currentAlsoAllow = normalizeToolList(agent.tools?.alsoAllow);
    const knownTools = Array.from(new Set([...collectKnownTools(config), ...normalizeToolList(availableTools)]));

    let nextAlsoAllow: string[];
    if (action === 'all-off') {
      nextAlsoAllow = [];
    } else if (action === 'all-on') {
      nextAlsoAllow = knownTools;
    } else if (Array.isArray(alsoAllow)) {
      nextAlsoAllow = normalizeToolList(alsoAllow);
    } else {
      nextAlsoAllow = currentAlsoAllow;
    }

    list[index] = {
      ...agent,
      tools: {
        ...(agent.tools || {}),
        alsoAllow: nextAlsoAllow,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const refreshedContent = fs.readFileSync(configPath, 'utf8');
    const refreshedConfig = JSON.parse(refreshedContent) as OpenClawConfig;
    const refreshedCatalog = buildToolCatalog(refreshedConfig);

    return NextResponse.json({
      success: true,
      agentId,
      alsoAllow: nextAlsoAllow,
      availableTools: refreshedCatalog.map((item) => item.id),
      toolCatalog: refreshedCatalog,
    });
  } catch (error) {
    console.error('Failed to update agent tools allowlist:', error);
    return NextResponse.json({ error: 'Failed to update tools allowlist' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      agentId?: string;
      name?: string;
      workspace?: string;
      model?: string;
      bindings?: string[];
      setDefault?: boolean;
    };

    const agentId = (body.agentId || '').trim();
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      return NextResponse.json({ error: 'agentId must match /^[a-zA-Z0-9_-]+$/' }, { status: 400 });
    }

    const home = os.homedir();
    const configPath = path.join(home, '.openclaw', 'openclaw.json');
    const workspace = (body.workspace || '').trim() || path.join(home, '.openclaw', `workspace-${agentId}`);
    const model = (body.model || '').trim();
    const bindings = (Array.isArray(body.bindings) ? body.bindings : []).map((item) => String(item).trim()).filter(Boolean);

    const args = ['agents', 'add', agentId, '--non-interactive', '--workspace', workspace, '--json'];
    if (model) {
      args.push('--model', model);
    }
    for (const bind of bindings) {
      args.push('--bind', bind);
    }

    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      cwd: process.cwd(),
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });

    const created = parseJsonFromMixedOutput(stdout, stderr);
    if (!created || typeof created !== 'object' || Array.isArray(created)) {
      return NextResponse.json({ error: 'Failed to parse openclaw agents add output' }, { status: 502 });
    }

    const displayName = (body.name || '').trim();
    if (displayName && displayName !== agentId) {
      await execFileAsync('openclaw', ['agents', 'set-identity', '--agent', agentId, '--name', displayName, '--json'], {
        cwd: process.cwd(),
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      });
    }

    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(content) as OpenClawConfig;
      if (body.setDefault && setDefaultAgentsInConfig(config, [agentId])) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      }
    }

    return NextResponse.json({ success: true, created });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to create agent:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { agentId } = await req.json() as { agentId?: string };
    const normalizedAgentId = (agentId || '').trim();
    if (!normalizedAgentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as OpenClawConfig;
    const list = config.agents?.list;
    if (!Array.isArray(list) || !list.some((agent) => agent.id === normalizedAgentId)) {
      return NextResponse.json({ error: `Agent not found: ${normalizedAgentId}` }, { status: 404 });
    }

    if (!setDefaultAgentsInConfig(config, [normalizedAgentId])) {
      return NextResponse.json({ error: 'Invalid openclaw agent config' }, { status: 500 });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return NextResponse.json({ success: true, defaultAgentId: normalizedAgentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = (searchParams.get('agentId') || '').trim();
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const { stdout, stderr } = await execFileAsync('openclaw', ['agents', 'delete', agentId, '--force', '--json'], {
      cwd: process.cwd(),
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });

    const deleted = parseJsonFromMixedOutput(stdout, stderr);
    if (!deleted || typeof deleted !== 'object' || Array.isArray(deleted)) {
      return NextResponse.json({ error: 'Failed to parse openclaw agents delete output' }, { status: 502 });
    }

    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to delete agent:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}