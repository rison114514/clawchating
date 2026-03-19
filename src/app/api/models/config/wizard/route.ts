import { NextResponse } from 'next/server';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';

type WizardSession = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
};

type WizardStore = {
  sessions: Map<string, WizardSession>;
};

const WIZARD_STORE_KEY = '__clawchatingOpenClawWizardStore__';

function getWizardStore(): WizardStore {
  const globalAny = globalThis as typeof globalThis & {
    [WIZARD_STORE_KEY]?: WizardStore;
  };

  if (!globalAny[WIZARD_STORE_KEY]) {
    globalAny[WIZARD_STORE_KEY] = {
      sessions: new Map<string, WizardSession>(),
    };
  }

  return globalAny[WIZARD_STORE_KEY]!;
}

function getSession(sessionId: string) {
  const store = getWizardStore();
  return store.sessions.get(sessionId);
}

function trimSessionOutput(output: string, maxLength = 120000) {
  if (output.length <= maxLength) return output;
  return output.slice(output.length - maxLength);
}

function cleanupOldSessions(maxAgeMs = 1000 * 60 * 30) {
  const now = Date.now();
  const store = getWizardStore();
  for (const [id, session] of store.sessions.entries()) {
    const expired = now - session.createdAt > maxAgeMs;
    if (!expired) continue;
    if (!session.exited) {
      try {
        session.child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    store.sessions.delete(id);
  }
}

function startWizardSession() {
  cleanupOldSessions();

  const sessionId = crypto.randomUUID();
  const wizardCommand = 'stty cols 180 rows 48 2>/dev/null; openclaw config';
  const runOptions = {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe' as const,
  };

  // Prefer `script` to provide a pseudo-tty so interactive prompts behave like a real terminal.
  const child = spawn('script', ['-q', '-f', '-c', wizardCommand, '/dev/null'], runOptions);

  const session: WizardSession = {
    id: sessionId,
    child,
    output: '',
    createdAt: Date.now(),
    exited: false,
    exitCode: null,
  };

  child.stdout.on('data', (chunk) => {
    session.output = trimSessionOutput(session.output + String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    session.output = trimSessionOutput(session.output + String(chunk));
  });

  child.on('close', (code) => {
    session.exited = true;
    session.exitCode = code;
  });

  child.on('error', (error) => {
    // Fallback to direct spawn if `script` is unavailable in the environment.
    if (error.message.includes('ENOENT')) {
      const fallback = spawn('sh', ['-lc', wizardCommand], runOptions);
      session.child = fallback;

      fallback.stdout.on('data', (chunk) => {
        session.output = trimSessionOutput(session.output + String(chunk));
      });
      fallback.stderr.on('data', (chunk) => {
        session.output = trimSessionOutput(session.output + String(chunk));
      });
      fallback.on('close', (code) => {
        session.exited = true;
        session.exitCode = code;
      });
      fallback.on('error', (fallbackError) => {
        session.output = trimSessionOutput(`${session.output}\n[spawn error] ${fallbackError.message}\n`);
        session.exited = true;
        session.exitCode = -1;
      });
      return;
    }

    session.output = trimSessionOutput(`${session.output}\n[spawn error] ${error.message}\n`);
    session.exited = true;
    session.exitCode = -1;
  });

  getWizardStore().sessions.set(sessionId, session);
  return session;
}

function safeSliceOutput(text: string, since: number) {
  if (!Number.isFinite(since) || since < 0) {
    return { chunk: text, nextOffset: text.length };
  }

  const start = Math.min(Math.max(0, since), text.length);
  return {
    chunk: text.slice(start),
    nextOffset: text.length,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionOutput(session: WizardSession, since: number, waitMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    if (session.output.length > since || session.exited) {
      break;
    }
    await sleep(200);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = String(url.searchParams.get('sessionId') || '').trim();
    const sinceRaw = Number(url.searchParams.get('since') || '0');
    const waitRaw = Number(url.searchParams.get('waitMs') || '15000');
    const waitMs = Number.isFinite(waitRaw)
      ? Math.max(0, Math.min(waitRaw, 30000))
      : 15000;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'wizard session not found' }, { status: 404 });
    }

    await waitForSessionOutput(session, Math.max(0, sinceRaw), waitMs);

    const { chunk, nextOffset } = safeSliceOutput(session.output, sinceRaw);
    return NextResponse.json({
      sessionId,
      chunk,
      nextOffset,
      exited: session.exited,
      exitCode: session.exitCode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      action?: 'start' | 'input' | 'stop';
      sessionId?: string;
      input?: string;
      bootstrap?: 'local-model' | 'none';
    };

    const action = body.action || 'start';

    if (action === 'start') {
      const session = startWizardSession();
      const bootstrap = body.bootstrap || 'none';

      if (bootstrap === 'local-model') {
        // Best effort: default gateway option is Local, then select Model in multi-select.
        setTimeout(() => {
          if (!session.exited) {
            session.child.stdin.write('\r');
          }
        }, 800);
        setTimeout(() => {
          if (!session.exited) {
            session.child.stdin.write(' ');
            session.child.stdin.write('\r');
          }
        }, 1600);
      }

      return NextResponse.json({
        success: true,
        sessionId: session.id,
      });
    }

    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'wizard session not found' }, { status: 404 });
    }

    if (action === 'input') {
      if (session.exited) {
        return NextResponse.json({ error: 'wizard session has exited' }, { status: 409 });
      }
      const input = String(body.input || '');
      session.child.stdin.write(input);
      return NextResponse.json({ success: true });
    }

    if (action === 'stop') {
      if (!session.exited) {
        try {
          session.child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
