import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

type OpenClawAgent = {
  id: string;
  name?: string;
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
};

type OpenClawConfig = {
  agents?: {
    list?: OpenClawAgent[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const CAPABILITY_TOOL_MAP: Record<keyof AgentCapabilities, string[]> = {
  read: ['read'],
  write: ['write', 'edit', 'apply_patch'],
  exec: ['exec', 'process'],
  invite: ['subagents', 'agents_list'],
};

function getCapabilitiesFromOpenClawTools(agent: OpenClawAgent) {
  const alsoAllow: string[] = agent?.tools?.alsoAllow || [];
  return {
    read: alsoAllow.includes('read'),
    write: alsoAllow.includes('write') || alsoAllow.includes('edit') || alsoAllow.includes('apply_patch'),
    exec: alsoAllow.includes('exec') || alsoAllow.includes('process'),
    invite: alsoAllow.includes('subagents') || alsoAllow.includes('agents_list'),
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
    
    // Convert openclaw agent list into our front-end structure
    const systemAgents = config.agents?.list || [];
    
    // We add icons based on some keywords or randomly just to keep the UI looking nice.
    const UI_AGENTS = systemAgents.map((agent: OpenClawAgent, index: number) => {
      // Pick a color based on index or default
      const colors = ['text-indigo-500', 'text-purple-500', 'text-blue-500', 'text-emerald-500', 'text-yellow-500', 'text-slate-500', 'text-sky-500', 'text-rose-500'];
      
      const configName = agent.name || agent.id;
      
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
        capabilities: getCapabilitiesFromOpenClawTools(agent),
      };
    });

    // Make sure we have at least one fallback agent if parsing failed but system has config
    if (UI_AGENTS.length === 0) {
      UI_AGENTS.push({
        id: 'main',
        name: '默认节点',
        iconName: 'Bot',
        color: 'text-indigo-500',
        capabilities: { read: true, write: true, exec: false, invite: false },
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
          capabilities: { read: true, write: true, exec: false, invite: false },
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