import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthConfigSummary, getAuthCookieName, verifySessionToken } from '@/lib/auth';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getAuthCookieName())?.value;
  const session = await verifySessionToken(token);

  return NextResponse.json({
    ...getAuthConfigSummary(),
    authenticated: !!session,
    username: session?.u || null,
  });
}
