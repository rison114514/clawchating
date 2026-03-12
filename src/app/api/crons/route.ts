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
  
  if (!newCron.id) {
    newCron.id = `cron-${Date.now()}`;
    newCron.lastRun = Date.now();
    newCron.active = true;
  }
  
  crons.push(newCron);
  await saveCrons(crons);
  return NextResponse.json({ success: true, cron: newCron });
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
  crons = crons.map((c: any) => c.id === updates.id ? { ...c, ...updates } : c);
  await saveCrons(crons);
  return NextResponse.json({ success: true });
}
