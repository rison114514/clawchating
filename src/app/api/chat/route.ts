import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  appendSessionMessage,
  ensureAgentSession,
  initializeGroupSessions,
  loadSessionMessages,
  resolvePeerId,
  toSemanticInput,
} from '@/lib/session-runtime';

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

type OpenClawProvider = {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id?: string }>;
};

type OpenClawConfig = {
  commands?: {
    nativeSkills?: 'on' | 'off' | 'auto' | string;
  };
  models?: {
    providers?: Record<string, OpenClawProvider>;
  };
  agents?: {
    defaults?: {
      workspace?: string;
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

type GenerateTools = NonNullable<Parameters<typeof generateText>[0]['tools']>;

type OpenClawSkill = {
  name: string;
  description?: string;
  eligible?: boolean;
  filePath?: string;
};

const execFileAsync = promisify(execFile);

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
    inputText,
    agentId,
    channelId,
    sessionType,
    groupId,
    groupMembers,
    senderId,
    senderName,
    autoMentionName,
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
  const openClawCapabilities = resolvedAgentConfig
    ? getCapabilitiesFromOpenClawTools(resolvedAgentConfig, openClawConfig)
    : DEFAULT_CAPABILITIES;
  const effectiveCapabilities: AgentCapabilities = {
    read: !!capabilities?.read && openClawCapabilities.read,
    write: !!capabilities?.write && openClawCapabilities.write,
    exec: !!capabilities?.exec && openClawCapabilities.exec,
    invite: !!capabilities?.invite && openClawCapabilities.invite,
    skills: !!capabilities?.skills && openClawCapabilities.skills,
  };

  const workspaceFolderName = sessionType === 'group'
    ? (groupId || channelId || 'default-workspace')
    : (channelId || 'default-workspace');
  const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
  const agentWorkspaceDir = resolvedAgentConfig?.workspace
    || openClawConfig?.agents?.defaults?.workspace
    || workspaceDir;
  
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(agentWorkspaceDir, { recursive: true });

  const resolveScopeDir = (scope?: 'shared' | 'agent') => (scope === 'agent' ? agentWorkspaceDir : workspaceDir);

  const resolveScopedPath = (filename: string, scope?: 'shared' | 'agent') => {
    const baseDir = resolveScopeDir(scope);
    const baseResolved = path.resolve(baseDir);
    const targetPath = path.resolve(baseDir, filename);
    if (targetPath !== baseResolved && !targetPath.startsWith(`${baseResolved}${path.sep}`)) {
      throw new Error('Path escapes workspace root.');
    }
    return targetPath;
  };

  if (sessionType === 'group' && groupId && Array.isArray(groupMembers) && groupMembers.length > 0) {
    await initializeGroupSessions({
      groupId,
      channelId: channelId || 'default',
      ownerUserId: typeof senderId === 'string' ? senderId : undefined,
      ownerName: typeof senderName === 'string' ? senderName : undefined,
      memberAgentIds: groupMembers,
    });
  }

  const peerId = resolvePeerId(typeof senderId === 'string' ? senderId : undefined, channelId);
  const session = await ensureAgentSession({
    agentId: requestedAgentId,
    peerId,
    senderLabel: typeof senderName === 'string' && senderName.trim() ? senderName : 'Clawchating User',
  });

  const eligibleSkills = effectiveCapabilities.skills ? await listEligibleSkills() : [];
  const skillTips = eligibleSkills
    .slice(0, 16)
    .map((s) => `- ${s.name}: ${(s.description || '').replace(/\s+/g, ' ').trim().slice(0, 140)}`)
    .join('\n');

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
是否拥有原生技能权限：${effectiveCapabilities.skills ? '是' : '否'}。

你在群组共享的本地工作夹是：${workspaceFolderName}。
你自己的 Agent 工作区目录是：${agentWorkspaceDir}。
工具支持 scope 参数：shared 表示群组共享工作区，agent 表示你自己的 Agent 工作区。
如果拥有相应权限，请积极使用工具辅助用户。工具无需传绝对路径，传相对路径即可。

【OpenClaw 原生 Skills】
${effectiveCapabilities.skills ? `你可以调用 list_native_skills / read_native_skill / use_native_skill。\n可用技能(节选):\n${skillTips || '- 无可用技能'}\n当任务明显匹配某个技能时，优先触发对应技能。` : '当前已禁用原生技能。'}
`;

  const agentTools: GenerateTools = {};

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
      description: 'Read a file. scope="shared" reads from shared workspace; scope="agent" reads from your personal agent workspace.',
      parameters: z.object({ filename: z.string(), scope: z.enum(['shared', 'agent']).optional() }),
      execute: async ({ filename, scope }) => {
        try {
          const targetPath = resolveScopedPath(filename, scope);
          return await fs.readFile(targetPath, 'utf8');
        }
        catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
    agentTools.list_files = tool({
      description: 'List files. scope can be shared, agent, or both (default both).',
      parameters: z.object({ scope: z.enum(['shared', 'agent', 'both']).optional() }),
      execute: async ({ scope }) => {
        try {
          if (scope === 'shared') {
            const files = await fs.readdir(workspaceDir);
            return files.length ? files.join('\n') : 'Shared workspace is empty.';
          }
          if (scope === 'agent') {
            const files = await fs.readdir(agentWorkspaceDir);
            return files.length ? files.join('\n') : 'Agent workspace is empty.';
          }

          const [sharedFiles, agentFiles] = await Promise.all([
            fs.readdir(workspaceDir).catch(() => [] as string[]),
            fs.readdir(agentWorkspaceDir).catch(() => [] as string[]),
          ]);

          const sharedText = sharedFiles.length ? sharedFiles.join('\n') : '(empty)';
          const agentText = agentFiles.length ? agentFiles.join('\n') : '(empty)';
          return `# shared\n${sharedText}\n\n# agent\n${agentText}`;
        }
        catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
  }

  if (effectiveCapabilities.write) {
    agentTools.write_file = tool({
      description: 'Write a file. scope="shared" writes to shared workspace; scope="agent" writes to your personal agent workspace.',
      parameters: z.object({ filename: z.string(), content: z.string(), scope: z.enum(['shared', 'agent']).optional() }),
      execute: async ({ filename, content, scope }) => {
        try {
          const targetPath = resolveScopedPath(filename, scope);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return `Successfully wrote to ${filename} (${scope === 'agent' ? 'agent' : 'shared'})`;
        } catch (e: unknown) { return `Error: ${getErrorMessage(e)}`; }
      },
    });
  }

  if (effectiveCapabilities.exec) {
    agentTools.execute_command = tool({
      description: 'Execute a bash/shell command. scope="shared" runs in shared workspace; scope="agent" runs in your personal agent workspace.',
      parameters: z.object({ command: z.string(), scope: z.enum(['shared', 'agent']).optional() }),
      execute: async ({ command, scope }) => {
        try {
          const { exec } = await import('child_process');
          const util = await import('util');
          const cwd = resolveScopeDir(scope);
          const { stdout, stderr } = await util.promisify(exec)(command, { cwd, timeout: 10000 });
          return (stdout ? `STDOUT:\n${stdout}\n` : '') + (stderr ? `STDERR:\n${stderr}\n` : '') || 'Command executed successfully.';
        } catch (e: unknown) { return `Error Executing ${command}: ${getErrorMessage(e)}`; }
      },
    });
  }

  if (effectiveCapabilities.skills) {
    agentTools.list_native_skills = tool({
      description: 'List current OpenClaw native skills available for this runtime.',
      parameters: z.object({}),
      execute: async () => {
        try {
          const lines = eligibleSkills.map((skill) => {
            const desc = (skill.description || '').replace(/\s+/g, ' ').trim();
            return `- ${skill.name}${desc ? `: ${desc}` : ''}`;
          });
          return lines.length ? lines.join('\n') : 'No eligible native skills found.';
        } catch (e: unknown) {
          return `Error: ${getErrorMessage(e)}`;
        }
      },
    });

    agentTools.read_native_skill = tool({
      description: 'Read one native OpenClaw skill details and SKILL.md content by skill name.',
      parameters: z.object({ skillName: z.string() }),
      execute: async ({ skillName }) => {
        try {
          const detail = await runOpenClawJson(['skills', 'info', skillName, '--json'], 20000);
          const filePath = typeof detail.filePath === 'string' ? detail.filePath : '';
          let skillMd = '';
          if (filePath) {
            try {
              skillMd = await fs.readFile(filePath, 'utf8');
            } catch {
              skillMd = '';
            }
          }

          const summary = {
            name: typeof detail.name === 'string' ? detail.name : skillName,
            description: typeof detail.description === 'string' ? detail.description : '',
            eligible: !!detail.eligible,
            source: typeof detail.source === 'string' ? detail.source : '',
            filePath,
          };

          const truncated = skillMd.length > 30000 ? `${skillMd.slice(0, 30000)}\n\n[Truncated]` : skillMd;
          return `${JSON.stringify(summary, null, 2)}\n\n--- SKILL.md ---\n${truncated || '(skill file not found or empty)'}`;
        } catch (e: unknown) {
          return `Error: ${getErrorMessage(e)}`;
        }
      },
    });

    agentTools.use_native_skill = tool({
      description: 'Delegate a subtask to OpenClaw native agent runtime (with native skills pipeline) and return result text.',
      parameters: z.object({
        task: z.string(),
        skillHint: z.string().optional(),
      }),
      execute: async ({ task, skillHint }) => {
        try {
          const delegatedPrompt = skillHint
            ? `[SkillHint: ${skillHint}]\n${task}`
            : task;
          const data = await runOpenClawJson(
            ['agent', '--agent', requestedAgentId, '--session-id', session.sessionKey, '--message', delegatedPrompt, '--json', '--timeout', '120'],
            125000
          );

          const result = (data.result && typeof data.result === 'object') ? (data.result as Record<string, unknown>) : {};
          const payloads = Array.isArray(result.payloads) ? result.payloads : [];
          const text = payloads
            .map((item) => {
              if (!item || typeof item !== 'object') return '';
              const record = item as Record<string, unknown>;
              return typeof record.text === 'string' ? record.text : '';
            })
            .filter(Boolean)
            .join('\n');

          if (text) return text;
          return JSON.stringify(data, null, 2);
        } catch (e: unknown) {
          return `Error: ${getErrorMessage(e)}`;
        }
      },
    });
  }

  const history = await loadSessionMessages({ agentId: requestedAgentId, sessionKey: session.sessionKey, limit: 24 });
  const semanticInput = toSemanticInput({
    senderId: peerId,
    senderName: typeof senderName === 'string' && senderName.trim() ? senderName : 'Clawchating User',
    rawText: typeof inputText === 'string' ? inputText : '',
    autoMentionName: typeof autoMentionName === 'string' ? autoMentionName : undefined,
  });

  await appendSessionMessage({
    agentId: requestedAgentId,
    sessionId: session.sessionId,
    role: 'user',
    content: semanticInput.text,
  });

  const historyMessages = history.map((m: MessageLike) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content:
      m.role === 'assistant' && m.name
        ? `[By Agent: ${m.name}]\n${typeof m.content === 'string' ? m.content : ''}`
        : typeof m.content === 'string'
          ? m.content
          : '',
  })) as NonNullable<Parameters<typeof generateText>[0]['messages']>;

  const promptMessages = [
    ...historyMessages,
    { role: 'user' as const, content: semanticInput.text },
  ] as NonNullable<Parameters<typeof generateText>[0]['messages']>;

  const response = await generateText({
    model: (() => {
      const upstream = resolveUpstreamModel(openClawConfig, resolvedAgentConfig);
      if (upstream) {
        const upstreamClient = createOpenAI({
          baseURL: upstream.baseURL,
          apiKey: upstream.apiKey,
        });
        return upstreamClient(upstream.modelId);
      }
      return openclawGateway(requestedAgentId);
    })(),
    messages: promptMessages,
    system: systemInstructions,
    tools: Object.keys(agentTools).length > 0 ? agentTools : undefined,
    maxSteps: 6,
  });

  await appendSessionMessage({
    agentId: requestedAgentId,
    sessionId: session.sessionId,
    role: 'assistant',
    content: response.text,
    name: requestedAgentId,
  });

  return new Response(
    JSON.stringify({
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      message: {
        id: `${Date.now()}`,
        role: 'assistant',
        content: response.text,
        name: requestedAgentId,
      },
      usage: response.usage,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
