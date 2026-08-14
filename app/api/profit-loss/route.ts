// GET /api/profit-loss —— B 引擎（會員盈虧）同源代理
//
// 這支才是 B 引擎五條抓鬼規則的正確資料源：回傳投注/獎金/返點/工資/充值/提款，
// 三個窗口 today | month | lifetime，另附團隊欄位與代理樹。
//
// 注意：不要跟 /api/member-income 搞混 —— 那支（open API）任何日期都回 0 筆。
// 也注意 B 引擎只吃 today/month/lifetime 三個窗口，不支援任意日期區間。
//
// Query：platform（必填，單一平台）、username（必填）、periods（逗號分隔，預設 today,month）
import { NextResponse } from 'next/server';
import { fetchProfitLoss } from '@/lib/engines';
import { cacheGet, cacheSet } from '@/lib/cache';

export const runtime = 'nodejs';

const ALLOWED_PERIODS = ['today', 'month', 'lifetime'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get('platform') || '').trim().toUpperCase();
  const username = (searchParams.get('username') || '').trim();
  const periodsRaw = (searchParams.get('periods') || 'today,month').trim();

  if (!platform) return NextResponse.json({ error: '必須提供 platform（單一平台代號，例如 OL）' }, { status: 400 });
  if (!username) return NextResponse.json({ error: '必須提供 username（B 引擎只能逐個會員查）' }, { status: 400 });

  const periods = periodsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const bad = periods.filter(p => !ALLOWED_PERIODS.includes(p));
  if (bad.length) {
    return NextResponse.json(
      { error: `periods 只能是 ${ALLOWED_PERIODS.join(' / ')}（B 引擎不支援任意日期區間），收到：${bad.join(',')}` },
      { status: 400 },
    );
  }

  // today 會一直變，給短 TTL；只查 month/lifetime 的可以放久一點
  const key = `profit-loss|${platform}|${username}|${periods.slice().sort().join(',')}`;
  const cached = cacheGet<unknown>(key);
  if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });

  const r = await fetchProfitLoss(platform, username, periods);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const payload = {
    platform,
    username,
    found: r.found,
    accountNotFound: r.accountNotFound,
    windows: r.windows,
    ascendants: r.ascendants,
  };
  cacheSet(key, payload, periods.includes('today') ? 20 * 1000 : 10 * 60 * 1000);
  return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
}
