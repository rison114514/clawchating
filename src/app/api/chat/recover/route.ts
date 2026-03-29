import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { appendGroupTimelineMessage } from '@/lib/session-runtime';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      agentId, 
      groupId, 
      channelId, 
      lookbackSeconds = 900 
    } = body as { agentId: string; groupId: string; channelId: string; lookbackSeconds?: number };

    if (!agentId || !groupId) {
      return new Response(JSON.stringify({ error: 'Missing agentId or groupId' }), { status: 400 });
    }

    // 1. Resolve the best session for recovery:
    //    Prefer scoped group session (channel/to-derived key), fallback to main/default.
    const sessionsStorePath = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');
    let store: Record<string, any> = {};
    try {
      const data = await fs.readFile(sessionsStorePath, 'utf-8');
      store = JSON.parse(data);
    } catch {
      return new Response(JSON.stringify({ error: 'Agent sessions store not found' }), { status: 404 });
    }

    const safeChannelId = channelId || 'default';
    const scopedPrefix = `agent:${agentId}:clawchating:direct:grp_${groupId}__ch_${safeChannelId}__`;
    const scopedCandidates = Object.entries(store)
      .filter(([key, value]) => key.startsWith(scopedPrefix) && !!value?.sessionId)
      .sort((a, b) => {
        const aUpdated = Number(a[1]?.updatedAt || 0);
        const bUpdated = Number(b[1]?.updatedAt || 0);
        return bUpdated - aUpdated;
      })
      .map(([key]) => key);

    const fallbackKeys = [
      `agent:${agentId}:main`,
      'main',
      `agent:${agentId}:default`
    ];
    const candidateKeys = [...scopedCandidates, ...fallbackKeys];

    let targetSessionId: string | null = null;
    let foundKey: string | null = null;

    for (const key of candidateKeys) {
      if (store[key]?.sessionId) {
        targetSessionId = store[key].sessionId;
        foundKey = key;
        break;
      }
    }

    if (!targetSessionId) {
      return new Response(JSON.stringify({ 
        error: 'Recover session not found for agent',
        details: { scannedKeys: candidateKeys, scopedPrefix }
      }), { status: 404 });
    }

    // 2. Load and parse session file directly to access stopReason and valid content
    const sessionFile = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', `${targetSessionId}.jsonl`);
    let fileContent = '';
    try {
      fileContent = await fs.readFile(sessionFile, 'utf-8');
    } catch {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Recover session file not found.'
      }), { status: 200 }); // Return 200 so UI doesn't crash, just shows nothing
    }

    const messages = fileContent
      .split(/\r?\n/)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(m => m && m.type === 'message' && m.message?.role === 'assistant');

    const now = Date.now();
    // Default lookback to 24 hours to handle cases where user notices drift late.
    // Also respect client provided value if it's larger, but ensure at least 24h coverage for "recover" intent.
    const effectiveLookback = Math.max(lookbackSeconds || 0, 86400); 
    const lookbackMs = effectiveLookback * 1000;
    const threshold = now - lookbackMs;

    // Helper to parse text exactly like session-runtime
    const extractText = (content: any) => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';

      const raw = content
        .map((item: any) => {
          if (!item || typeof item !== 'object') return '';
          if (item.type === 'text' && typeof item.text === 'string') return item.text;
          return '';
        })
        .filter(Boolean)
        .join('\n');
      
      return raw || '';
    };

    // Filter candidates
    const recentCandidates = messages
      .filter(m => {
        const ts = m.message.timestamp || m.timestamp || 0;
        return ts >= threshold;
      })
      .map(m => ({
        ...m.message, // flattened
        parsedContent: extractText(m.message.content),
        originalTimestamp: m.message.timestamp || m.timestamp
      }))
      .filter(m => m.parsedContent.trim().length > 0) // Must have text
      .reverse(); // Newest first

    if (recentCandidates.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No recent assistant messages found in selected session.',
        details: { recoveredFromSession: foundKey }
      }), { status: 200 });
    }

    // Heuristic: Prefer "stop" or "null" stopReason over "toolUse".
    // "toolUse" usually means "I'm doing something", which might be "Waiting..." or "Installing...".
    // If the VERY newest candidate is "toolUse" but contains text, we might take it.
    // But if there is a "stop" message just before it (unlikely, usually strictly chronological), we prefer "stop".
    
    // Actually, usually: [Msg1(toolUse)] -> [ToolResult] -> [Msg2(stop)].
    // Reverse: [Msg2(stop)] -> [ToolResult] -> [Msg1(toolUse)].
    // We filtered out toolResult (not assistant).
    // So: [Msg2(stop), Msg1(toolUse)].
    // The first one is Msg2.
    // If we have: [Msg3(toolUse)] -> ... (Stuck in polling).
    // Reverse: [Msg3(toolUse)].
    // We have to take Msg3.
    
    // BUT! If the user sees "Recover failed" maybe we picked an EMPTY one?
    // We added `.filter(m => m.parsedContent.trim().length > 0)`.
    
    const bestCandidate = recentCandidates[0];

    // 3. Append to group timeline
    await appendGroupTimelineMessage({
      groupId,
      channelId: channelId || 'default',
      role: 'assistant',
      content: bestCandidate.parsedContent,
      name: bestCandidate.name || agentId,
      meta: {
        recovered: true,
        recoveredFromSession: foundKey,
        originalTimestamp: bestCandidate.originalTimestamp,
        recoveryTimestamp: now,
        executionState: 'recovered'
      }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      recoveredMessage: bestCandidate 
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error) 
    }), { status: 500 });
  }
}
