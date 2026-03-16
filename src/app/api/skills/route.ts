import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function tryExtractJsonObject(text: string) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const eligibleOnly = searchParams.get('eligible') !== 'false';

    const args = ['skills', 'list'];
    if (eligibleOnly) args.push('--eligible');
    args.push('--json');

    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });

    const payload = tryExtractJsonObject(stdout) || tryExtractJsonObject(stderr);
    if (!payload) {
      return NextResponse.json({ skills: [], error: 'Failed to parse skills output' }, { status: 502 });
    }

    const parsed = JSON.parse(payload) as { skills?: unknown[] };
    const skills = (Array.isArray(parsed.skills) ? parsed.skills : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          name: typeof record.name === 'string' ? record.name : '',
          description: typeof record.description === 'string' ? record.description : '',
          eligible: !!record.eligible,
          source: typeof record.source === 'string' ? record.source : '',
          bundled: !!record.bundled,
          disabled: !!record.disabled,
          blockedByAllowlist: !!record.blockedByAllowlist,
        };
      })
      .filter((item) => item.name);

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      {
        skills: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
