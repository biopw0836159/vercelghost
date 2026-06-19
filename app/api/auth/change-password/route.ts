// POST /api/auth/change-password
// 修改密碼 —— 驗 Bearer JWT + 驗舊密碼 → 更新新密碼 hash + must_change=false
//
// Header: Authorization: Bearer <JWT>
// Body:   { username, old_password, new_password }
// Response:
//   200 { code, message }
//   400 / 401 / 403 { code, message }
//
// 安全性：只能改自己（body.username 必須等於 JWT 內的 username）+ 必須驗舊密碼。
import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { verifyJwt, bearerToken, safeError } from '@/lib/auth';

export async function POST(req: Request) {
  const v = verifyJwt(bearerToken(req));
  if (!v.ok) {
    return NextResponse.json({ code: 401, message: v.error }, { status: 401 });
  }

  let body: { username?: string; old_password?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, message: '請求格式錯誤' }, { status: 400 });
  }

  const { username, old_password, new_password } = body || {};
  if (!username || !old_password || !new_password) {
    return NextResponse.json({ code: 400, message: 'username / old_password / new_password 必填' }, { status: 400 });
  }
  if (String(username) !== v.payload.username) {
    return NextResponse.json({ code: 403, message: '不能修改其他人的密碼' }, { status: 403 });
  }
  if (String(new_password).length < 6) {
    return NextResponse.json({ code: 400, message: '新密碼至少 6 位' }, { status: 400 });
  }
  if (String(new_password) === String(old_password)) {
    return NextResponse.json({ code: 400, message: '新密碼不能跟舊密碼一樣' }, { status: 400 });
  }

  let row: { password_hash: string } | null;
  try {
    const { data, error } = await supabase()
      .from('admin_users')
      .select('password_hash')
      .eq('username', String(username))
      .maybeSingle();
    if (error) throw error;
    row = data;
  } catch (e) {
    return safeError(500, e, '改密失敗，請稍後重試');
  }

  if (!row) {
    return NextResponse.json({ code: 401, message: '帳號不存在' }, { status: 401 });
  }

  let valid = false;
  try {
    valid = await bcryptjs.compare(String(old_password), row.password_hash);
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json({ code: 401, message: '舊密碼錯誤' }, { status: 401 });
  }

  try {
    const newHash = await bcryptjs.hash(String(new_password), 10);
    const { error: updErr } = await supabase()
      .from('admin_users')
      .update({ password_hash: newHash, must_change: false, updated_at: new Date().toISOString() })
      .eq('username', String(username));
    if (updErr) throw updErr;
  } catch (e) {
    return safeError(500, e, '改密失敗，請稍後重試');
  }

  return NextResponse.json({ code: 200, message: '密碼已修改' });
}
