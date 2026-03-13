import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

const openclaw = createOpenAI({
  baseURL: 'http://127.0.0.1:18789/v1',
  apiKey: '94f85e69781806263838f80b1f89979c4af251b01d0a7530',
});

export const maxDuration = 120;

export async function POST(req: Request) {
  const { messages, agentId, channelId, sessionType, groupId, groupMembers, capabilities = { read: true, write: true, exec: false } } = await req.json();

  const workspaceFolderName = sessionType === 'group' ? groupId : channelId || 'default-workspace';
  const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
  
  await fs.mkdir(workspaceDir, { recursive: true });

  const systemInstructions = `
你是 OpenClaw 集群中的一个 AI Agent，当前身份是: ${agentId}。
你正在 ${sessionType === 'group' ? '群组协作' : '单人独立'} 模式下工作。
当前所处的业务频道(Channel)是: ${channelId}。
${sessionType === 'group' ? `你有群组伙伴: ${groupMembers?.join(', ')}。` : ''}

【工作区权限】
你的权限经过平台限制，当前是否拥有读取文件权限：${capabilities.read ? '是' : '否'}。
是否拥有写入文件权限：${capabilities.write ? '是' : '否'}。
是否拥有执行命令权限：${capabilities.exec ? '是' : '否'}。

你在群组共享的本地工作夹是：${workspaceFolderName}。
如果拥有相应权限，请积极使用工具辅助用户。工具无需传绝对路径，传相对路径即可。
`;

  let agentTools: any = {};

  if (capabilities.invite && sessionType === 'group' && groupId) {
    agentTools.invite_agent = tool({
      description: 'Invite another agent to the current group chat by their agent ID. Only use this if you know the exact ID of the agent.',
      parameters: z.object({ newAgentId: z.string() }),
      execute: async ({ newAgentId }) => {
        try {
          const groupsPath = path.join(process.cwd(), 'workspaces', 'groups.json');
          const data = await fs.readFile(groupsPath, 'utf-8');
          const groups = JSON.parse(data);
          const groupIndex = groups.findIndex((g: any) => g.id === groupId);
          if (groupIndex === -1) return `Error: Group not found.`;
          
          if (!groups[groupIndex].members.includes(newAgentId)) {
            // we could verify the agent id, but assuming it exists
            groups[groupIndex].members.push(newAgentId);
            await fs.writeFile(groupsPath, JSON.stringify(groups, null, 2));
            return `Successfully invited agent ${newAgentId} to the group. `;
          } else {
            return `Agent ${newAgentId} is already in the group.`;
          }
        } catch (e: any) { return `Error: ${e.message}`; }
      }
    });
  }


  if (capabilities.read) {
    agentTools.read_file = tool({
      description: 'Read the contents of a file in your current workspace.',
      parameters: z.object({ filename: z.string() }),
      execute: async ({ filename }) => {
        try { return await fs.readFile(path.join(workspaceDir, filename), 'utf8'); } 
        catch (e: any) { return `Error: ${e.message}`; }
      },
    });
    agentTools.list_files = tool({
      description: 'List all existing files in the current workspace.',
      parameters: z.object({}),
      execute: async () => {
        try { const files = await fs.readdir(workspaceDir); return files.length ? files.join('\n') : 'Workspace is empty.'; } 
        catch (e: any) { return `Error: ${e.message}`; }
      },
    });
  }

  if (capabilities.write) {
    agentTools.write_file = tool({
      description: 'Write or overwrite a file in your workspace.',
      parameters: z.object({ filename: z.string(), content: z.string() }),
      execute: async ({ filename, content }) => {
        try {
          const targetPath = path.join(workspaceDir, filename);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return `Successfully wrote to ${filename}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      },
    });
  }

  if (capabilities.exec) {
    agentTools.execute_command = tool({
      description: 'Execute a bash/shell command in the workspace.',
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          const { exec } = await import('child_process');
          const util = await import('util');
          const { stdout, stderr } = await util.promisify(exec)(command, { cwd: workspaceDir, timeout: 10000 });
          return (stdout ? `STDOUT:\n${stdout}\n` : '') + (stderr ? `STDERR:\n${stderr}\n` : '') || 'Command executed successfully.';
        } catch (e: any) { return `Error Executing ${command}: ${e.message}`; }
      },
    });
  }

  const processedMessages = messages.map((m: any) => ({
    ...m,
    content: (m.role === 'assistant' && m.name) ? `[By Agent: ${m.name}]\n${m.content}` : m.content
  }));

  const result = await streamText({
    model: openclaw(agentId || 'main'),
    messages: processedMessages,
    system: systemInstructions,
    tools: Object.keys(agentTools).length > 0 ? agentTools : undefined,
  });

  return result.toDataStreamResponse();
}
