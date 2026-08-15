// 機房 / 雲廠商 IP 判別（IPv4 + IPv6）。
//
// 為什麼需要：注單明細的 user_ip 拿來抓「同 IP 多帳號」很有用，但實測 8/12 當天
// 共用最兇的前幾名全是 AWS 東京機房段（一個 IP 掛 47 個帳號），那是代理/VPN 出口，
// 不是工作室。不濾掉的話整頁都是誤報。
//
// ⚠ 這份清單一定不完整（雲廠商網段成千上萬且會變動）。判 false 只代表
// 「不在我們認得的機房段裡」，不等於保證是住宅 IP —— 拿同 IP 當證據前仍要人工確認。
// 發現新的機房網段往 DC_RANGES 加即可，IPv4 / IPv6 都收。

const DC_RANGES: string[] = [
  // AWS ap-northeast-1（東京）IPv4 —— 實測共用最兇的那幾個都落在這裡。
  // ⚠ 13.158.0.0/16 是靠實測補的：13.158.161.203 掛了 46 個帳號卻沒被判成機房，
  //   證明「憑印象列幾段」一定會漏，遇到可疑的共用 IP 請先確認它是不是雲出口。
  '3.112.0.0/14',
  '13.112.0.0/14',
  '13.158.0.0/16',
  '13.230.0.0/15',
  '15.168.0.0/16',
  '18.176.0.0/13',
  '35.72.0.0/13',
  '43.206.0.0/15',
  '46.51.224.0/19',
  '52.192.0.0/12',
  '54.64.0.0/13',
  '57.180.0.0/14',
  '176.34.0.0/19',
  // 主要雲廠商 IPv6（涵蓋範圍較粗，寧可粗也不要漏標成住宅）
  '2600:1f00::/24',   // AWS
  '2406:da00::/24',   // AWS 亞太
  '2a05:d000::/24',   // AWS 歐洲
  '2404:6800::/32',   // Google
  '2600:1900::/28',   // Google Cloud
  '2603:1000::/24',   // Azure
  '2a01:111::/32',    // Microsoft
];

/** IPv4 / IPv6 都轉成 BigInt；回傳位址長度以便跨協定時不互相誤判 */
function ipToBig(ip: string): { value: bigint; bits: 32 | 128 } | null {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  if (!s) return null;

  // IPv4-mapped IPv6（::ffff:1.2.3.4）視為 IPv4
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

const RANGES = DC_RANGES.map(rule => {
  const slash = rule.lastIndexOf('/');
  const base = ipToBig(rule.slice(0, slash));
  const bits = Number(rule.slice(slash + 1));
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > base.bits) return null;
  const shift = BigInt(base.bits - bits);
  return { net: base.value >> shift, shift, family: base.bits };
}).filter((x): x is { net: bigint; shift: bigint; family: 32 | 128 } => !!x);

/** 這個 IP 是不是雲機房出口（代理/VPN）—— 是的話拿來當「同 IP 多帳號」證據會誤報 */
export function isDatacenterIp(ip: string): boolean {
  const t = ipToBig(ip);
  if (!t) return false;
  return RANGES.some(r => r.family === t.bits && (t.value >> r.shift) === r.net);
}
