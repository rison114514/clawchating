import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const cronsPath = path.join(process.cwd(), 'workspaces', 'crons.json');

async function getCrons() {
  try {
    const data = await fs.readFile(cronsPath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

async function saveCrons(crons: any) {
  await fs.mkdir(path.dirname(cronsPath), { recursive: true });
  await fs.writeFile(cronsPath, JSON.stringify(crons, null, 2));
}

export async function GET() {
  return NextResponse.json(await getCrons());
}

export async function POST(req: Request) {
  const newCron = await req.json();
  const crons = await getCrons();

  const normalized = {
    ...newCron,
    scheduleType: newCron?.scheduleType === 'daily' ? 'daily' : 'interval',
    intervalMin: Math.max(1, Number(newCron?.intervalMin) || 5),
    dailyTime: typeof newCron?.dailyTime === 'string' ? newCron.dailyTime : '09:00',
  };
  
  if (!normalized.id) {
    normalized.id = `cron-${Date.now()}`;
    normalized.lastRun = 0;
    normalized.active = true;
  }
  
  crons.push(normalized);
  await saveCrons(crons);
  return NextResponse.json({ success: true, cron: normalized });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  let crons = await getCrons();
  crons = crons.filter((c: any) => c.id !== id);
  await saveCrons(crons);
  return NextResponse.json({ success: true });
}

export async function PUT(req: Request) {
  const updates = await req.json();
  let crons = await getCrons();
  crons = crons.map((c: any) => {
    if (c.id !== updates.id) return c;
    const merged = { ...c, ...updates };
    return {
      ...merged,
      scheduleType: merged?.scheduleType === 'daily' ? 'daily' : 'interval',
      intervalMin: Math.max(1, Number(merged?.intervalMin) || 5),
      dailyTime: typeof merged?.dailyTime === 'string' ? merged.dailyTime : '09:00',
    };
  });
  await saveCrons(crons);
  return NextResponse.json({ success: true });
}
