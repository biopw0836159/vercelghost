// POST /api/auth/login
// 自有登入系統 —— 帳號 + 密碼（bcrypt hash）。無 2FA。
//
// Body:     { username, password }
// Response:
//   200 { code, token, username, must_change, exp }
//   400 { code, message }
//   401 { code, message }
//
// 流程：查 admin_users → bcrypt.compare → 簽 JWT（payload 含 must_change）
import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { signToken, safeError } from '@/lib/auth';

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, message: '請求格式錯誤' }, { status: 400 });
  }

  const { username, password } = body || {};
  if (!username || !password) {
    return NextResponse.json({ code: 400, message: '帳號密碼必填' }, { status: 400 });
  }

  let row: { username: string; password_hash: string; must_change: boolean } | null;
  try {
    const { data, error } = await supabase()
      .from('admin_users')
      .select('username,password_hash,must_change')
      .eq('username', String(username))
      .maybeSingle();
    if (error) throw error;
    row = data;
  } catch (e) {
    return safeError(500, e, '登入失敗，請稍後重試');
  }

  // 帳號不存在 / 密碼錯：回一致訊息，不洩漏帳號是否存在
  if (!row) {
    return NextResponse.json({ code: 401, message: '帳號或密碼錯誤' }, { status: 401 });
  }

  let valid = false;
  try {
    valid = await bcryptjs.compare(String(password), row.password_hash);
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json({ code: 401, message: '帳號或密碼錯誤' }, { status: 401 });
  }

  // 記錄登入時間 + IP（非阻塞，欄位未加也不影響登入）
  try {
    const xff = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    await supabase()
      .from('admin_users')
      .update({ last_login_at: new Date().toISOString(), last_login_ip: xff || null })
      .eq('username', row.username);
  } catch (e) {
    console.warn('[login] 記錄 last_login 失敗:', (e as Error).message);
  }

  const expSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  let token: string;
  try {
    token = signToken({ username: row.username, must_change: row.must_change === true });
  } catch (e) {
    return safeError(500, e, '伺服器配置缺失');
  }

  return NextResponse.json({
    code: 200,
    token,
    username: row.username,
    must_change: row.must_change === true,
    exp: expSec,
  });
}
