// GET /api/new-members —— 新進會員查詢 + 批量創號特徵彙總
//
// 資料源：POST /api/v1/new-members（見 lib/engines.ts 的實測限制註記）
//
// 這支只做「把同一個值的帳號歸在一起、算出集中度」這件事，**不下任何結論**。
// 同上級 / 同獎金號 / 同 IP 只是事實陳述，是不是同一批人要人工判斷 ——
// 尤其同 IP 那項，機房出口會讓幾十個不相干的人共用，所以照樣分開標。
//
// Query：platform（選填，逗號分隔；留空 = 當期所有有資料的平台）
//        dateStart、dateEnd（yyyy-MM-dd，業務日 03:00 切點）
//        minGroup（選填，幾個帳號以上才算一組，預設 2）
import { NextResponse } from 'next/server';
import { resolvePlatforms } from '@/lib/platforms';
import { fetchNewMembers } from '@/lib/engines';
import { isDatacenterIp } from '@/lib/ip-class';
import { cacheGet, cacheSet, ttlFor } from '@/lib/cache';

export const runtime = 'nodejs';

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// 平台清單不寫死（會增減），從當期實際有資料的平台推導
// 平台清單的解析收斂在 lib/platforms.ts，見那裡的註解。

/** 把記錄按某個欄位分組，只留成員數達門檻的組 */
function groupBy<T extends { platform: string; account: string }>(
  rows: T[],
  keyOf: (r: T) => string,
  minGroup: number,
) {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(`${r.platform}/${r.account}`);
  }
  return [...m.entries()]
    .filter(([, members]) => members.length >= minGroup)
    .map(([value, members]) => ({ value, count: members.length, members }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platformParam = str(searchParams.get('platform'));
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');
  const minGroup = Math.max(2, Number(searchParams.get('minGroup')) || 2);

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }

  const cacheKey = `new-members|${platformParam}|${dateStart}|${dateEnd}|${minGroup}`;
  const cached = cacheGet<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });

  const plats = await resolvePlatforms(platformParam, dateStart, dateEnd);
  if (!plats) {
    return NextResponse.json(
      { error: '取不到平台清單（新進會員查詢的 platforms 必填，且不吃 ALL）。請在 platform 參數指定平台。' },
      { status: 502 },
    );
  }

  const r = await fetchNewMembers({ platforms: plats, dateStart, dateEnd });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // 正規化：後端欄位是中文，統一成好用的形狀，數值一律照原值不做加工
  const rows = r.records.map((x) => ({
    platform: str(x['平台']),
    account: str(x['会员账号']),
    teamSize: num(x['团队人数']),
    agent: str(x['上级']),
    balance: num(x['余额']),
    bonusCode: str(x['奖金']),
    registeredAt: str(x['注册时间']),
    firstDepositAt: str(x['首充日期']),
    firstDepositAmount: num(x['首充金额']),
    firstDepositChannel: str(x['首充管道']),
    lastLoginAt: str(x['最后登录']),
    lastLoginIp: str(x['最后登录IP']),
    source: str(x['来源']),
    regCode: str(x['注册码']),
  }));

  // ── 分組：同一個值的帳號歸在一起 ──
  const byAgent = groupBy(rows, r2 => (r2.agent ? `${r2.platform}/${r2.agent}` : ''), minGroup);
  const byBonusCode = groupBy(rows, r2 => (r2.bonusCode ? `${r2.platform}/${r2.bonusCode}` : ''), minGroup);
  const byRegCode = groupBy(rows, r2 => (r2.regCode ? `${r2.platform}/${r2.regCode}` : ''), minGroup);

  // 同 IP 另外處理：機房出口要標出來，不能跟住宅 IP 混為一談
  const ipGroups = groupBy(rows, r2 => r2.lastLoginIp, minGroup)
    .map(g => ({ ...g, datacenter: isDatacenterIp(g.value) }));

  // 首充金額集中度：同一個金額出現幾次（批量創號常見首充金額一致）
  const byFirstDeposit = groupBy(
    rows.filter(r2 => r2.firstDepositAmount > 0),
    r2 => String(r2.firstDepositAmount),
    minGroup,
  );

  // 創號時間密集：同平台同上級、30 分鐘內註冊 ≥ minGroup 個
  const WINDOW_MS = 30 * 60 * 1000;
  const timeClusters: { platform: string; agent: string; from: string; to: string; count: number; members: string[] }[] = [];
  const byAgentRows = new Map<string, typeof rows>();
  for (const r2 of rows) {
    if (!r2.agent || !r2.registeredAt) continue;
    const k = `${r2.platform}/${r2.agent}`;
    if (!byAgentRows.has(k)) byAgentRows.set(k, []);
    byAgentRows.get(k)!.push(r2);
  }
  for (const [k, list] of byAgentRows) {
    // 註冊時間是「YYYY-MM-DD HH:mm:ss」的當地時間字串，直接排序即可
    const sorted = [...list].sort((a, b) => a.registeredAt < b.registeredAt ? -1 : 1);
    let i = 0;
    while (i < sorted.length) {
      const start = new Date(sorted[i].registeredAt.replace(' ', 'T'));
      if (Number.isNaN(start.getTime())) { i++; continue; }
      let j = i;
      while (j + 1 < sorted.length) {
        const next = new Date(sorted[j + 1].registeredAt.replace(' ', 'T'));
        if (Number.isNaN(next.getTime()) || next.getTime() - start.getTime() > WINDOW_MS) break;
        j++;
      }
      const n = j - i + 1;
      if (n >= minGroup) {
        const [platform, agent] = k.split('/');
        timeClusters.push({
          platform, agent,
          from: sorted[i].registeredAt,
          to: sorted[j].registeredAt,
          count: n,
          members: sorted.slice(i, j + 1).map(x => x.account),
        });
      }
      i = j + 1;
    }
  }
  timeClusters.sort((a, b) => b.count - a.count);

  const payload = {
    summary: {
      records: rows.length,
      platforms: plats,
      platformCount: plats.length,
      minGroup,
      bytes: r.bytes,
      // 後端各平台抓取時的錯誤（有的話代表那個平台這批資料不完整）
      upstreamErrors: r.errors,
      withFirstDeposit: rows.filter(r2 => r2.firstDepositAmount > 0).length,
      withRegCode: rows.filter(r2 => r2.regCode).length,
      // 業務日 03:00 切點，查一天會涵蓋到隔天，如實說明不做湊整
      dateNote: `業務日 ${dateStart} 03:00 ～ ${dateEnd} 隔日 03:00（UTC+8），所以註冊時間會出現隔天日期`,
      query: { platform: platformParam || null, dateStart, dateEnd },
    },
    byAgent,
    byBonusCode,
    byRegCode,
    byIp: ipGroups,
    byFirstDeposit,
    timeClusters,
    members: rows,
  };

  cacheSet(cacheKey, payload, ttlFor(dateEnd));
  return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
}
