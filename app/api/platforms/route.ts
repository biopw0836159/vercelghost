// GET /api/platforms —— 取當期實際有資料的平台清單
//
// 清單刻意不寫死：平台會增減（TD 是 2026-08 才加的），寫死會在新平台上線時
// 靜默少算。改從 lottery-stats 當期回傳的資料推導，有快取所以不會每次都慢。
//
// 系列歸屬（DY / KR / LJ）是爬蟲登入邏輯的分組，變動少所以有一份對照表，
// 但**不在對照表裡的平台一律歸到「其他」照樣列出**，不會因為對照表沒更新就消失。
//
// Query：dateStart、dateEnd（yyyy-MM-dd）
import { NextResponse } from 'next/server';
import { fetchOpenApi } from '@/lib/open-api';
import { cacheGet, cacheSet } from '@/lib/cache';

export const runtime = 'nodejs';

// 平台清單刻意只快取 3 分鐘，不跟著「歷史日期已定型」給 30 分鐘。
// 原因：2026-08-15 實測踩到 —— 後端某次回應少了 LS 平台（直接連打三次都是 18 個，
// 只有那一次是 17 個），結果被快取 30 分鐘，期間使用者看不到 LS 的勾選按鈕、
// 查詢就會靜默漏掉那個平台。這是結構性資料，錯一次的代價是漏算整個平台，
// 所以寧可多打幾次後端，也要讓異常在幾分鐘內自癒。
const PLATFORM_TTL_MS = 3 * 60 * 1000;

const SERIES: Record<string, string> = {
  XH: 'DY', LS: 'DY', OL: 'DY', XY: 'DY',
  SH: 'KR', YS: 'KR', JY: 'KR', HS: 'KR', FB: 'KR', SY: 'KR', LY: 'KR',
  MT: 'KR', JD: 'KR', ND: 'KR', YD: 'KR', RF: 'KR', TD: 'KR',
  XO: 'LJ',
};
const SERIES_ORDER = ['DY', 'KR', 'LJ', '其他'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }

  const key = `platform-list|${dateStart}|${dateEnd}`;
  const cached = cacheGet<unknown>(key);
  if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });

  const r = await fetchOpenApi('/api/open/lottery-stats', { platform: 'ALL', dateStart, dateEnd });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const codes = [...new Set(
    r.rows.map((x: Record<string, unknown>) => String(x['平台'] ?? x['platform'] ?? '').trim()).filter(Boolean),
  )].sort();

  const grouped = SERIES_ORDER.map(series => ({
    series,
    platforms: codes.filter(c => (SERIES[c] ?? '其他') === series),
  })).filter(g => g.platforms.length > 0);

  const payload = { platforms: codes, count: codes.length, grouped, dateStart, dateEnd };
  cacheSet(key, payload, PLATFORM_TTL_MS);
  return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
}
