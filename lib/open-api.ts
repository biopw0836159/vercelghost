// 共用：透過授權代理（PROXY_*）+ x-api-key 呼叫後端 open API，繞過 ipGuard。
// A 引擎（lottery-analysis）與 B 引擎（member-income）共用。
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const BACKEND = (process.env.STATS_BACKEND_URL || 'https://stats-crawler.up.railway.app').replace(/\/+$/, '');

// 代理網址：優先用單一 PROXY，否則用 PROXY_HOST/PORT/USER/PASS 組（同 777 的拆法）
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

export type OpenApiResult =
  | { ok: true; rows: any[] }
  | { ok: false; status: number; error: string };

export async function fetchOpenApi(path: string, params: Record<string, string>): Promise<OpenApiResult> {
  const apiKey = process.env.APIKEY;
  if (!apiKey) return { ok: false, status: 500, error: '伺服器 APIKEY 未設定' };

  const qs = new URLSearchParams(params).toString();
  const url = `${BACKEND}${path}?${qs}`;

  const proxy = getProxyUrl();
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  try {
    const res = await undiciFetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      redirect: 'manual',
      dispatcher,
    });

    // ipGuard 會把未授權來源 302 轉去 booking.com
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      return { ok: false, status: 502, error: `後端轉址（status ${res.status}${loc ? '，→ ' + loc : ''}）——代理未生效/未授權，或 x-api-key 無效` };
    }

    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return { ok: false, status: res.status, error: `後端錯誤 HTTP ${res.status}：${text.slice(0, 300)}` };
    if (!ct.includes('application/json')) return { ok: false, status: 502, error: `後端回傳非 JSON：${text.slice(0, 300)}` };

    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : (Array.isArray(data.data) ? data.data : data));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, status: 500, error: (e as Error).message };
  }
}
