import { NextRequest, NextResponse } from 'next/server';
import { getAuthConfigSummary, getAuthCookieName, verifySessionToken } from '@/lib/auth';

const API_ALLOWLIST = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
]);

function isPublicPath(pathname: string) {
  return pathname === '/login';
}

function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

export async function proxy(req: NextRequest) {
  const { enabled } = getAuthConfigSummary();
  if (!enabled) {
    return NextResponse.next();
  }

  const pathname = req.nextUrl.pathname;

  if (API_ALLOWLIST.has(pathname) || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(getAuthCookieName())?.value;
  const session = await verifySessionToken(token);

  if (session) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
