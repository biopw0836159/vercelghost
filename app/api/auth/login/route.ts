// POST /api/auth/login —— 帳密登入，成功則種下 httpOnly session cookie
//
// 這是 IP 白名單之後的第二道。白名單擋的是「從哪裡來」，這道擋的是「你是誰」。
// 帳密存環境變數 AUTH_USERS（scrypt 雜湊），不進資料庫；session 是 HMAC 簽名的 cookie，
// 由 proxy.ts 在伺服器端驗證，前端動不了。
import { NextResponse } from 'next/server';
import { verifyUser, createSession, authConfigured, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: '伺服器未設定帳號（需要環境變數 AUTH_USERS 與 AUTH_SECRET）' },
      { status: 503 },
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) {
    return NextResponse.json({ error: '請輸入帳號與密碼' }, { status: 400 });
  }

  if (!verifyUser(username, password)) {
    // 不區分「帳號不存在」與「密碼錯誤」，避免被用來試探帳號是否存在
    return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
  }

  const session = createSession(username);
  if (!session) {
    return NextResponse.json({ error: '伺服器未設定 AUTH_SECRET' }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,      // JS 讀不到，降低被竊取的風險
    sameSite: 'lax',
    secure: true,        // 只走 HTTPS（Railway 一律 HTTPS）
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
