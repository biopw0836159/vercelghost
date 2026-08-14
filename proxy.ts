// IP 白名單 —— 取代原本的帳密登入。
//
// Next 16 把 middleware 改名為 proxy，這支檔案要放在專案根目錄（與 app/ 同層）。
// 預設跑 Node.js runtime，不能設 runtime 設定選項。
//
// 設定方式：環境變數 ALLOWED_IPS，逗號分隔，支援單一 IP 與 CIDR，例如
//   ALLOWED_IPS=203.0.113.5, 198.51.100.0/24
//
// 沒設 ALLOWED_IPS 時「一律拒絕」而不是一律放行 —— 這站看得到 18 個平台的
// 投注、盈虧、會員帳號與 IP，設定沒做完之前絕不能裸奔。被拒頁面會顯示判定到的
// 來源 IP，方便把自己加進白名單。
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

// 支援 "1.2.3.4" 與 "1.2.3.0/24" 兩種寫法
function ipMatches(ip: string, rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  const target = ipToInt(ip);
  if (target === null) return false;

  const slash = r.indexOf('/');
  if (slash === -1) return target === ipToInt(r);

  const base = ipToInt(r.slice(0, slash));
  const bits = Number(r.slice(slash + 1));
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return ((target & mask) >>> 0) === ((base & mask) >>> 0);
}

// Railway 這類平台會把真實來源放進 x-forwarded-for（可能是 "client, proxy1, proxy2"）。
// 取第一段當客戶端 IP；沒有就退回 x-real-ip。
function clientIp(req: NextRequest): { ip: string; xff: string; xri: string } {
  const xff = req.headers.get('x-forwarded-for') || '';
  const xri = req.headers.get('x-real-ip') || '';
  const first = xff.split(',')[0]?.trim() || '';
  return { ip: first || xri.trim(), xff, xri };
}

function deny(ip: string, xff: string, xri: string, configured: boolean) {
  // 白名單還沒設定時，把診斷資訊帶出來方便完成設定；設定好之後就只回最少資訊。
  const setupHint = configured
    ? ''
    : `<p class="hint">目前尚未設定 <code>ALLOWED_IPS</code>，因此一律拒絕。<br>
         請把下面這個 IP 加進 Railway 的 <code>ALLOWED_IPS</code> 環境變數（逗號分隔，可用 CIDR）。</p>
       <p class="diag">x-forwarded-for: <code>${xff || '(無)'}</code><br>
         x-real-ip: <code>${xri || '(無)'}</code></p>`;

  const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>存取被拒</title><style>
  body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif;
       background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;padding:24px}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:560px}
  h1{font-size:20px;margin:0 0 12px}
  .ip{font-size:24px;font-weight:700;color:#38bdf8;font-family:ui-monospace,monospace;margin:16px 0}
  .hint,.diag{font-size:13px;color:#94a3b8;line-height:1.7}
  code{background:#0f172a;padding:2px 6px;border-radius:4px;color:#cbd5e1}
</style></head><body><div class="card">
<h1>🚫 存取被拒</h1>
<p class="hint">這個站限定白名單 IP 存取。你目前的來源 IP 是：</p>
<div class="ip">${ip || '(無法判定)'}</div>
${setupHint}
</div></body></html>`;

  return new NextResponse(html, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function proxy(req: NextRequest) {
  // 本機 next dev 沒有 x-forwarded-for，不豁免的話自己也進不去。
  // 線上 NODE_ENV 是 production，這條不會生效。
  if (process.env.NODE_ENV === 'development') return NextResponse.next();

  const raw = process.env.ALLOWED_IPS || '';
  const rules = raw.split(',').map(s => s.trim()).filter(Boolean);
  const { ip, xff, xri } = clientIp(req);

  if (rules.length === 0) return deny(ip, xff, xri, false);
  if (!ip) return deny(ip, xff, xri, true);
  if (rules.some(r => ipMatches(ip, r))) return NextResponse.next();
  return deny(ip, xff, xri, true);
}

export const config = {
  // 全站攔截，含 API。三類例外：
  //   _next/static、_next/image、favicon.ico —— 沒有敏感內容，擋掉只會讓 403 頁面變難看
  //   api/health —— Railway healthcheck 由容器內部發起，來源 IP 不在白名單，
  //                 被擋成 403 會被判定不健康而重啟循環
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
