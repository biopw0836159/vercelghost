// GET /api/member-bets —— B 引擎（定向深查）同源代理 + 伺服器端彙總
//
// 為什麼要在伺服器端就彙總完：後端注單明細單次回應實測可達 264MB，
// 原封不動丟給瀏覽器會直接卡死，所以這裡只回彙總結果 + 少量樣本明細。
//
// Query：username / lottery / cycleValue 至少給一個，加上 dateStart、dateEnd（yyyy-MM-dd）
// 注意後端 /api/v1/* 用底線參數（date_start），跟 /api/open/* 的小駝峰不同。
import { NextResponse } from 'next/server';
import { fetchOpenApiLarge } from '@/lib/open-api';
import { isDatacenterIp } from '@/lib/ip-class';

export const runtime = 'nodejs';

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const SAMPLE_LIMIT = 200;

// ── 班別切分 ──
// 早 08:00–16:00、中 16:00–24:00、晚 00:00–08:00（同一自然日切三段）。
// 後端 bet_time 標的是 UTC（結尾 Z），但班別講的是當地時間，兩者要先對齊。
// 時區偏移用環境變數調，預設 +8；回傳會附上每班實際的時間範圍，方便人工核對對不對。
const SHIFT_TZ_OFFSET_HOURS = Number(process.env.SHIFT_TZ_OFFSET_HOURS ?? 8);

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

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }
  if (!username && !lottery && !cycleValue) {
    return NextResponse.json(
      { error: '定向深查必須指定對象：會員帳號、彩種、期號至少填一個' },
      { status: 400 },
    );
  }

  const params: Record<string, string> = { date_start: dateStart, date_end: dateEnd };
  if (username) params.username = username;
  if (lottery) params.lottery = lottery;
  if (cycleValue) params.cycle_value = cycleValue;

  const r = await fetchOpenApiLarge('/api/v1/member-bets', params);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

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

  for (const b of r.rows) {
    const u = String(b.username ?? '-');
    const amt = num(b.bet_amount);
    const win = num(b.win_amount);
    const isWin = String(b.state ?? '').toUpperCase() === 'WIN';
    betAmount += amt; winAmount += win; if (isWin) wins++;

    // 班別彙總
    const sh = shiftOf(b.bet_time);
    if (!sh) {
      noTime++;
    } else {
      const key = `${sh.date}|${sh.shift}`;
      let sa = shifts.get(key);
      if (!sa) {
        sa = {
          date: sh.date, shift: sh.shift, bets: 0, betAmount: 0, winAmount: 0,
          members: new Set(), firstBet: String(b.bet_time), lastBet: String(b.bet_time),
        };
        shifts.set(key, sa);
      }
      sa.bets++;
      sa.betAmount += amt;
      sa.winAmount += win;
      sa.members.add(u);
      const t = String(b.bet_time);
      if (t < sa.firstBet) sa.firstBet = t;
      if (t > sa.lastBet) sa.lastBet = t;
    }

    let m = members.get(u);
    if (!m) {
      m = {
        username: u, platforms: new Set(), lotteries: new Set(), ips: new Set(),
        bets: 0, betAmount: 0, winAmount: 0, wins: 0,
        firstBet: String(b.bet_time ?? ''), lastBet: String(b.bet_time ?? ''),
      };
      members.set(u, m);
    }
    m.bets++;
    m.betAmount += amt;
    m.winAmount += win;
    if (isWin) m.wins++;
    if (b.platform) m.platforms.add(String(b.platform));
    if (b.lottery) m.lotteries.add(String(b.lottery));
    const t = String(b.bet_time ?? '');
    if (t) {
      if (!m.firstBet || t < m.firstBet) m.firstBet = t;
      if (!m.lastBet || t > m.lastBet) m.lastBet = t;
    }
    const ip = String(b.user_ip ?? '').trim();
    if (ip) {
      m.ips.add(ip);
      if (!ipMap.has(ip)) ipMap.set(ip, new Set());
      ipMap.get(ip)!.add(u);
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

  return NextResponse.json({
    summary: {
      records: r.rows.length,
      truncated: r.truncated,
      bytes: r.bytes,
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
      query: { username, lottery, cycleValue, dateStart, dateEnd },
    },
    byShift,
    byMember,
    byIp,
    sample: r.rows.slice(0, SAMPLE_LIMIT),
  });
}
