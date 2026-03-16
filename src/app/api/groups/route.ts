import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { initializeGroupSessions } from '@/lib/session-runtime';

const groupsPath = path.join(process.cwd(), 'workspaces', 'groups.json');
const defaultGroupSkillsGuide = `# Clawchating 专属技能使用方法

本文件用于记录本群组内可复用的 Clawchating 协作技能。

## 推荐使用方式

1. 先明确任务目标与产出格式。
2. 将任务拆分为可执行步骤，并标注负责人。
3. 在群聊中保持上下文连续，避免重复描述背景。
4. 对重要结论给出可验证依据（代码位置、日志、命令结果）。

## 常用技能模板

### 1) 代码审查技能
- 目标：发现 bug、风险与回归点。
- 输入：变更文件列表、关键业务路径。
- 输出：按严重级别排序的问题清单与修复建议。

### 2) 问题排查技能
- 目标：快速定位故障根因。
- 输入：报错信息、复现步骤、最近变更。
- 输出：根因判断、修复方案、验证结果。

### 3) 需求落地技能
- 目标：将需求转成可发布改动。
- 输入：需求描述、约束条件、验收标准。
- 输出：实现方案、代码变更、测试结论。

## 维护约定

- 新增技能时，补充“适用场景 / 输入 / 输出 / 注意事项”。
- 技能描述保持简洁，优先可执行动作。
- 定期清理过时技能，保证团队可直接复用。
`;

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

async function ensureGroupSkillsGuide(groupId: string) {
  const workspaceDir = path.join(process.cwd(), 'workspaces', groupId);
  const skillsDir = path.join(workspaceDir, 'skills');
  const guideFile = path.join(skillsDir, 'README.md');

  await fs.mkdir(skillsDir, { recursive: true });
  await fs.writeFile(guideFile, defaultGroupSkillsGuide, 'utf-8');
}

export async function GET() {
  return NextResponse.json(await getGroups());
}

export async function POST(req: Request) {
  const newGroup = await req.json();
  const groups = await getGroups();
  
  if (!newGroup.id) {
    newGroup.id = `group-${Date.now()}`;
  }
  
  groups.push(newGroup);
  await saveGroups(groups);
  await ensureGroupSkillsGuide(newGroup.id);

  if (Array.isArray(newGroup.members) && newGroup.members.length > 0) {
    await initializeGroupSessions({
      groupId: newGroup.id,
      channelId: newGroup.channelId || 'default',
      ownerUserId: newGroup.ownerId,
      ownerName: newGroup.ownerName,
      memberAgentIds: newGroup.members,
    });
  }

  return NextResponse.json({ success: true, group: newGroup });
}

export async function PUT(req: Request) {
  const updatedGroup = await req.json();
  let groups = await getGroups();
  const previousGroup = groups.find((g: any) => g.id === updatedGroup.id);

  groups = groups.map((g: any) => g.id === updatedGroup.id ? updatedGroup : g);
  await saveGroups(groups);

  const prevMembers: string[] = Array.isArray(previousGroup?.members) ? previousGroup.members : [];
  const nextMembers: string[] = Array.isArray(updatedGroup?.members) ? updatedGroup.members : [];
  const newlyAddedMembers = nextMembers.filter((member) => !prevMembers.includes(member));

  if (newlyAddedMembers.length > 0) {
    await initializeGroupSessions({
      groupId: updatedGroup.id,
      channelId: updatedGroup.channelId || 'default',
      ownerUserId: updatedGroup.ownerId,
      ownerName: updatedGroup.ownerName,
      memberAgentIds: newlyAddedMembers,
    });
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
