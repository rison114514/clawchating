import {
  appendSessionMessage,
  ensureAgentSession,
  loadGroupTimelineMessages,
  loadSessionMessages,
  resolvePeerId,
} from '@/lib/session-runtime';

const CHAT_TRACE_ENABLED = /^(1|true|yes)$/i.test(process.env.CLAWCHATING_CHAT_TRACE || '');

function logTrace(traceId: string | null, event: string, payload: Record<string, unknown>) {
  if (!CHAT_TRACE_ENABLED || !traceId) return;
  console.info('[chat_trace]', {
    traceId,
    event,
    ...payload,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const traceId = (searchParams.get('traceId') || '').trim() || null;
  const groupId = (searchParams.get('groupId') || '').trim();
  const channelId = (searchParams.get('channelId') || '').trim() || 'default';
  const limit = Math.max(1, Number(searchParams.get('limit') || '50'));
  const offset = Math.max(0, Number(searchParams.get('offset') || '0'));

  logTrace(traceId, 'messages_fetch_start', {
    groupId,
    channelId,
    limit,
    offset,
    mode: groupId ? 'group' : 'direct',
  });

  if (groupId) {
    const result = await loadGroupTimelineMessages({ groupId, channelId, limit, offset });
    logTrace(traceId, 'messages_fetch_done', {
      groupId,
      channelId,
      count: result.messages.length,
      hasMore: result.hasMore,
      total: result.total,
    });
    return new Response(JSON.stringify(result), {
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

  const result = await loadSessionMessages({ agentId, sessionKey, limit, offset });
  logTrace(traceId, 'messages_fetch_done', {
    agentId,
    sessionKey,
    count: result.messages.length,
    hasMore: result.hasMore,
    total: result.total,
  });
  return new Response(JSON.stringify(result), {
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
