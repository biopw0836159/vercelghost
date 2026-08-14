// 機房 / 雲廠商 IP 判別。
//
// 為什麼需要：注單明細的 user_ip 拿來抓「同 IP 多帳號」很有用，但實測 8/12 當天
// 共用最兇的前幾名全是 AWS 東京機房段（一個 IP 掛 47 個帳號），那是代理/VPN 出口，
// 不是工作室。不濾掉的話整頁都是誤報。
//
// 目前覆蓋 AWS ap-northeast-1（東京）主要網段 —— 實測抓到的共用 IP 幾乎都落在這裡。
// 之後發現其他雲廠商網段，往 DC_RANGES 加即可。

const DC_RANGES: [string, number][] = [
  // AWS ap-northeast-1（東京）
  ['13.112.0.0', 14],
  ['13.230.0.0', 15],
  ['18.176.0.0', 13],
  ['35.72.0.0', 13],
  ['3.112.0.0', 14],
  ['52.192.0.0', 12],
  ['54.64.0.0', 13],
  ['46.51.224.0', 19],
  ['176.34.0.0', 19],
];

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const RANGES = DC_RANGES.map(([base, bits]) => {
  const b = ipToInt(base)!;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return { net: (b & mask) >>> 0, mask };
});

/** 這個 IP 是不是雲機房出口（代理/VPN），是的話拿來當「同 IP 多帳號」證據會誤報 */
export function isDatacenterIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  return RANGES.some(r => ((n & r.mask) >>> 0) === r.net);
}
