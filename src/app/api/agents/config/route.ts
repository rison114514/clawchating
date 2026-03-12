import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const ALLOWED_FILES = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md'];

async function getAgentWorkspace(agentId: string) {
  const home = os.homedir();
  const clawConfigPath = path.join(home, '.openclaw', 'openclaw.json');
  
  try {
    const data = await fs.readFile(clawConfigPath, 'utf-8');
    const config = JSON.parse(data);
    const agent = config.agents?.list?.find((a: any) => a.id === agentId);
    if (agent && agent.workspace) {
      return agent.workspace;
    }
  } catch (e) {
    console.error('Could not read openclaw.json, falling back to default', e);
  }
  
  // Fallback
  return path.join(home, '.openclaw', `workspace-${agentId}`);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId');
  const filename = searchParams.get('filename');

  if (!agentId || !filename || !ALLOWED_FILES.includes(filename)) {
    return NextResponse.json({ error: 'Invalid agentId or filename' }, { status: 400 });
  }

  try {
    const workspace = await getAgentWorkspace(agentId);
    const filePath = path.join(workspace, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({ content });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ content: '' }); // File doesn't exist yet
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { agentId, filename, content } = await req.json();

  if (!agentId || !filename || !ALLOWED_FILES.includes(filename)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  try {
    const workspace = await getAgentWorkspace(agentId);
    await fs.mkdir(workspace, { recursive: true });
    
    const filePath = path.join(workspace, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
