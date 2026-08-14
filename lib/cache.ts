// 伺服器端記憶體快取。
//
// 為什麼安全：查詢參數一樣就代表要的是同一批資料，而「已經過去的日期」在後端是定型的，
// 重複查不會有新結果。所以只有「查詢區間結束日 < 今天」的才給長 TTL；
// 只要區間碰到今天，資料還在長，就給很短的 TTL。
//
// 注意：這是單一容器的行程內記憶體，重啟即清空、多實例不共享。
// 對這個站的使用量（幾個人、偶爾查）足夠，不需要外部快取。

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 40;

// 區間已結束（不含今天）→ 資料定型，可以放心快取久一點
const TTL_SETTLED_MS = 30 * 60 * 1000;   // 30 分鐘
// 區間碰到今天 → 資料還在長，只擋住短時間內的重複點擊
const TTL_LIVE_MS = 20 * 1000;           // 20 秒

/** 依查詢區間決定 TTL：dateEnd 早於今天才算定型 */
export function ttlFor(dateEnd: string | null | undefined): number {
  if (!dateEnd) return TTL_LIVE_MS;
  // 用 UTC 日期字串比較即可 —— 邊界模糊時寧可保守（給短 TTL）
  const today = new Date().toISOString().slice(0, 10);
  return dateEnd < today ? TTL_SETTLED_MS : TTL_LIVE_MS;
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // 觸碰即移到尾端，讓淘汰時先丟最久沒用到的
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Map 的迭代順序是插入順序，第一個就是最久沒被觸碰的
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
