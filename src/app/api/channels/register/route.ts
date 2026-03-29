import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

function runScript() {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('sh', ['./scripts/register-clawchating-channel.sh'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `register script exited with code ${code}`));
      }
    });
  });
}

export async function POST() {
  try {
    const result = await runScript();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      success: true,
      result: parsed,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
