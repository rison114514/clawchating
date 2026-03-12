import * as fs from 'fs/promises';
import * as path from 'path';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionType = searchParams.get('sessionType');
  const sessionOrChannelId = searchParams.get('id');

  const workspaceFolderName = sessionType === 'group' ? sessionOrChannelId : sessionOrChannelId || 'default-workspace';
  const filePath = path.join(process.cwd(), 'workspaces', workspaceFolderName || 'default-workspace', 'messages.json');

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return new Response(data, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return new Response('[]', {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

export async function POST(req: Request) {
  const { messages, sessionType, id } = await req.json();

  const workspaceFolderName = sessionType === 'group' ? id : id || 'default-workspace';
  const dirPath = path.join(process.cwd(), 'workspaces', workspaceFolderName || 'default-workspace');
  const filePath = path.join(dirPath, 'messages.json');

  try {
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8');
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
