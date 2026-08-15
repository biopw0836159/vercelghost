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
import { getPlatformList } from '@/lib/platforms';

export const runtime = 'nodejs';

// 系統分組（爬蟲登入邏輯的依據），只影響畫面上怎麼分堆，不影響會查到哪些平台。
// 清單本身是動態的 —— 新平台一有資料就會自動出現，這張表沒更新也只是歸到「其他」。
// 新增平台時把代號加進來即可，順手在後面註記市場（阿森／威廉／事務）方便對照。
const SERIES: Record<string, string> = {
  // DY 系統
  XH: 'DY', LS: 'DY', OL: 'DY', XY: 'DY',
  // KR 系統
  SH: 'KR', YS: 'KR', JY: 'KR', HS: 'KR', FB: 'KR', SY: 'KR', LY: 'KR',
  MT: 'KR', JD: 'KR', ND: 'KR', YD: 'KR', RF: 'KR', TD: 'KR',
  DS: 'KR',   // 鼎上，威廉市場，2026-08 上線
  // LJ 系統
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

  const list = await getPlatformList(dateStart, dateEnd);
  if (!list) return NextResponse.json({ error: '取不到平台清單' }, { status: 502 });

  const { codes, sources, externalSourceOk } = list;
  const grouped = SERIES_ORDER.map(series => ({
    series,
    platforms: codes.filter(c => (SERIES[c] ?? '其他') === series),
  })).filter(g => g.platforms.length > 0);

  return NextResponse.json({
    platforms: codes,
    count: codes.length,
    grouped,
    sources,
    externalSourceOk,
    dateStart,
    dateEnd,
  });
}
