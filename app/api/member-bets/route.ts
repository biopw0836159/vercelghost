// GET /api/member-bets —— 注單定向深查，伺服器端彙總
//
// 為什麼要在伺服器端就彙總完：注單明細單次回應實測可達 264MB，
// 原封不動丟給瀏覽器會直接卡死，所以這裡只回彙總結果 + 少量樣本明細。
//
// ── 兩條資料源，依查詢對象自動分流（2026-08-14 實測後改）──
//   查會員 → C 引擎 POST /api/query-bet-orders
//     每頁 5000 筆可用 cursor 翻到底（無 1 萬筆硬上限）、同一查詢快 3 倍、
//     且多回 real_earn（真實盈虧）/ bet_content（投注內容）/ open_code（開獎號）/ win_count。
//     限制：platforms 必填（省略、空陣列、'ALL' 都回 400 或 0 筆），且不吃 lottery / cycle_value。
//   查彩種或期號 → 舊的 GET /api/v1/member-bets
//     C 引擎沒有這兩個參數，只能繼續走這支；它會串彩種、也有 1 萬筆硬上限，
//     所以結果一律附上串號警告與截斷警告。
//
// Query：username / lottery / cycleValue 至少給一個，加上 dateStart、dateEnd（yyyy-MM-dd）
//        platform（選填，查會員時指定可省一次平台清單查詢）、shift（早/中/晚，選填）
import { NextResponse } from 'next/server';
import { fetchOpenApi, fetchOpenApiLarge } from '@/lib/open-api';
import { fetchBetOrders } from '@/lib/engines';
import { isDatacenterIp } from '@/lib/ip-class';
import { cacheGet, cacheSet, ttlFor } from '@/lib/cache';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const SAMPLE_LIMIT = 200;

// ── 班別切分 ──
// 早 08:00–16:00、中 16:00–24:00、晚 00:00–08:00（同一自然日切三段）。
//
// 時區：後端 bet_time 結尾標 Z（看起來是 UTC），但實測證明它存的其實是「當地時間」。
// 證據 —— 用開獎時段固定的彩種當標尺（2026-08-14 實測 8/12 資料）：
//   经典重庆时时彩 字面值 10:01:00 ~ 次日 01:56:00，
//     與該彩種公認的「每天 10:00 開盤、次日 02:00 收盤」完全吻合；
//     若當成 UTC 再 +8 會變成 18:01 ~ 09:56，對不上。
//   福彩3D（20:30 開獎）樣本 175/200 落在字面 21 時（投次日期），
//     若 +8 會變成凌晨 5 點投注，不合理。
// 所以預設偏移是 0：直接採用字面值。留這個環境變數是為了萬一後端哪天改成真 UTC。
const SHIFT_TZ_OFFSET_HOURS = Number(process.env.SHIFT_TZ_OFFSET_HOURS ?? 0);

// C 引擎的 platforms 必填。清單不寫死 —— 平台會增減（TD 就是 2026-08 才加的），
// 寫死會在新平台上線時靜默少算。改從 lottery-stats 當期實際有資料的平台推導。
async function resolvePlatforms(explicit: string, dateStart: string, dateEnd: string): Promise<string[] | null> {
  if (explicit) {
    const list = explicit.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) return list;
  }
  const key = `platforms|${dateStart}|${dateEnd}`;
  const cached = cacheGet<string[]>(key);
  if (cached) return cached;

  const r = await fetchOpenApi('/api/open/lottery-stats', { platform: 'ALL', dateStart, dateEnd });
  if (!r.ok) return null;
  const list = [...new Set(
    r.rows.map((x: Record<string, unknown>) => String(x['平台'] ?? x['platform'] ?? '').trim()).filter(Boolean),
  )];
  if (!list.length) return null;
  cacheSet(key, list, ttlFor(dateEnd));
  return list;
}

// 兩個引擎欄位名不同，先正規化成同一種形狀再進彙總，下游邏輯不用各寫一套
type Bet = {
  username: string; platform: string; ip: string; lottery: string;
  playType: string; cycleValue: string; betAmount: number; winAmount: number;
  status: string; isWin: boolean; betTime: string;
  realEarn: number | null; betContent: string | null; openCode: string | null;
};

function normalizeC(b: Record<string, unknown>): Bet {
  // 判中獎一定要看 status_str（= 舊引擎的 state），不能用 win_count ——
  // 實測 win_count 整批都是 0（772 筆全 0），而 status_str 的 WIN 有 160 筆、
  // 與舊引擎 state 的分布完全一致（NOPRIZE 609 / WIN 160 / CANCEL 3）。
  const status = String(b.status_str ?? '').toUpperCase();
  return {
    username: String(b.username ?? '-'),
    platform: String(b.platform ?? '-'),
    ip: String(b.user_ip ?? '').trim(),
    lottery: String(b.lottery ?? ''),
    playType: String(b.play_name || b.play_type || ''),
    cycleValue: String(b.cycle_value ?? ''),
    betAmount: num(b.bet_amount),
    winAmount: num(b.win_amount),
    status,
    isWin: status === 'WIN',
    betTime: String(b.bet_time ?? ''),
    realEarn: b.real_earn === undefined || b.real_earn === null || b.real_earn === '' ? null : num(b.real_earn),
    betContent: b.bet_content ? String(b.bet_content) : null,
    openCode: b.open_code ? String(b.open_code) : null,
  };
}

function normalizeV1(b: Record<string, unknown>): Bet {
  const status = String(b.state ?? '').toUpperCase();
  return {
    username: String(b.username ?? '-'),
    platform: String(b.platform ?? '-'),
    ip: String(b.user_ip ?? '').trim(),
    lottery: String(b.lottery ?? ''),
    playType: String(b.play_type || b.play_name || ''),
    cycleValue: String(b.cycle_value ?? ''),
    betAmount: num(b.bet_amount),
    winAmount: num(b.win_amount),
    status,
    isWin: status === 'WIN',
    betTime: String(b.bet_time ?? ''),
    realEarn: null, betContent: null, openCode: null,
  };
}

function shiftOf(betTime: unknown): { date: string; shift: '早' | '中' | '晚' } | null {
  if (!betTime) return null;
  const t = new Date(String(betTime));
  if (Number.isNaN(t.getTime())) return null;
  // 位移後用 UTC 取值，等同於「換算成當地時間再取日期與小時」
  const local = new Date(t.getTime() + SHIFT_TZ_OFFSET_HOURS * 3600000);
  const h = local.getUTCHours();
  return {
    date: local.toISOString().slice(0, 10),
    shift: h < 8 ? '晚' : h < 16 ? '早' : '中',
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get('username')?.trim() || '';
  const lottery = searchParams.get('lottery')?.trim() || '';
  const cycleValue = searchParams.get('cycleValue')?.trim() || '';
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');
  // 時段篩選：只算選定班別的注單。空字串 = 不篩、全部時段。
  const shiftFilter = (searchParams.get('shift') || '').trim();

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }
  if (!username && !lottery && !cycleValue) {
    return NextResponse.json(
      { error: '定向深查必須指定對象：會員帳號、彩種、期號至少填一個' },
      { status: 400 },
    );
  }
  if (shiftFilter && !['早', '中', '晚'].includes(shiftFilter)) {
    return NextResponse.json({ error: 'shift 只能是 早 / 中 / 晚，或不傳代表全部時段' }, { status: 400 });
  }

  const platformParam = (searchParams.get('platform') || '').trim();

  // 彙總後的結果不大（幾十 KB），但拉明細本身要好幾秒，同條件重複查直接給快取
  const cacheKey = `member-bets|${username}|${lottery}|${cycleValue}|${dateStart}|${dateEnd}|${shiftFilter}|${platformParam}`;
  const cached = cacheGet<unknown>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });

  // ── 依查詢對象分流資料源 ──
  let rows: Bet[];
  let sourceEngine: 'C' | 'v1';
  let truncated: boolean;
  let bytes: number;
  let pages = 0;
  let capMessage = '';

  if (username && !lottery && !cycleValue) {
    // 查會員 → C 引擎（有分頁、欄位多、較快）
    const plats = await resolvePlatforms(platformParam, dateStart, dateEnd);
    if (!plats) {
      return NextResponse.json(
        { error: '取不到平台清單（C 引擎的 platforms 必填）。請在 platform 參數指定平台，或稍後再試。' },
        { status: 502 },
      );
    }
    const c = await fetchBetOrders({ platforms: plats, dateStart, dateEnd, username });
    if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
    rows = c.records.map(normalizeC);
    sourceEngine = 'C';
    truncated = c.truncated;
    bytes = c.bytes;
    pages = c.pages;
    capMessage = c.capMessage;
  } else {
    // 查彩種 / 期號 → C 引擎沒有這兩個參數，只能走舊端點
    const params: Record<string, string> = { date_start: dateStart, date_end: dateEnd };
    if (username) params.username = username;
    if (lottery) params.lottery = lottery;
    if (cycleValue) params.cycle_value = cycleValue;

    const r = await fetchOpenApiLarge('/api/v1/member-bets', params);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    rows = r.rows.map(normalizeV1);
    sourceEngine = 'v1';
    truncated = r.truncated;
    bytes = r.bytes;
  }

  // ── 彙總到會員維度 ──
  type Agg = {
    username: string; platforms: Set<string>; lotteries: Set<string>; ips: Set<string>;
    bets: number; betAmount: number; winAmount: number; wins: number;
    firstBet: string; lastBet: string;
  };
  type ShiftAgg = {
    date: string; shift: string; bets: number; betAmount: number; winAmount: number;
    members: Set<string>; firstBet: string; lastBet: string;
  };
  const members = new Map<string, Agg>();
  const ipMap = new Map<string, Set<string>>();
  const shifts = new Map<string, ShiftAgg>();
  let betAmount = 0, winAmount = 0, wins = 0, noTime = 0;
  let counted = 0, excludedByShift = 0;
  // 樣本只放實際計入統計的注單，篩掉的不能混進來
  const sampleRows: Record<string, unknown>[] = [];
  // 這批資料實際涵蓋的時間範圍 —— 後端一天的邊界不是 00:00，如實把範圍標出來，
  // 不要替使用者湊自然日，一切以源頭給什麼為準。
  let spanFirst = '', spanLast = '';

  // C 引擎有 real_earn（後端算好的真實盈虧），有就用它，比自己拿派彩減投注準
  let realEarnSum = 0, realEarnRows = 0;
  // 撤單：源頭把 CANCEL 的注單也算進投注額裡，照源頭不動，但要標出來讓人知道
  let cancelled = 0, cancelledAmount = 0;

  for (const b of rows) {
    // 時段篩選要擺在所有彙總之前 —— 被篩掉的注單不能進任何統計
    const sh = shiftOf(b.betTime);
    if (shiftFilter) {
      if (!sh || sh.shift !== shiftFilter) { excludedByShift++; continue; }
    }

    const u = b.username;
    const amt = b.betAmount;
    const win = b.winAmount;
    counted++;
    if (sampleRows.length < SAMPLE_LIMIT) sampleRows.push(b as unknown as Record<string, unknown>);
    betAmount += amt; winAmount += win; if (b.isWin) wins++;
    if (b.status === 'CANCEL') { cancelled++; cancelledAmount += amt; }
    if (b.realEarn !== null) { realEarnSum += b.realEarn; realEarnRows++; }

    const bt = b.betTime;
    if (bt) {
      if (!spanFirst || bt < spanFirst) spanFirst = bt;
      if (!spanLast || bt > spanLast) spanLast = bt;
    }

    // 班別彙總
    if (!sh) {
      noTime++;
    } else {
      const key = `${sh.date}|${sh.shift}`;
      let sa = shifts.get(key);
      if (!sa) {
        sa = {
          date: sh.date, shift: sh.shift, bets: 0, betAmount: 0, winAmount: 0,
          members: new Set(), firstBet: bt, lastBet: bt,
        };
        shifts.set(key, sa);
      }
      sa.bets++;
      sa.betAmount += amt;
      sa.winAmount += win;
      sa.members.add(u);
      if (bt < sa.firstBet) sa.firstBet = bt;
      if (bt > sa.lastBet) sa.lastBet = bt;
    }

    let m = members.get(u);
    if (!m) {
      m = {
        username: u, platforms: new Set(), lotteries: new Set(), ips: new Set(),
        bets: 0, betAmount: 0, winAmount: 0, wins: 0,
        firstBet: bt, lastBet: bt,
      };
      members.set(u, m);
    }
    m.bets++;
    m.betAmount += amt;
    m.winAmount += win;
    if (b.isWin) m.wins++;
    if (b.platform && b.platform !== '-') m.platforms.add(b.platform);
    if (b.lottery) m.lotteries.add(b.lottery);
    if (bt) {
      if (!m.firstBet || bt < m.firstBet) m.firstBet = bt;
      if (!m.lastBet || bt > m.lastBet) m.lastBet = bt;
    }
    if (b.ip) {
      m.ips.add(b.ip);
      if (!ipMap.has(b.ip)) ipMap.set(b.ip, new Set());
      ipMap.get(b.ip)!.add(u);
    }
  }

  const byMember = [...members.values()]
    .map(m => ({
      username: m.username,
      platform: [...m.platforms].join(','),
      lotteryCount: m.lotteries.size,
      bets: m.bets,
      wins: m.wins,
      betAmount: m.betAmount,
      winAmount: m.winAmount,
      // 會員視角的盈虧：贏了多少。抓鬼要找的是這個數字大的人
      memberProfit: m.winAmount - m.betAmount,
      // RTP：這個會員拿回多少比例，接近或超過 1 代表打得贏莊家
      rtp: m.betAmount > 0 ? m.winAmount / m.betAmount : 0,
      ips: [...m.ips],
      ipCount: m.ips.size,
      firstBet: m.firstBet,
      lastBet: m.lastBet,
    }))
    .sort((a, b) => b.memberProfit - a.memberProfit);

  // ── 同 IP 多帳號（機房 IP 另外標記，別當成工作室證據）──
  const byIp = [...ipMap.entries()]
    .filter(([, us]) => us.size >= 2)
    .map(([ip, us]) => ({
      ip,
      memberCount: us.size,
      members: [...us],
      datacenter: isDatacenterIp(ip),
    }))
    .sort((a, b) => b.memberCount - a.memberCount);

  // ── 彩種串號偵測 ──
  // 後端的 lottery 參數會把「帶編號」的名稱映射到別的彩種（實測 排列五(15) → 排列三五、
  // QQ分分彩(218) → QQ分分彩），而且 lottery-stats 與明細之間還有簡繁字差異（经/經）。
  // 只要回來的彩種名跟查詢名對不上，這批數字就不能當成「該彩種」的數字用。
  let lotteryWarning: { queried: string; actual: string[] } | null = null;
  if (lottery) {
    const actual = [...new Set([...members.values()].flatMap(m => [...m.lotteries]))];
    if (actual.length !== 1 || actual[0] !== lottery) {
      lotteryWarning = { queried: lottery, actual };
    }
  }

  const SHIFT_ORDER: Record<string, number> = { 早: 0, 中: 1, 晚: 2 };
  const byShift = [...shifts.values()]
    .map(s => ({
      date: s.date,
      shift: s.shift,
      bets: s.bets,
      betAmount: s.betAmount,
      winAmount: s.winAmount,
      housePnl: s.betAmount - s.winAmount,
      memberCount: s.members.size,
      firstBet: s.firstBet,
      lastBet: s.lastBet,
    }))
    .sort((a, b) => a.date === b.date
      ? (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9)
      : a.date < b.date ? -1 : 1);

  const payload = {
    summary: {
      // records 是「實際計入統計」的筆數；有做時段篩選時會小於源頭回傳的總筆數
      records: counted,
      recordsFromSource: rows.length,
      shift: shiftFilter || null,
      excludedByShift,
      truncated,
      bytes,
      // 這批資料是從哪支引擎來的：C = query-bet-orders（有分頁、欄位多）、v1 = 舊 member-bets
      engine: sourceEngine,
      pages,
      capMessage: capMessage || null,
      // C 引擎才有 real_earn；有的話一併回報，可與 housePnl 交叉核對
      realEarnSum: realEarnRows ? realEarnSum : null,
      realEarnRows,
      // 撤單筆數與其投注額（已含在上面的 betAmount 裡，源頭就是這樣算的）
      cancelled,
      cancelledAmount,
      memberCount: members.size,
      ipCount: ipMap.size,
      betAmount,
      winAmount,
      // 莊家視角（跟 A 引擎的「盈虧」同方向）
      housePnl: betAmount - winAmount,
      winRecords: wins,
      // 班別切分用的時區偏移，以及沒有有效 bet_time 而無法歸班的筆數
      shiftTzOffsetHours: SHIFT_TZ_OFFSET_HOURS,
      recordsWithoutTime: noTime,
      lotteryWarning,
      // 源頭這次實際給了哪一段（後端一天的邊界在當地 03:00，不是 00:00）
      spanFirst,
      spanLast,
      query: { username, lottery, cycleValue, dateStart, dateEnd, shift: shiftFilter || null },
    },
    byShift,
    byMember,
    byIp,
    sample: sampleRows,
  };

  cacheSet(cacheKey, payload, ttlFor(dateEnd));
  return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
}
