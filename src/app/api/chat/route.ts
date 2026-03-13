import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';

const openclawGateway = createOpenAI({
  baseURL: 'http://127.0.0.1:18789/v1',
  apiKey: process.env.OPENCLAW_API_KEY,
});

export const maxDuration = 120;

type AgentCapabilities = {
  read: boolean;
  write: boolean;
  exec: boolean;
  invite: boolean;
};

type OpenClawAgent = {
  id: string;
  name?: string;
  model?: string | { primary?: string };
  tools?: {
    alsoAllow?: string[];
  };
};

type OpenClawProvider = {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id?: string }>;
};

type OpenClawConfig = {
  models?: {
    providers?: Record<string, OpenClawProvider>;
  };
  agents?: {
    defaults?: {
      model?: string | { primary?: string };
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

type MessageLike = {
  role?: string;
  content?: unknown;
  name?: string;
  [key: string]: unknown;
};

type StreamTools = NonNullable<Parameters<typeof streamText>[0]['tools']>;

const DEFAULT_CAPABILITIES: AgentCapabilities = { read: true, write: true, exec: false, invite: false };

function getCapabilitiesFromOpenClawTools(agentConfig: OpenClawAgent | undefined): AgentCapabilities {
  const alsoAllow: string[] = agentConfig?.tools?.alsoAllow || [];
  return {
    read: alsoAllow.includes('read'),
    write: alsoAllow.includes('write') || alsoAllow.includes('edit') || alsoAllow.includes('apply_patch'),
    exec: alsoAllow.includes('exec') || alsoAllow.includes('process'),
    invite: alsoAllow.includes('subagents') || alsoAllow.includes('agents_list'),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getPrimaryModelRef(model: string | { primary?: string } | undefined) {
  if (!model) return '';
  if (typeof model === 'string') return model;
  return model.primary || '';
}

function parseModelRef(modelRef: string) {
  const idx = modelRef.indexOf('/');
  if (idx === -1) {
    return { providerId: '', modelId: modelRef };
  }
  return {
    providerId: modelRef.slice(0, idx),
    modelId: modelRef.slice(idx + 1),
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
}

function resolveUpstreamModel(config: OpenClawConfig, agent: OpenClawAgent | undefined) {
  const modelRef = getPrimaryModelRef(agent?.model) || getPrimaryModelRef(config?.agents?.defaults?.model);
  if (!modelRef) return null;

  const { providerId, modelId } = parseModelRef(modelRef);
  if (!providerId || !modelId) return null;

  const provider = config.models?.providers?.[providerId];
  if (!provider?.baseUrl) return null;

  const resolvedModelId = modelId || provider.models?.[0]?.id;
  if (!resolvedModelId) return null;

  return {
    baseURL: normalizeBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey || process.env.OPENCLAW_API_KEY || '',
    modelId: resolvedModelId,
  };
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

export async function POST(req: Request) {
  const {
    messages,
    agentId,
    channelId,
    sessionType,
    groupId,
    groupMembers,
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

  const resolvedAgentConfig = agentMap.get(requestedAgentId);
  const resolvedAgentDisplayName = resolvedAgentConfig?.name || requestedAgentId;
  const openClawCapabilities = resolvedAgentConfig ? getCapabilitiesFromOpenClawTools(resolvedAgentConfig) : DEFAULT_CAPABILITIES;
  const effectiveCapabilities: AgentCapabilities = {
    read: !!capabilities?.read && openClawCapabilities.read,
    write: !!capabilities?.write && openClawCapabilities.write,
    exec: !!capabilities?.exec && openClawCapabilities.exec,
    invite: !!capabilities?.invite && openClawCapabilities.invite,
  };

  const workspaceFolderName = sessionType === 'group' ? groupId : channelId || 'default-workspace';
  const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
  
  await fs.mkdir(workspaceDir, { recursive: true });

  const systemInstructions = `
你是 OpenClaw 集群中的一个 AI Agent，当前身份是: ${requestedAgentId}。
你的展示名称是: ${resolvedAgentDisplayName}。
你正在 ${sessionType === 'group' ? '群组协作' : '单人独立'} 模式下工作。
当前所处的业务频道(Channel)是: ${channelId}。
${sessionType === 'group' ? `你有群组伙伴: ${groupMembers?.join(', ')}。` : ''}

【工作区权限】
你的权限经过平台限制，当前是否拥有读取文件权限：${effectiveCapabilities.read ? '是' : '否'}。
是否拥有写入文件权限：${effectiveCapabilities.write ? '是' : '否'}。
是否拥有执行命令权限：${effectiveCapabilities.exec ? '是' : '否'}。

你在群组共享的本地工作夹是：${workspaceFolderName}。
如果拥有相应权限，请积极使用工具辅助用户。工具无需传绝对路径，传相对路径即可。
`;

  const agentTools: StreamTools = {};

  if (effectiveCapabilities.invite && sessionType === 'group' && groupId) {
    agentTools.invite_agent = tool({
      description: 'Invite another agent to the current group chat by their agent ID. Only use this if you know the exact ID of the agent.',
      parameters: z.object({ newAgentId: z.string() }),
      execute: async ({ newAgentId }) => {
        try {
          const groupsPath = path.join(process.cwd(), 'workspaces', 'groups.json');
          const data = await fs.readFile(groupsPath, 'utf-8');
          const groups = JSON.parse(data) as GroupRecord[];
          const groupIndex = groups.findIndex((g) => g.id === groupId);
          if (groupIndex === -1) return `Error: Group not found.`;
          
          if (!groups[groupIndex].members.includes(newAgentId)) {
            // we could verify the agent id, but assuming it exists
            groups[groupIndex].members.push(newAgentId);
            await fs.writeFile(groupsPath, JSON.stringify(groups, null, 2));
            return `Successfully invited agent ${newAgentId} to the group. `;
          } else {
            return `Agent ${newAgentId} is already in the group.`;
          }
        } catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      }
    });
  }


  if (effectiveCapabilities.read) {
    agentTools.read_file = tool({
      description: 'Read the contents of a file in your current workspace.',
      parameters: z.object({ filename: z.string() }),
      execute: async ({ filename }) => {
        try { return await fs.readFile(path.join(workspaceDir, filename), 'utf8'); } 
        catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
    agentTools.list_files = tool({
      description: 'List all existing files in the current workspace.',
      parameters: z.object({}),
      execute: async () => {
        try { const files = await fs.readdir(workspaceDir); return files.length ? files.join('\n') : 'Workspace is empty.'; } 
        catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
  }

  if (effectiveCapabilities.write) {
    agentTools.write_file = tool({
      description: 'Write or overwrite a file in your workspace.',
      parameters: z.object({ filename: z.string(), content: z.string() }),
      execute: async ({ filename, content }) => {
        try {
          const targetPath = path.join(workspaceDir, filename);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return `Successfully wrote to ${filename}`;
        } catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
  }

  if (effectiveCapabilities.exec) {
    agentTools.execute_command = tool({
      description: 'Execute a bash/shell command in the workspace.',
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          const { exec } = await import('child_process');
          const util = await import('util');
          const { stdout, stderr } = await util.promisify(exec)(command, { cwd: workspaceDir, timeout: 10000 });
          return (stdout ? `STDOUT:\n${stdout}\n` : '') + (stderr ? `STDERR:\n${stderr}\n` : '') || 'Command executed successfully.';
        } catch (e: unknown) { return `Error Executing ${command}: ${getErrorMessage(e)}`; }
      },
    });
  }

  const processedMessages = (Array.isArray(messages) ? messages : []).map((m: MessageLike) => ({
    ...m,
    content: (m.role === 'assistant' && m.name)
      ? `[By Agent: ${m.name}]\n${typeof m.content === 'string' ? m.content : ''}`
      : m.content
  }));

  const streamMessages = processedMessages as NonNullable<Parameters<typeof streamText>[0]['messages']>;

  const result = await streamText({
    model: (() => {
      const upstream = resolveUpstreamModel(openClawConfig, resolvedAgentConfig);
      if (upstream) {
        const upstreamClient = createOpenAI({
          baseURL: upstream.baseURL,
          apiKey: upstream.apiKey,
        });
        return upstreamClient(upstream.modelId);
      }

      // Fallback to local OpenClaw gateway mode when upstream model mapping is unavailable.
      return openclawGateway(requestedAgentId);
    })(),
    messages: streamMessages,
    system: systemInstructions,
    tools: Object.keys(agentTools).length > 0 ? agentTools : undefined,
  });

  return result.toDataStreamResponse();
}
