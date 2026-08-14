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
  const members = new Map<string, Agg>();
  const ipMap = new Map<string, Set<string>>();
  let betAmount = 0, winAmount = 0, wins = 0;

  for (const b of r.rows) {
    const u = String(b.username ?? '-');
    const amt = num(b.bet_amount);
    const win = num(b.win_amount);
    const isWin = String(b.state ?? '').toUpperCase() === 'WIN';
    betAmount += amt; winAmount += win; if (isWin) wins++;

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
      query: { username, lottery, cycleValue, dateStart, dateEnd },
    },
    byMember,
    byIp,
    sample: r.rows.slice(0, SAMPLE_LIMIT),
  });
}
