import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

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
  return NextResponse.json({ success: true, group: newGroup });
}

export async function PUT(req: Request) {
  const updatedGroup = await req.json();
  let groups = await getGroups();
  
  groups = groups.map((g: any) => g.id === updatedGroup.id ? updatedGroup : g);
  await saveGroups(groups);
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
