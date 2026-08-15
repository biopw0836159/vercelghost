// GET /api/external-stats —— 外接遊戲統計（棋牌 / 電子 / 真人）同源代理
//
// 對應後台「報表查詢 → 外接統計」。與彩票的 lottery-stats 是兩套不同的資料，
// 欄位也不同：平台 / 彩种(遊戲名) / 人数 / 投注金额 / 返点 / 奖金 / 盈亏。
//
// ⚠ 實測到的三個口徑問題（2026-08-15，HS 平台 8/13），都是後端的，不要自作聰明修正：
//   1. platform=ALL 與單平台查詢結果不同：ALL 裡的 HS 有 14 筆（多一個 BTC/USDT，投注 90），
//      單查 HS 只有 13 筆。連查三次單平台都穩定，不是隨機波動。
//      → 本站照使用者指定的平台如實查，並在回應標明這個差異存在。
//   2. 盈虧算法不一致：多數是「投注-獎金-返點」，但 VR 那筆是「投注-獎金」（差額正好等於返點）。
//      → 一律採用後端給的盈虧值，不自己算，免得跟後台對不起來。
//   3. 人數欄位不完整：179 筆裡只有 40 筆有人數，138 筆有投注卻是 0 人。
//      → 照原值呈現並標註「部分遊戲無此資料」，不要拿來當分母算人均。
import { NextResponse } from 'next/server';
import { fetchOpenApi } from '@/lib/open-api';
import { cacheGet, cacheSet, ttlFor } from '@/lib/cache';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') || 'ALL';
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }

  const key = `external-stats|${platform}|${dateStart}|${dateEnd}`;
  const cached = cacheGet<unknown>(key);
  if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });

  const r = await fetchOpenApi('/api/open/external-game-stats', { platform, dateStart, dateEnd });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  cacheSet(key, r.rows, ttlFor(dateEnd));
  return NextResponse.json(r.rows, { headers: { 'x-cache': 'MISS' } });
}
