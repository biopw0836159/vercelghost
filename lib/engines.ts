// B / C 引擎封装（POST，走授权代理 + x-api-key）
//
// 這兩支跟 lib/open-api.ts 的 /api/open/* 是不同東西，別搞混：
//   B 引擎  POST /api/v1/profit-loss      會員盈虧：投注/獎金/返點/工資/充值/提款，today|month|lifetime 三個窗口
//   C 引擎  POST /api/query-bet-orders    注單明細：欄位比 GET /api/v1/member-bets 多，且有 cursor 分頁
//
// 為什麼改用這兩支（2026-08-14 實測）：
//   · /api/open/member-income 任何日期都回 0 筆，B 引擎的 profit-loss 才有資料
//   · GET /api/v1/member-bets 硬上限 1 萬筆且無分頁；C 引擎每頁 5000 筆可用 cursor 翻到底
//   · C 引擎多回 real_earn（真實盈虧）、bet_content（投注內容）、open_code（開獎號）、win_count
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const BACKEND = (process.env.STATS_BACKEND_URL || 'https://stats-crawler.up.railway.app').replace(/\/+$/, '');

function getProxyUrl(): string | undefined {
  if (process.env.PROXY) return process.env.PROXY;
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;
  if (!host || !port) return undefined;
  return (user && pass)
    ? `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
    : `http://${host}:${port}`;
}

type PostResult =
  | { ok: true; data: Record<string, unknown>; bytes: number }
  | { ok: false; status: number; error: string };

async function postEngine(path: string, body: unknown, maxBytes = 60 * 1024 * 1024): Promise<PostResult> {
  const apiKey = process.env.APIKEY;
  if (!apiKey) return { ok: false, status: 500, error: '伺服器 APIKEY 未設定' };

  const proxy = getProxyUrl();
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  try {
    const res = await undiciFetch(BACKEND + path, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      dispatcher,
    });

    // ipGuard 會把未授權來源 302 轉去 booking.com
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      return { ok: false, status: 502, error: `後端轉址（status ${res.status}${loc ? '，→ ' + loc : ''}）——代理未生效/未授權，或 x-api-key 無效` };
    }
    if (!res.body) return { ok: false, status: 502, error: '後端沒有回應內容' };

    // 邊讀邊擋，單頁 2.5MB 上下，但別讓異常情況打爆容器
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as any) {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        await (res.body as any).cancel?.().catch(() => {});
        return { ok: false, status: 413, error: `後端回應超過 ${(maxBytes / 1048576).toFixed(0)}MB 上限，已中止` };
      }
      chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!res.ok) return { ok: false, status: res.status, error: `後端錯誤 HTTP ${res.status}：${text.slice(0, 300)}` };

    try {
      return { ok: true, data: JSON.parse(text), bytes: size };
    } catch {
      return { ok: false, status: 502, error: `後端回傳不是 JSON：${text.slice(0, 300)}` };
    }
  } catch (e) {
    return { ok: false, status: 500, error: (e as Error).message };
  }
}

// ── B 引擎：會員盈虧 ──
// 只能逐個會員查（實測 loginIds 陣列、不帶 loginId 都回 400），平均約 1 秒/人。
export type ProfitLossBlock = {
  bet: number; prize: number; returnPoint: number; activity: number;
  profit: number; recharge: number; withdrawal: number; bonus: number;
  depositProfit: number; proportionalBonus: number;
};
export type ProfitLossResult =
  | { ok: true; found: boolean; accountNotFound: boolean; windows: Record<string, { personal: ProfitLossBlock | null; team: ProfitLossBlock | null }>; ascendants: string[] }
  | { ok: false; status: number; error: string };

export async function fetchProfitLoss(
  platform: string,
  loginId: string,
  periods: string[] = ['today', 'month'],
): Promise<ProfitLossResult> {
  const r = await postEngine('/api/v1/profit-loss', { platform, loginId, kind: 'total', periods });
  if (!r.ok) return r;

  const d = r.data as {
    results?: { key: string; found: boolean; personal: ProfitLossBlock | null; team: ProfitLossBlock | null }[];
    allAscendants?: unknown; accountNotFound?: boolean;
  };
  const windows: Record<string, { personal: ProfitLossBlock | null; team: ProfitLossBlock | null }> = {};
  let found = false;
  for (const row of d.results ?? []) {
    windows[row.key] = { personal: row.personal ?? null, team: row.team ?? null };
    if (row.found) found = true;
  }
  return {
    ok: true,
    found,
    accountNotFound: !!d.accountNotFound,
    windows,
    ascendants: Array.isArray(d.allAscendants) ? d.allAscendants.map(String) : [],
  };
}

// ── C 引擎：注單明細（cursor 分頁）──
export type BetOrder = Record<string, unknown>;
export type BetOrdersResult =
  | { ok: true; records: BetOrder[]; pages: number; truncated: boolean; bytes: number; capMessage: string }
  | { ok: false; status: number; error: string };

/**
 * 拉注單。後端每頁上限 5000 筆，靠 nextCursor 往下翻。
 * maxPages 是防護欄：翻不完就標 truncated，讓呼叫方如實告訴使用者資料不完整，
 * 而不是默默給一份少掉一半的數字。
 */
export async function fetchBetOrders(params: {
  platforms: string[];
  dateStart: string;
  dateEnd: string;
  username?: string;
  maxPages?: number;
  maxRecords?: number;
}): Promise<BetOrdersResult> {
  const { platforms, dateStart, dateEnd, username, maxPages = 12, maxRecords = 60000 } = params;

  const records: BetOrder[] = [];
  let cursor: unknown = null;
  let pages = 0;
  let bytes = 0;
  let truncated = false;
  let capMessage = '';

  while (pages < maxPages) {
    const body: Record<string, unknown> = { platforms, dateStart, dateEnd, limit: 5000 };
    if (username) body.username = username;
    if (cursor) body.cursor = cursor;

    const r = await postEngine('/api/query-bet-orders', body);
    if (!r.ok) {
      // 已經拿到部分資料就先回，並標記不完整；完全沒拿到才當失敗
      if (records.length) { truncated = true; break; }
      return r;
    }
    pages++;
    bytes += r.bytes;

    const d = r.data as { records?: BetOrder[]; hasMore?: boolean; nextCursor?: unknown; capMessage?: string };
    const page = d.records ?? [];
    records.push(...page);
    if (d.capMessage) capMessage = String(d.capMessage);

    if (records.length >= maxRecords) { truncated = !!d.hasMore; break; }
    if (!d.hasMore || !d.nextCursor) break;
    cursor = d.nextCursor;
    if (pages >= maxPages) truncated = true;
  }

  return { ok: true, records, pages, truncated, bytes, capMessage };
}
