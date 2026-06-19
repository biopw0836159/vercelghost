// GET /api/lottery-analysis  —— A 引擎（用戶采種分析）的同源代理
//
// 前端打這個（同源、免 CORS），伺服器端帶 x-api-key 去打後端 open API：
//   GET {BACKEND}/api/open/lottery-analysis?platform=&dateStart=&dateEnd=
//   header: x-api-key: <env APIKEY>
//
// Query：platform（逗號分隔或 ALL）、dateStart、dateEnd（yyyy-MM-dd）
import { NextResponse } from 'next/server';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

// 走 Node.js runtime（ProxyAgent 不支援 edge）
export const runtime = 'nodejs';

const BACKEND = (process.env.STATS_BACKEND_URL || 'https://stats-crawler.up.railway.app').replace(/\/+$/, '');

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') || 'ALL';
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }

  const apiKey = process.env.APIKEY;
  if (!apiKey) {
    return NextResponse.json({ error: '伺服器 APIKEY 未設定' }, { status: 500 });
  }

  const qs = new URLSearchParams({ platform, dateStart, dateEnd }).toString();
  const url = `${BACKEND}/api/open/lottery-analysis?${qs}`;

  // 後端 ipGuard 只放行特定代理 IP —— 透過 PROXY 指定的代理發送
  const proxy = process.env.PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  try {
    const res = await undiciFetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
      redirect: 'manual',
      dispatcher,
    });

    // ipGuard 會把未授權來源 302 轉去 booking.com —— 偵測並回明確錯誤
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      return NextResponse.json(
        {
          error: `後端轉址（status ${res.status}${loc ? '，→ ' + loc : ''}）——代理未生效/未授權，或 x-api-key 無效`,
          proxy_set: !!proxy,
          via: 'v2-proxy',
        },
        { status: 502 },
      );
    }

    const text = await res.text();
    const ct = res.headers.get('content-type') || '';

    if (!res.ok) {
      return NextResponse.json({ error: `後端錯誤 HTTP ${res.status}：${text.slice(0, 300)}` }, { status: res.status });
    }
    if (!ct.includes('application/json')) {
      return NextResponse.json({ error: `後端回傳非 JSON：${text.slice(0, 300)}` }, { status: 502 });
    }

    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : (Array.isArray(data.data) ? data.data : data));
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
