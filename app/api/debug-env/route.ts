// 臨時診斷端點 —— 回報環境變數是否存在 + 實際對 Supabase 查一次，回傳真正的錯誤。
// 不回傳任何機密值。確認後請刪除此檔。
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const peek = (v?: string) => ({ set: !!v, len: v ? v.length : 0 });
  const env = {
    SUPABASE_URL: peek(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: peek(process.env.SUPABASE_SERVICE_ROLE_KEY),
    JWT_SECRET: peek(process.env.JWT_SECRET),
    url_prefix: (process.env.SUPABASE_URL || '').slice(0, 16),
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

  // B) 跟 login 完全一樣的查詢（用 shane 試），把真正的錯誤吐出來
  let loginQueryTest: any;
  try {
    const { data, error } = await supabase()
      .from('admin_users')
      .select('username, password_hash, must_change')
      .eq('username', 'shane')
      .maybeSingle();
    loginQueryTest = error
      ? { ok: false, error: error.message, code: (error as any).code, hint: (error as any).hint }
      : { ok: true, found: !!data, must_change: data?.must_change, hash_len: data?.password_hash?.length ?? null };
  } catch (e) {
    loginQueryTest = { ok: false, threw: (e as Error).message };
  }

  return NextResponse.json({ env, countTest, loginQueryTest });
}
