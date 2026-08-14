// GET /api/member-enrich —— 對一批會員逐個補 B 引擎資料，並套用五條抓鬼規則
//
// ⚠ 重要限制：B 引擎只吃 today / month / lifetime 三個窗口，**不支援任意日期區間**。
// 所以查歷史日期的注單時，這裡補回來的充值/返點/工資是「今天」或「本月」的數字，
// 對應不到那一天。回傳一律帶 window 欄位，前端必須顯眼標示，不能讓人誤以為是查詢日的數據。
//
// B 引擎只能逐個會員查（實測 loginIds 陣列與不帶 loginId 都回 400），約 1 秒/人，
// 所以這裡限量 + 併發，並如實回報查了幾個、幾個失敗。
//
// Query：members=平台:帳號,平台:帳號…（最多 30 個）、window=today|month|lifetime（預設 today）
//        以及五條規則的門檻（全部選填，不填該條就不啟用）
import { NextResponse } from 'next/server';
import { fetchProfitLoss, type ProfitLossBlock } from '@/lib/engines';
import { cacheGet, cacheSet } from '@/lib/cache';

export const runtime = 'nodejs';

const MAX_MEMBERS = 30;
const CONCURRENCY = 6;

const numParam = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get('members') || '').trim();
  const win = (searchParams.get('window') || 'today').trim();

  if (!raw) return NextResponse.json({ error: '必須提供 members（格式 平台:帳號,平台:帳號）' }, { status: 400 });
  if (!['today', 'month', 'lifetime'].includes(win)) {
    return NextResponse.json({ error: 'window 只能是 today / month / lifetime（B 引擎不支援任意日期）' }, { status: 400 });
  }

  const parsed = raw.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf(':');
    if (i <= 0) return null;
    return { platform: pair.slice(0, i).trim().toUpperCase(), username: pair.slice(i + 1).trim() };
  }).filter((x): x is { platform: string; username: string } => !!x && !!x.username);

  if (!parsed.length) return NextResponse.json({ error: 'members 格式不對，應為 平台:帳號,平台:帳號' }, { status: 400 });

  const capped = parsed.length > MAX_MEMBERS;
  const list = parsed.slice(0, MAX_MEMBERS);

  // 五條規則門檻（沿用原本 B 引擎那五條的定義，見 docs/API-現狀.md 第五之二節）
  const th = {
    ratioHigh: numParam(searchParams.get('ratioHigh')),
    r1SalesMin: numParam(searchParams.get('r1SalesMin')),
    r1SalesMax: numParam(searchParams.get('r1SalesMax')),
    ratioLow: numParam(searchParams.get('ratioLow')),
    r2DepositMin: numParam(searchParams.get('r2DepositMin')),
    r2DepositMax: numParam(searchParams.get('r2DepositMax')),
    treatmentMin: numParam(searchParams.get('treatmentMin')),
    profitMin: numParam(searchParams.get('profitMin')),
    r5SalesMin: numParam(searchParams.get('r5SalesMin')),
  };

  const results = await mapPool(list, CONCURRENCY, async ({ platform, username }) => {
    const key = `enrich|${platform}|${username}|${win}`;
    const hit = cacheGet<Record<string, unknown>>(key);
    if (hit) return hit;

    const r = await fetchProfitLoss(platform, username, [win]);
    if (!r.ok) {
      return { platform, username, ok: false, error: r.error };
    }
    const blk: ProfitLossBlock | null = r.windows[win]?.personal ?? null;
    if (!blk) {
      return { platform, username, ok: true, found: false, accountNotFound: r.accountNotFound, ascendants: r.ascendants };
    }

    // 欄位對應到原本五條規則的用語
    const totalSales = blk.bet;          // 銷量
    const deposit = blk.recharge;        // 充值
    const treatment = blk.returnPoint;   // 返點
    const activity = blk.activity;       // 工資／活動
    const profit = blk.profit;           // 盈虧（會員視角，正 = 會員贏）
    const ratio = deposit > 0 ? totalSales / deposit : null;

    const matched: string[] = [];
    if (th.ratioHigh !== null && deposit > 0 && ratio !== null && ratio >= th.ratioHigh
      && (th.r1SalesMin === null || totalSales >= th.r1SalesMin)
      && (th.r1SalesMax === null || totalSales <= th.r1SalesMax)) matched.push('充銷比高');
    if (th.ratioLow !== null && deposit > 0 && ratio !== null && ratio <= th.ratioLow
      && (th.r2DepositMin === null || deposit >= th.r2DepositMin)
      && (th.r2DepositMax === null || deposit <= th.r2DepositMax)) matched.push('充銷比低');
    if (th.treatmentMin !== null && treatment >= th.treatmentMin) matched.push('高返點');
    if (th.profitMin !== null && profit >= th.profitMin) matched.push('大額盈利');
    if (th.r5SalesMin !== null && deposit === 0 && totalSales > 0 && totalSales >= th.r5SalesMin) matched.push('無充值銷量高');

    const out = {
      platform, username, ok: true, found: true,
      totalSales, deposit, treatment, activity, profit,
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      withdrawal: blk.withdrawal, bonus: blk.bonus,
      matched,
      ascendants: r.ascendants,
    };
    // today 一直在變給短 TTL，month/lifetime 可以放久一點
    cacheSet(key, out, win === 'today' ? 20 * 1000 : 10 * 60 * 1000);
    return out;
  });

  const okCount = results.filter(x => (x as { ok?: boolean }).ok).length;
  const foundCount = results.filter(x => (x as { found?: boolean }).found).length;

  return NextResponse.json({
    window: win,
    // 說清楚這批數字的時間口徑，避免被誤當成查詢日的數據
    windowNote: win === 'today'
      ? 'B 引擎只有 today/month/lifetime 三個窗口。這裡是「今天」的數字，若你查的是歷史日期，對應不上那一天。'
      : win === 'month'
        ? 'B 引擎只有 today/month/lifetime 三個窗口。這裡是「本月累計」的數字，不是查詢日當天。'
        : 'B 引擎只有 today/month/lifetime 三個窗口。這裡是「歷史累計」的數字，不是查詢日當天。',
    requested: parsed.length,
    queried: list.length,
    capped,
    okCount,
    foundCount,
    thresholds: th,
    members: results,
  });
}
