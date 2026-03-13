import fs from 'fs/promises';
import path from 'path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const openclaw = createOpenAI({
  baseURL: 'http://127.0.0.1:18789/v1',
  apiKey: process.env.OPENCLAW_API_KEY,
});

let isRunning = false;

export function startCronDaemon() {
  if (isRunning) return;
  isRunning = true;
  console.log('[Cron Daemon] Started background cron engine...');
  
  // Check every 30 seconds
  setInterval(async () => {
    try {
      const cronsPath = path.join(process.cwd(), 'workspaces', 'crons.json');
      let crons = [];
      try {
        const data = await fs.readFile(cronsPath, 'utf-8');
        crons = JSON.parse(data);
      } catch (e) {
        // File might not exist, ignore
        return;
      }

      if (!crons || crons.length === 0) return;

      let changed = false;
      const now = Date.now();

      for (const cron of crons) {
        if (cron.active && now - cron.lastRun >= cron.intervalMin * 60000) {
          changed = true;
          cron.lastRun = now;
          console.log(`[Cron Daemon] Triggering task ${cron.id} for agent ${cron.agentId}`);
          
          // Trigger the bot asynchronously
          executeTask(cron).catch(e => console.error(`[Cron Daemon] Error executing cron ${cron.id}:`, e));
        }
      }

      if (changed) {
        await fs.writeFile(cronsPath, JSON.stringify(crons, null, 2));
      }
    } catch (e) {
      console.error('[Cron Daemon] Main loop error:', e);
    }
  }, 30000);
}

async function executeTask(cron: any) {
  const workspaceFolderName = cron.groupId;
  const workspaceDir = path.join(process.cwd(), 'workspaces', workspaceFolderName);
  
  await fs.mkdir(workspaceDir, { recursive: true });

  const systemInstructions = `
你是 OpenClaw 集群中的一个 AI Agent，当前身份是: ${cron.agentId}。
你现在正在后台执行【定时任务】。
当前所处的共享业务频道/群组是: ${cron.groupId}。

【工作区权限】
你正在专门的后台运行时被赋予了本地工作夹：${workspaceFolderName} 的全权操作。
你拥有读取文件、写入文件和执行命令的权限。

由于你是后台定时触发的，用户此时可能不在屏幕前。
请将你的工作成果、总结或发现记录在内存文件 (memory.md) 或创建新的报告文件中，以便用户之后查看。
`;

  const agentTools = {
    read_file: tool({
      description: 'Read the contents of a file in your current workspace.',
      parameters: z.object({ filename: z.string() }),
      execute: async ({ filename }) => {
        try { return await fs.readFile(path.join(workspaceDir, filename), 'utf8'); } 
        catch (e: any) { return `Error: ${e.message}`; }
      },
    }),
    write_file: tool({
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
    }),
    execute_command: tool({
      description: 'Execute a bash/shell command in the workspace.',
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          const { exec } = await import('child_process');
          const util = await import('util');
          const { stdout, stderr } = await util.promisify(exec)(command, { cwd: workspaceDir, timeout: 30000 });
          return (stdout ? `STDOUT:\n${stdout}\n` : '') + (stderr ? `STDERR:\n${stderr}\n` : '') || 'Command executed successfully.';
        } catch (e: any) { return `Error Executing ${command}: ${e.message}`; }
      },
    })
  };

  const { text, steps } = await generateText({
    model: openclaw(cron.agentId || 'main'),
    messages: [{ role: 'user', content: `[定时任务执行]: ${cron.prompt}` }],
    system: systemInstructions,
    tools: agentTools,
    maxSteps: 5,
  });

  // Log the execution
  const logEntry = `\n\n--- [${new Date().toISOString()}] 定时任务: ${cron.prompt} ---\nAgent (${cron.agentId}) 回复:\n${text}\n执行情况:\n${JSON.stringify(steps.map(s => s.toolCalls.map(t => t.toolName)), null, 2)}\n`;
  await fs.appendFile(path.join(workspaceDir, 'cron-execution.log'), logEntry, 'utf8');
}
