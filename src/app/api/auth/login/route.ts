import { NextResponse } from 'next/server';
import {
  createSessionToken,
  getAuthConfigSummary,
  getAuthCookieName,
  getSessionMaxAge,
  verifyLoginCredential,
} from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json() as { username?: string; password?: string };
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    const result = verifyLoginCredential(username, password);
    if (!result.ok) {
      if (result.reason === 'auth_disabled') {
        return NextResponse.json(
          { error: '登录未启用，请设置 CLAWCHATING_ADMIN_PASSWORD 环境变量。' },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: '用户名或密码错误。' }, { status: 401 });
    }

    const token = await createSessionToken(result.username);
    const response = NextResponse.json({ success: true, username: result.username });
    response.cookies.set({
      name: getAuthCookieName(),
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionMaxAge(),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(getAuthConfigSummary());
}
