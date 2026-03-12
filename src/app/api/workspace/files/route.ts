import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const filename = searchParams.get('filename');

  const workspaceDir = path.join(process.cwd(), 'workspaces', scopedId);
  
  try {
    // 自动确保目录存在
    await fs.mkdir(workspaceDir, { recursive: true });

    if (filename) {
      // 读单个文件
      const filePath = path.join(workspaceDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      return NextResponse.json({ content });
    } else {
      // 读目录列表
      const files = await fs.readdir(workspaceDir);
      return NextResponse.json({ files });
    }
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
  const workspaceDir = path.join(process.cwd(), 'workspaces', scopedId);

  try {
    const { filename, content } = await req.json();
    if (!filename) return NextResponse.json({ error: 'Filename is required' }, { status: 400 });

    await fs.mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, filename);
    await fs.writeFile(filePath, content || '', 'utf8');
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopedId = searchParams.get('scopedId') || 'default-workspace';
  const workspaceDir = path.join(process.cwd(), 'workspaces', scopedId);

  try {
    const { oldFilename, newFilename } = await req.json();
    if (!oldFilename || !newFilename) return NextResponse.json({ error: 'Both old and new filenames are required' }, { status: 400 });

    const oldPath = path.join(workspaceDir, oldFilename);
    const newPath = path.join(workspaceDir, newFilename);
    
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
  const workspaceDir = path.join(process.cwd(), 'workspaces', scopedId);

  try {
    const filePath = path.join(workspaceDir, filename);
    await fs.unlink(filePath);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
