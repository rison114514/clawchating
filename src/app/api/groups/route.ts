import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { appendSessionMessage, initializeGroupSessions } from '@/lib/session-runtime';

const groupsPath = path.join(process.cwd(), 'workspaces', 'groups.json');

async function getGroups() {
  try {
    const data = await fs.readFile(groupsPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

async function saveGroups(groups: any) {
  await fs.mkdir(path.dirname(groupsPath), { recursive: true });
  await fs.writeFile(groupsPath, JSON.stringify(groups, null, 2));
}

type OpenClawConfig = {
  agents?: {
    list?: Array<{ id?: string; workspace?: string }>;
  };
};

async function readOpenClawConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return {} as OpenClawConfig;
  }
}

async function getAgentWorkspaceMap() {
  const config = await readOpenClawConfig();
  const agents = Array.isArray(config.agents?.list) ? config.agents?.list : [];
  const workspaceByAgentId = new Map<string, string>();
  for (const agent of agents) {
    const id = String(agent?.id || '').trim();
    const workspace = String(agent?.workspace || '').trim();
    if (id && workspace) workspaceByAgentId.set(id, workspace);
  }
  return workspaceByAgentId;
}

async function ensureGroupWorkspaceMounts(groupId: string, memberAgentIds: string[]) {
  if (!groupId || !Array.isArray(memberAgentIds) || memberAgentIds.length === 0) return;

  const uniqueMembers = Array.from(new Set(memberAgentIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueMembers.length === 0) return;

  const workspaceByAgentId = await getAgentWorkspaceMap();

  const sharedWorkspaceDir = path.resolve(path.join(process.cwd(), 'workspaces', groupId));
  await fs.mkdir(sharedWorkspaceDir, { recursive: true });

  for (const agentId of uniqueMembers) {
    const agentWorkspaceDir = workspaceByAgentId.get(agentId);
    if (!agentWorkspaceDir) continue;

    const mountsDir = path.resolve(path.join(agentWorkspaceDir, 'group_mounts'));
    const mountPath = path.resolve(path.join(mountsDir, groupId));

    await fs.mkdir(mountsDir, { recursive: true });

    try {
      const stat = await fs.lstat(mountPath);
      if (stat.isSymbolicLink()) {
        const linkTarget = await fs.readlink(mountPath);
        const resolvedLinkTarget = path.resolve(path.dirname(mountPath), linkTarget);
        if (resolvedLinkTarget === sharedWorkspaceDir) {
          continue;
        }
        await fs.unlink(mountPath);
      } else {
        // Preserve existing non-link files/dirs to avoid destructive side effects.
        continue;
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        continue;
      }
    }

    await fs.symlink(sharedWorkspaceDir, mountPath, 'dir');
  }
}

async function writeGroupContextForMembers(groupId: string, channelId: string, memberAgentIds: string[]) {
  if (!groupId) return;

  const sharedWorkspaceDir = path.resolve(path.join(process.cwd(), 'workspaces', groupId));
  await fs.mkdir(sharedWorkspaceDir, { recursive: true });

  const contextPath = path.join(sharedWorkspaceDir, 'GROUP_CONTEXT.md');
  const communicationLines = [
    `- communicationProtocol: 在本群组中，成员之间只要在回复里使用 @agentId 或 @显示名，就会由系统自动路由到对应成员。`,
    `- communicationConstraint: 不需要额外消息发送工具；不要声称“无法发送消息”或“@失败”。`,
  ];

  try {
    const stat = await fs.stat(contextPath);
    if (stat.isFile()) {
      const existing = await fs.readFile(contextPath, 'utf-8');
      const hasProtocol = existing.includes('communicationProtocol:');
      const hasConstraint = existing.includes('communicationConstraint:');
      if (hasProtocol && hasConstraint) return;

      const next = [
        existing.trimEnd(),
        ...communicationLines.filter((line) => {
          if (line.includes('communicationProtocol:') && hasProtocol) return false;
          if (line.includes('communicationConstraint:') && hasConstraint) return false;
          return true;
        }),
        '',
      ].join('\n');
      await fs.writeFile(contextPath, next, 'utf-8');
      return;
    }
  } catch {
    // File does not exist, proceed
  }

  const sectionBody = [
    `# Group ${groupId}`,
    `- groupId: ${groupId}`,
    `- channelId: ${channelId}`,
    `- location: This file is located in the shared workspace root.`,
    `- mountPoint: In your agent workspace, this directory is mounted at \`./group_mounts/${groupId}\``,
    ...communicationLines,
    `- usageConstraint: 仅群组上下文使用，不要在非本群组任务中使用该共享目录。`,
    `- updatedAt: ${new Date().toISOString()}`,
  ].join('\n');

  await fs.writeFile(contextPath, sectionBody, 'utf-8');
}

async function appendJoinInitializationPrompt(
  groupId: string,
  channelId: string,
  initializedMembers: Array<{ agentId: string; sessionId: string; workspaceDir: string }>
) {
  if (!groupId || initializedMembers.length === 0) return;

  const sharedWorkspaceDir = path.resolve(path.join(process.cwd(), 'workspaces', groupId));

  for (const member of initializedMembers) {
    const mountPath = path.resolve(path.join(member.workspaceDir, 'group_mounts', groupId));
    const contextFilePath = path.join(mountPath, 'GROUP_CONTEXT.md');
    const initMessage = [
      `@${member.agentId} [Join Initialization] 你已加入群组 ${groupId}。`,
      `群组上下文文件位于：${contextFilePath}`,
      `请立即使用 \`read_file\` 工具读取该文件内容，以获取群组背景信息。`,
      `注意：必须真实调用工具读取文件，禁止编造内容。`,
      `频道ID: ${channelId}`,
    ].join('\n');

    await appendSessionMessage({
      agentId: member.agentId,
      sessionId: member.sessionId,
      role: 'user',
      content: initMessage,
      name: 'group-init',
    });
  }
}

function normalizeGroupPayload(group: any) {
  const members = Array.isArray(group?.members)
    ? Array.from(new Set(group.members.map((m: unknown) => String(m).trim()).filter(Boolean)))
    : [];
  const leaderId = typeof group?.leaderId === 'string' ? group.leaderId.trim() : '';

  return {
    ...group,
    members,
    leaderId: members.includes(leaderId) ? leaderId : (members[0] || undefined),
  };
}

export async function GET() {
  return NextResponse.json(await getGroups());
}

export async function POST(req: Request) {
  const newGroup = normalizeGroupPayload(await req.json());
  const groups = await getGroups();
  
  if (!newGroup.id) {
    newGroup.id = `group-${Date.now()}`;
  }
  if (!/^[a-zA-Z0-9_:-]+$/.test(newGroup.id)) {
    return NextResponse.json({ error: 'Invalid group id format' }, { status: 400 });
  }
  
  groups.push(newGroup);
  await saveGroups(groups);
  await ensureGroupWorkspaceMounts(newGroup.id, Array.isArray(newGroup.members) ? newGroup.members : []);

  if (Array.isArray(newGroup.members) && newGroup.members.length > 0) {
    const initializedMembers = await initializeGroupSessions({
      groupId: newGroup.id,
      channelId: newGroup.channelId || 'default',
      ownerUserId: newGroup.ownerId,
      ownerName: newGroup.ownerName,
      memberAgentIds: newGroup.members,
    });
    await writeGroupContextForMembers(newGroup.id, newGroup.channelId || 'default', newGroup.members);
    await appendJoinInitializationPrompt(newGroup.id, newGroup.channelId || 'default', initializedMembers);
  }

  return NextResponse.json({ success: true, group: newGroup });
}

export async function PUT(req: Request) {
  const updatedGroup = normalizeGroupPayload(await req.json());
  let groups = await getGroups();
  const previousGroup = groups.find((g: any) => g.id === updatedGroup.id);

  groups = groups.map((g: any) => g.id === updatedGroup.id ? updatedGroup : g);
  await saveGroups(groups);

  const prevMembers: string[] = Array.isArray(previousGroup?.members) ? previousGroup.members : [];
  const nextMembers: string[] = Array.isArray(updatedGroup?.members) ? updatedGroup.members : [];
  const newlyAddedMembers = nextMembers.filter((member) => !prevMembers.includes(member));

  await ensureGroupWorkspaceMounts(updatedGroup.id, newlyAddedMembers);

  if (newlyAddedMembers.length > 0) {
    const initializedMembers = await initializeGroupSessions({
      groupId: updatedGroup.id,
      channelId: updatedGroup.channelId || 'default',
      ownerUserId: updatedGroup.ownerId,
      ownerName: updatedGroup.ownerName,
      memberAgentIds: newlyAddedMembers,
    });
    await writeGroupContextForMembers(updatedGroup.id, updatedGroup.channelId || 'default', newlyAddedMembers);
    await appendJoinInitializationPrompt(updatedGroup.id, updatedGroup.channelId || 'default', initializedMembers);
  }

  return NextResponse.json({ success: true, group: updatedGroup });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  let groups = await getGroups();
  groups = groups.filter((g: any) => g.id !== id);
  await saveGroups(groups);
  return NextResponse.json({ success: true });
}
