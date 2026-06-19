// 臨時診斷端點 —— 只回報環境變數「是否存在」與長度，不回傳實際值。
// 確認線上環境變數生效後請刪除此檔。
import { NextResponse } from 'next/server';

export async function GET() {
  const peek = (v?: string) => ({ set: !!v, len: v ? v.length : 0 });
  return NextResponse.json({
    SUPABASE_URL: peek(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: peek(process.env.SUPABASE_SERVICE_ROLE_KEY),
    JWT_SECRET: peek(process.env.JWT_SECRET),
    // SUPABASE_URL 開頭（只露前 16 碼，方便確認專案對不對，不算機密）
    url_prefix: (process.env.SUPABASE_URL || '').slice(0, 16),
  });
}
