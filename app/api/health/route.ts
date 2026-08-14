// GET /api/health —— 給 Railway healthcheck 用。
//
// 必須排除在 IP 白名單之外（見 proxy.ts 的 matcher）：healthcheck 由 Railway
// 內部發起，來源 IP 不會在白名單裡，若被擋成 403 會被判定為不健康而重啟循環。
// 因此這裡只回固定值，不吐任何環境資訊或資料。
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
