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

  let dbTest: any;
  try {
    const { data, error, count } = await supabase()
      .from('admin_users')
      .select('username', { count: 'exact', head: true });
    dbTest = error
      ? { ok: false, error: error.message, code: (error as any).code, hint: (error as any).hint }
      : { ok: true, count, sample: data };
  } catch (e) {
    dbTest = { ok: false, threw: (e as Error).message };
  }

  return NextResponse.json({ env, dbTest });
}
