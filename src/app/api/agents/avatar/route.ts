import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import fssync from 'fs';
import os from 'os';
import path from 'path';

type OpenClawAgent = {
  id: string;
  workspace?: string;
  avatar?: string;
  identity?: {
    avatar?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenClawConfig = {
  agents?: {
    list?: OpenClawAgent[];
  };
};

function mimeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.avif') return 'image/avif';
  return 'application/octet-stream';
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = (searchParams.get('agentId') || '').trim();
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fssync.existsSync(configPath)) {
      return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
    }

    const content = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(content) as OpenClawConfig;
    const list = Array.isArray(config.agents?.list) ? config.agents?.list : [];
    const agent = list.find((item) => item.id === agentId);

    if (!agent) {
      return NextResponse.json({ error: 'agent not found' }, { status: 404 });
    }

    const avatarValue = (agent.identity?.avatar || agent.avatar || '').trim();
    if (!avatarValue) {
      return NextResponse.json({ error: 'avatar not configured' }, { status: 404 });
    }

    if (/^(https?:|data:)/i.test(avatarValue)) {
      return NextResponse.json({ error: 'remote/data avatar is not supported by this endpoint' }, { status: 400 });
    }

    const workspaceDir = path.resolve(agent.workspace || path.join(os.homedir(), '.openclaw', `workspace-${agentId}`));
    const avatarPath = path.resolve(workspaceDir, avatarValue);
    if (avatarPath !== workspaceDir && !avatarPath.startsWith(`${workspaceDir}${path.sep}`)) {
      return NextResponse.json({ error: 'avatar path escapes workspace root' }, { status: 400 });
    }

    const fileBuffer = await fs.readFile(avatarPath);
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': mimeFromPath(avatarPath),
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
