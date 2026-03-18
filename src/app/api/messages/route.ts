import {
  appendSessionMessage,
  ensureAgentSession,
  loadGroupTimelineMessages,
  loadSessionMessages,
  resolvePeerId,
} from '@/lib/session-runtime';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = (searchParams.get('groupId') || '').trim();
  const channelId = (searchParams.get('channelId') || '').trim() || 'default';

  if (groupId) {
    const messages = await loadGroupTimelineMessages({ groupId, channelId, limit: 200 });
    return new Response(JSON.stringify(messages), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const agentId = searchParams.get('agentId');
  const sessionKey = searchParams.get('sessionKey');

  if (!agentId || !sessionKey) {
    return new Response(JSON.stringify({ error: 'agentId and sessionKey are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = await loadSessionMessages({ agentId, sessionKey, limit: 80 });
  return new Response(JSON.stringify(messages), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: Request) {
  const { agentId, sessionKey, role, content, senderId, channelId, senderName } = await req.json();

  if (!agentId || !sessionKey || !role || typeof content !== 'string') {
    return new Response(JSON.stringify({ error: 'agentId, sessionKey, role and content are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await ensureAgentSession({
    agentId,
    peerId: resolvePeerId(senderId, channelId),
    senderLabel: typeof senderName === 'string' && senderName.trim() ? senderName : 'Clawchating User',
  });

  await appendSessionMessage({
    agentId,
    sessionId: session.sessionId,
    role: role === 'assistant' ? 'assistant' : 'user',
    content,
  });

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
