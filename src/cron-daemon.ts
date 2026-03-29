import fs from 'fs/promises';
import path from 'path';
import { POST as runChatRoute } from './app/api/chat/route';

let isRunning = false;

function shouldRunCron(cron: any, now: number): boolean {
  const isActive = cron.active !== false;
  if (!isActive) return false;

  const lastRun = typeof cron.lastRun === 'number' ? cron.lastRun : 0;
  const scheduleType = cron.scheduleType === 'daily' ? 'daily' : 'interval';

  if (scheduleType === 'daily') {
    const dailyTime = String(cron.dailyTime || '09:00');
    const [h, m] = dailyTime.split(':');
    const hour = Number(h);
    const minute = Number(m);
    if (
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return false;
    }

    const nowDate = new Date(now);
    const todayAtTime = new Date(nowDate);
    todayAtTime.setHours(hour, minute, 0, 0);
    const todayTrigger = todayAtTime.getTime();

    if (now < todayTrigger) return false;
    return lastRun < todayTrigger;
  }

  const intervalMs = Math.max(1, Number(cron.intervalMin) || 5) * 60000;
  return now - lastRun >= intervalMs;
}

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
        if (shouldRunCron(cron, now)) {
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

type OpenClawAgent = {
  id?: string;
  name?: string;
};

type OpenClawConfig = {
  agents?: {
    list?: OpenClawAgent[];
  };
};

type GroupRecord = {
  id: string;
  members?: string[];
  channelId?: string;
  ownerId?: string;
  ownerName?: string;
};

async function loadGroups() {
  const groupsPath = path.join(process.cwd(), 'workspaces', 'groups.json');
  try {
    const content = await fs.readFile(groupsPath, 'utf-8');
    const rows = JSON.parse(content);
    return Array.isArray(rows) ? (rows as GroupRecord[]) : [];
  } catch {
    return [] as GroupRecord[];
  }
}

async function executeTask(cron: any) {
  const groupId = String(cron.groupId || '').trim();
  const configuredAgentId = String(cron.agentId || '').trim();
  const prompt = String(cron.prompt || '').trim();
  if (!groupId || !prompt || !configuredAgentId) return;

  const groups = await loadGroups();
  const group = groups.find((row) => row?.id === groupId);
  const channelId = String(cron.channelId || group?.channelId || 'default').trim() || 'default';
  const groupMembers = Array.isArray(group?.members)
    ? group!.members!.map((m) => String(m || '').trim()).filter(Boolean)
    : [];

  const resolvedAgentId = configuredAgentId;

  if (!groupMembers.includes(resolvedAgentId)) {
    groupMembers.push(resolvedAgentId);
  }

  const ownerUserId = String(group?.ownerId || '').trim() || 'ou_local_user';
  const ownerName = String(group?.ownerName || '').trim() || 'Clawchating User';

  const taskInput = [
    `[CronTask] 系统定时呼唤。`,
    `cronId=${String(cron.id || 'unknown')} groupId=${groupId} channelId=${channelId}`,
    `@${resolvedAgentId} ${prompt}`,
  ].join('\n');

  const payload = {
    inputText: taskInput,
    agentId: resolvedAgentId,
    channelId,
    sessionType: 'group',
    groupId,
    groupMembers,
    senderId: ownerUserId,
    senderName: ownerName,
    autoMentionName: undefined,
  };

  console.info('[cron_dispatch_via_chat]', {
    cronId: String(cron.id || ''),
    configuredAgentId,
    resolvedAgentId,
    groupId,
    channelId,
    ownerUserId,
    groupMembers,
  });

  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await runChatRoute(req);
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    throw new Error(`Cron dispatch via chat failed: ${String((json as any)?.error || res.statusText)}`);
  }

  const responseText = typeof (json as any)?.message?.content === 'string'
    ? (json as any).message.content
    : JSON.stringify(json, null, 2);

  const workspaceDir = path.join(process.cwd(), 'workspaces', groupId);
  const logEntry = `\n\n--- [${new Date().toISOString()}] 定时任务: ${prompt} ---\nAgent (${resolvedAgentId}) 回复:\n${responseText}\n`;
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.appendFile(path.join(workspaceDir, 'cron-execution.log'), logEntry, 'utf8');
}
