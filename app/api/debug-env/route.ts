// 臨時診斷端點 —— 回報環境變數是否存在 + 實際對 Supabase 查一次，回傳真正的錯誤。
// 不回傳任何機密值。確認後請刪除此檔。
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const peek = (v?: string) => ({ set: !!v, len: v ? v.length : 0 });
  const rawUrl = process.env.SUPABASE_URL || '';
  const env = {
    // Project URL 本來就前端可見、非機密 —— 完整印出以排查格式
    SUPABASE_URL_full: rawUrl,
    SUPABASE_URL_len: rawUrl.length,
    SUPABASE_URL_endsWithSlash: rawUrl.endsWith('/'),
    SUPABASE_URL_hasPath: /supabase\.co\/.+/.test(rawUrl),
    SUPABASE_SERVICE_ROLE_KEY: peek(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SERVICE_KEY_prefix: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 6),
    JWT_SECRET: peek(process.env.JWT_SECRET),
  };

  // A) 計算總筆數
  let countTest: any;
  try {
    const { error, count } = await supabase()
      .from('admin_users')
      .select('username', { count: 'exact', head: true });
    countTest = error
      ? { ok: false, error: error.message, code: (error as any).code }
      : { ok: true, count };
  } catch (e) {
    countTest = { ok: false, threw: (e as Error).message };
  }

  // B) 比較「有空格」vs「無空格」的 select
  const trySelect = async (cols: string) => {
    try {
      const { data, error } = await supabase()
        .from('admin_users')
        .select(cols)
        .eq('username', 'shane')
        .maybeSingle();
      return error
        ? { ok: false, error: error.message, code: (error as any).code }
        : { ok: true, found: !!data };
    } catch (e) {
      return { ok: false, threw: (e as Error).message };
    }
  };
  const withSpaces = await trySelect('username, password_hash, must_change');
  const noSpaces = await trySelect('username,password_hash,must_change');

  return NextResponse.json({ env, countTest, withSpaces, noSpaces });
}
