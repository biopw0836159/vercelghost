// 「當期有哪些平台」的唯一來源。
//
// 這件事本來散在三個地方各寫一份（/api/platforms 的清單、member-bets 與
// new-members 把 ALL 展開成實際清單），結果是同一個 bug 修了一處、漏兩處。
// 平台清單決定「會查到哪些資料」，三處給出不同答案 = 靜默漏算，所以收斂到這裡。
//
// 兩個原則，都是實測踩出來的：
//
//  1. 取兩個來源的聯集。新平台剛上線時常常只有一邊有流水（先開外接、彩票還沒開），
//     只看 lottery-stats 會整個平台看不到。
//
//  2. 只快取 3 分鐘，不因為「歷史日期已定型」就給 30 分鐘。2026-08-15 實測：後端某次
//     回應少了 LS（直接連打三次都是 18 個，只有那次 17 個），被快取半小時，期間查詢
//     就靜默少算一個平台。結構性資料錯一次的代價太大，寧可多打幾次後端讓異常自癒。
import { fetchOpenApi } from '@/lib/open-api';
import { cacheGet, cacheSet } from '@/lib/cache';

export const PLATFORM_TTL_MS = 3 * 60 * 1000;

export type PlatformList = {
  /** 兩來源聯集，已排序 */
  codes: string[];
  /** 各平台在哪一邊有資料：'彩票' / '外接' */
  sources: Record<string, string[]>;
  /** 外接來源這次有沒有取到；false 代表清單可能少了「只有外接」的平台 */
  externalSourceOk: boolean;
};

const codesOf = (rows: Record<string, unknown>[]) => new Set(
  rows.map(x => String(x['平台'] ?? x['platform'] ?? '').trim()).filter(Boolean),
);

/** 取當期實際有資料的平台。彩票來源失敗才算失敗（回 null），外接失敗只是清單少一個補充來源。 */
export async function getPlatformList(dateStart: string, dateEnd: string): Promise<PlatformList | null> {
  const key = `platform-list|${dateStart}|${dateEnd}`;
  const cached = cacheGet<PlatformList>(key);
  if (cached) return cached;

  const [lot, ext] = await Promise.all([
    fetchOpenApi('/api/open/lottery-stats', { platform: 'ALL', dateStart, dateEnd }),
    fetchOpenApi('/api/open/external-game-stats', { platform: 'ALL', dateStart, dateEnd }),
  ]);

  if (!lot.ok) return null;

  const lotCodes = codesOf(lot.rows);
  const extCodes = ext.ok ? codesOf(ext.rows) : new Set<string>();
  const codes = [...new Set([...lotCodes, ...extCodes])].sort();
  if (!codes.length) return null;

  const sources: Record<string, string[]> = {};
  for (const c of codes) {
    sources[c] = [
      ...(lotCodes.has(c) ? ['彩票'] : []),
      ...(extCodes.has(c) ? ['外接'] : []),
    ];
  }

  const result: PlatformList = { codes, sources, externalSourceOk: ext.ok };
  // 外接掛掉時不快取：清單可能少了「只有外接」的平台，不該留著誤導後續查詢
  if (ext.ok) cacheSet(key, result, PLATFORM_TTL_MS);
  return result;
}

/**
 * 把使用者填的平台字串解析成實際清單。
 * 空字串或含 ALL → 展開成當期全部平台（C 引擎與新進會員都不吃 ALL，傳了會回 0 筆）。
 */
export async function resolvePlatforms(
  explicit: string, dateStart: string, dateEnd: string,
): Promise<string[] | null> {
  const list = explicit.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (list.length && !list.includes('ALL')) return list;
  return (await getPlatformList(dateStart, dateEnd))?.codes ?? null;
}
