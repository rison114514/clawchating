import { WebSocketServer } from 'ws';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import {
  appendSessionMessage,
  ensureAgentSession,
  loadSessionMessages,
  resolvePeerId,
} from '../lib/session-runtime';

const exec = promisify(execCallback);

type RpcRequest = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

function send(ws: import('ws').WebSocket, payload: unknown) {
  ws.send(JSON.stringify(payload));
}

function ok(id: string | number | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: string | number | undefined, message: string, code = -32000) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function resolveWorkspaceDir(scopedId?: string) {
  return path.join(process.cwd(), 'workspaces', scopedId || 'default-workspace');
}

async function invokeSkill(params: Record<string, unknown>) {
  const action = typeof params.action === 'string' ? params.action : '';
  const scopedId = typeof params.scopedId === 'string' ? params.scopedId : 'default-workspace';
  const workspaceDir = resolveWorkspaceDir(scopedId);

  if (action === 'read_file') {
    const filename = typeof params.filename === 'string' ? params.filename : '';
    if (!filename) throw new Error('filename is required');
    const content = await fs.readFile(path.join(workspaceDir, filename), 'utf-8');
    return { action, filename, content };
  }

  if (action === 'write_file') {
    const filename = typeof params.filename === 'string' ? params.filename : '';
    const content = typeof params.content === 'string' ? params.content : '';
    if (!filename) throw new Error('filename is required');
    const targetPath = path.join(workspaceDir, filename);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf-8');
    return { action, filename, success: true };
  }

  if (action === 'execute_command') {
    const command = typeof params.command === 'string' ? params.command : '';
    if (!command) throw new Error('command is required');
    const { stdout, stderr } = await exec(command, { cwd: workspaceDir, timeout: 10000 });
    return { action, command, stdout, stderr };
  }

  throw new Error(`unsupported action: ${action}`);
}

async function handleRequest(req: RpcRequest) {
  const method = req.method || '';
  const params = req.params || {};

  if (method === 'ping') {
    return { pong: true, mode: 'websocket', plugin: 'clawchating' };
  }

  if (method === 'session.ensure') {
    const agentId = typeof params.agentId === 'string' ? params.agentId : '';
    const senderId = typeof params.senderId === 'string' ? params.senderId : undefined;
    const channelId = typeof params.channelId === 'string' ? params.channelId : undefined;
    const senderName = typeof params.senderName === 'string' ? params.senderName : 'Clawchating User';

    if (!agentId) throw new Error('agentId is required');

    const peerId = resolvePeerId(senderId, channelId);
    const session = await ensureAgentSession({
      agentId,
      peerId,
      senderLabel: senderName,
    });

    return {
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      profile: {
        agentId: session.profile.agentId,
        displayName: session.profile.displayName,
        workspaceDir: session.profile.workspaceDir,
        capabilities: session.profile.capabilities,
      },
    };
  }

  if (method === 'session.history') {
    const agentId = typeof params.agentId === 'string' ? params.agentId : '';
    const sessionKey = typeof params.sessionKey === 'string' ? params.sessionKey : '';
    const limit = typeof params.limit === 'number' ? params.limit : 50;

    if (!agentId || !sessionKey) throw new Error('agentId and sessionKey are required');
    const history = await loadSessionMessages({ agentId, sessionKey, limit });
    return { history };
  }

  if (method === 'session.append') {
    const agentId = typeof params.agentId === 'string' ? params.agentId : '';
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const role = params.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof params.content === 'string' ? params.content : '';

    if (!agentId || !sessionId || !content) throw new Error('agentId, sessionId and content are required');
    await appendSessionMessage({ agentId, sessionId, role, content });
    return { success: true };
  }

  if (method === 'skills.list') {
    return {
      skills: ['read_file', 'write_file', 'execute_command'],
      channel: 'clawchating',
      transport: 'websocket',
    };
  }

  if (method === 'skills.invoke') {
    return await invokeSkill(params);
  }

  throw new Error(`unknown method: ${method}`);
}

const port = Number(process.env.CLAWCHATING_WS_PORT || 19091);
const wss = new WebSocketServer({ port });

wss.on('connection', (ws) => {
  send(ws, { type: 'hello', plugin: 'clawchating', transport: 'websocket' });

  ws.on('message', async (raw) => {
    let req: RpcRequest;
    try {
      req = JSON.parse(raw.toString()) as RpcRequest;
    } catch {
      send(ws, fail(undefined, 'invalid json', -32700));
      return;
    }

    try {
      const result = await handleRequest(req);
      send(ws, ok(req.id, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(ws, fail(req.id, message));
    }
  });
});

console.log(`[clawchating-ws-plugin] listening on ws://127.0.0.1:${port}`);
