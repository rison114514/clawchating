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
  clawchating?: {
    skillsEnabled?: boolean;
    [key: string]: unknown;
  };
  tools?: {
    alsoAllow?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type AgentCapabilities = {
  read: boolean;
  write: boolean;
  exec: boolean;
  invite: boolean;
  skills: boolean;
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

const execFileAsync = promisify(execFile);

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

const CAPABILITY_TOOL_MAP: Record<keyof AgentCapabilities, string[]> = {
  read: ['read'],
  write: ['write', 'edit', 'apply_patch'],
  exec: ['exec', 'process'],
  invite: ['subagents', 'agents_list'],
  skills: ['skills'],
};

function getCapabilitiesFromOpenClawTools(agent: OpenClawAgent | undefined, config?: OpenClawConfig) {
  if (!agent) {
    return {
      read: true,
      write: true,
      exec: false,
      invite: false,
      skills: config?.commands?.nativeSkills !== 'off',
    };
  }
  const alsoAllow: string[] = agent?.tools?.alsoAllow || [];
  const globalNativeSkills = config?.commands?.nativeSkills;
  const globalSkillsEnabled = globalNativeSkills !== 'off';
  const agentSkillsEnabled = typeof agent?.clawchating?.skillsEnabled === 'boolean'
    ? agent.clawchating.skillsEnabled
    : undefined;
  return {
    read: alsoAllow.includes('read'),
    write: alsoAllow.includes('write') || alsoAllow.includes('edit') || alsoAllow.includes('apply_patch'),
    exec: alsoAllow.includes('exec') || alsoAllow.includes('process'),
    invite: alsoAllow.includes('subagents') || alsoAllow.includes('agents_list'),
    skills: agentSkillsEnabled ?? (alsoAllow.includes('skills') || globalSkillsEnabled),
  };
}

function applyCapabilitiesToAlsoAllow(existing: string[], capabilities: AgentCapabilities) {
  const next = new Set(existing);

  for (const capability of Object.keys(CAPABILITY_TOOL_MAP) as Array<keyof AgentCapabilities>) {
    for (const toolName of CAPABILITY_TOOL_MAP[capability]) {
      next.delete(toolName);
    }
    if (capabilities[capability]) {
      for (const toolName of CAPABILITY_TOOL_MAP[capability]) {
        next.add(toolName);
      }
    }
  }

  return Array.from(next);
}

export async function GET() {
  try {
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
        capabilities: getCapabilitiesFromOpenClawTools(configAgent, config),
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
        capabilities: { read: true, write: true, exec: false, invite: false, skills: true },
      });
    }
    
    return NextResponse.json({ agents: UI_AGENTS });
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
          capabilities: { read: true, write: true, exec: false, invite: false, skills: true },
        }],
      }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const { agentId, capabilities } = await req.json() as {
      agentId?: string;
      capabilities?: Partial<AgentCapabilities>;
    };

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const normalizedCapabilities: AgentCapabilities = {
      read: !!capabilities?.read,
      write: !!capabilities?.write,
      exec: !!capabilities?.exec,
      invite: !!capabilities?.invite,
      skills: !!capabilities?.skills,
    };

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
    const currentAlsoAllow = Array.isArray(agent.tools?.alsoAllow) ? agent.tools?.alsoAllow : [];
    const nextAlsoAllow = applyCapabilitiesToAlsoAllow(currentAlsoAllow, normalizedCapabilities);

    list[index] = {
      ...agent,
      clawchating: {
        ...(((agent as OpenClawAgent).clawchating || {}) as Record<string, unknown>),
        skillsEnabled: normalizedCapabilities.skills,
      },
      tools: {
        ...(agent.tools || {}),
        alsoAllow: nextAlsoAllow,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    return NextResponse.json({ success: true, agentId, capabilities: normalizedCapabilities });
  } catch (error) {
    console.error('Failed to update agent capabilities:', error);
    return NextResponse.json({ error: 'Failed to update capabilities' }, { status: 500 });
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
    const preConfig = fs.existsSync(configPath)
      ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as OpenClawConfig)
      : ({} as OpenClawConfig);
    const previousDefaultIds = Array.isArray(preConfig.agents?.list)
      ? preConfig.agents!.list.filter((agent) => !!agent.default).map((agent) => agent.id)
      : [];

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
      const targetIds = body.setDefault ? [agentId] : previousDefaultIds;
      if (setDefaultAgentsInConfig(config, targetIds)) {
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