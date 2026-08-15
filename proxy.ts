// 兩道存取控制：IP 白名單（從哪裡來）＋ 帳密登入（你是誰）。
//
// Next 16 把 middleware 改名為 proxy，這支檔案要放在專案根目錄（與 app/ 同層）。
// 預設跑 Node.js runtime，不能設 runtime 設定選項。
//
// 順序：先擋 IP，過了才看 session。沒設 AUTH_USERS / AUTH_SECRET 時第二道自動略過，
// 只靠 IP 白名單 —— 設定還沒完成時不要把人鎖在門外。
//
// 設定方式：環境變數 ALLOWED_IPS，逗號分隔，支援單一 IP 與 CIDR，IPv4 / IPv6 皆可，例如
//   ALLOWED_IPS=203.0.113.5, 198.51.100.0/24, 2001:db8::1, 2400:cb00::/32
//
// 沒設 ALLOWED_IPS 時「一律拒絕」而不是一律放行 —— 這站看得到 18 個平台的
// 投注、盈虧、會員帳號與 IP，設定沒做完之前絕不能裸奔。被拒頁面會顯示判定到的
// 來源 IP，方便把自己加進白名單。
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, authConfigured, SESSION_COOKIE } from '@/lib/auth';

// IPv4 / IPv6 都轉成 BigInt 來比對 —— 只支援 IPv4 的話，
// 哪天出口換成 IPv6（現在很常見）就會把自己擋在門外。
// 回傳 null 代表這串不是合法 IP。bits 是該協定的位址長度（v4=32、v6=128）。
function ipToBig(ip: string): { value: bigint; bits: 32 | 128 } | null {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  if (!s) return null;

  // IPv4-mapped IPv6（::ffff:1.2.3.4）視為 IPv4，否則同一台機器兩種寫法會對不起來
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const target = mapped ? mapped[1] : s;

  if (target.includes('.') && !target.includes(':')) {
    const parts = target.split('.');
    if (parts.length !== 4) return null;
    let n = 0n;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const v = Number(p);
      if (v < 0 || v > 255) return null;
      n = (n << 8n) | BigInt(v);
    }
    return { value: n, bits: 32 };
  }

  if (!target.includes(':')) return null;
  // 展開 :: 縮寫
  const halves = target.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return { value: n, bits: 128 };
}

// 支援 "1.2.3.4"、"1.2.3.0/24"、"2001:db8::1"、"2001:db8::/32"
function ipMatches(ip: string, rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  const target = ipToBig(ip);
  if (!target) return false;

  const slash = r.lastIndexOf('/');
  if (slash === -1) {
    const base = ipToBig(r);
    return !!base && base.bits === target.bits && base.value === target.value;
  }

  const base = ipToBig(r.slice(0, slash));
  const bits = Number(r.slice(slash + 1));
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > base.bits) return false;
  // 跨協定不比對（IPv4 規則不會意外命中 IPv6 位址）
  if (base.bits !== target.bits) return false;

  const shift = BigInt(base.bits - bits);
  return (target.value >> shift) === (base.value >> shift);
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
  const path = req.nextUrl.pathname;

  // 本機 next dev 沒有 x-forwarded-for，不豁免的話自己也進不去。
  // 線上 NODE_ENV 是 production，這條不會生效。
  const isDev = process.env.NODE_ENV === 'development';

  // ── 第一道：IP 白名單（擋「從哪裡來」）──
  if (!isDev) {
    const raw = process.env.ALLOWED_IPS || '';
    const rules = raw.split(',').map(s => s.trim()).filter(Boolean);
    const { ip, xff, xri } = clientIp(req);

    if (rules.length === 0) return deny(ip, xff, xri, false);
    if (!ip) return deny(ip, xff, xri, true);
    if (!rules.some(r => ipMatches(ip, r))) return deny(ip, xff, xri, true);
  }

  // ── 第二道：帳密登入（擋「你是誰」）──
  // 沒設 AUTH_USERS / AUTH_SECRET 就等於沒開這道，只靠 IP 白名單。
  // 這是刻意的：設定還沒完成時不要把人鎖在外面，而不是預設就鎖死。
  if (!authConfigured()) return NextResponse.next();

  // 登入頁與登入 API 本身必須放行，否則沒辦法登入
  if (path === '/login' || path === '/api/auth/login' || path === '/api/auth/logout') {
    return NextResponse.next();
  }

  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // API 回 401 讓前端好處理；頁面則導去登入頁並記住原本要去的地方
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: '尚未登入或登入已過期' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // 全站攔截，含 API。三類例外：
  //   _next/static、_next/image、favicon.ico —— 沒有敏感內容，擋掉只會讓 403 頁面變難看
  //   api/health —— Railway healthcheck 由容器內部發起，來源 IP 不在白名單，
  //                 被擋成 403 會被判定不健康而重啟循環
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
