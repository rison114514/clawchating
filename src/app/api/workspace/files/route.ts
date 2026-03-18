import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

function getWorkspaceDir(scopedId: string) {
  return path.join(process.cwd(), 'workspaces', scopedId);
}

function resolveInWorkspace(workspaceDir: string, relativePath: string) {
  const normalized = path.normalize(relativePath || '').replace(/^([/\\])+/, '');
  const absTarget = path.resolve(workspaceDir, normalized);
  const absRoot = path.resolve(workspaceDir);

  if (absTarget !== absRoot && !absTarget.startsWith(`${absRoot}${path.sep}`)) {
    throw new Error('Invalid path');
  }

  return { normalized, absTarget };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const filename = searchParams.get('filename');
  const dir = searchParams.get('dir') || '';

  const workspaceDir = getWorkspaceDir(scopedId);
  
  try {
    // 自动确保目录存在
    await fs.mkdir(workspaceDir, { recursive: true });

    if (filename) {
      // 读单个文件（目录不能按文件读取）
      const { absTarget: filePath } = resolveInWorkspace(workspaceDir, filename);
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        return NextResponse.json({ error: 'Cannot read directory as file' }, { status: 400 });
      }
      const content = await fs.readFile(filePath, 'utf8');
      return NextResponse.json({ content });
    }

    // 读目录列表，返回文件类型
    const { normalized: normalizedDir, absTarget: targetDir } = resolveInWorkspace(workspaceDir, dir);
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files = entries
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.posix.join(normalizedDir.replaceAll('\\', '/'), entry.name),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return NextResponse.json({ files });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json(filename ? { content: '' } : { files: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const workspaceDir = getWorkspaceDir(scopedId);

  try {
    const { filename, content } = await req.json();
    if (!filename) return NextResponse.json({ error: 'Filename is required' }, { status: 400 });

    await fs.mkdir(workspaceDir, { recursive: true });
    const { absTarget: filePath } = resolveInWorkspace(workspaceDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content || '', 'utf8');
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const workspaceDir = getWorkspaceDir(scopedId);

  try {
    const { oldFilename, newFilename } = await req.json();
    if (!oldFilename || !newFilename) return NextResponse.json({ error: 'Both old and new filenames are required' }, { status: 400 });

    const { absTarget: oldPath } = resolveInWorkspace(workspaceDir, oldFilename);
    const { absTarget: newPath } = resolveInWorkspace(workspaceDir, newFilename);
    
    await fs.rename(oldPath, newPath);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const filename = searchParams.get('filename');

  if (!filename) return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
  const workspaceDir = getWorkspaceDir(scopedId);

  try {
    const { absTarget: filePath } = resolveInWorkspace(workspaceDir, filename);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
