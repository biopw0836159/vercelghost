'use client';
import { useState, useMemo } from 'react';

// 存取控制改用 IP 白名單，擋在專案根目錄的 proxy.ts，這裡不再有帳密登入。
// A 引擎 → /api/lottery-stats，B 引擎 → /api/member-bets（皆為同源代理，見 app/api/*）

// 處理後台可能回傳帶逗號的字串數字，例如 "53,684.13"
const parseNum = (v: any): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const cleaned = String(v).replace(/,/g, '').trim();
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

// 金額顯示：千分位 + 固定兩位小數（後端浮點尾數如 13685.289999999999 直接印出來很難讀）
const fmtMoney = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// RTP 顯示到小數第 4 位（後端只給 3 位，我們自己算的精度更高）
const fmtRtp = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(4);

const FilterInput = ({ label, filterObj, stateUpdater, stateKey }: any) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-1">
      <input type="checkbox" checked={filterObj.active}
        onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [stateKey]: { ...prev[stateKey], active: e.target.checked } }))}
        className="w-4 h-4 cursor-pointer" />
      <label className="text-sm font-medium text-gray-700">{label}</label>
    </div>
    <input type="number" disabled={!filterObj.active} value={filterObj.value}
      onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [stateKey]: { ...prev[stateKey], value: Number(e.target.value) } }))}
      className="w-full p-2 border rounded bg-gray-800 text-white disabled:opacity-50" />
  </div>
);

const DeepInput = ({ label, hint, value, onChange }: any) => (
  <div className="mb-3">
    <label className="block text-sm font-medium mb-1 text-gray-700">{label}</label>
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={hint}
      className="w-full border p-2 rounded text-black" />
  </div>
);

export default function AuditDashboard() {
  const today = new Date();
  const fiveDaysAgo = new Date(today);
  fiveDaysAgo.setDate(today.getDate() - 5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [activeEngine, setActiveEngine] = useState<'A' | 'B'>('A');
  const [mergeByLottery, setMergeByLottery] = useState(false);
  const [dateStart, setDateStart] = useState(fmt(fiveDaysAgo));
  const [dateEnd, setDateEnd] = useState(fmt(today));
  const [platform, setPlatform] = useState('ALL');

  const [rawData, setRawData] = useState<any[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [rawSample, setRawSample] = useState<any>(null);
  const [showRawSample, setShowRawSample] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [hasQueried, setHasQueried] = useState(false);

  // 預設條件以「莊家不賺錢的彩種」為目標：RTP ≥ 0.995 單條開啟，其餘留給使用者按需求加。
  // 舊的預設（銷量 0~2000 且 盈虧 10萬~100萬 且 RTP 0.995~1.0）不要復原：
  //   1. 銷量≤2000 卻要盈虧≥10萬，兩條互斥，命中永遠是 0
  //   2. RTP 上限 1.0 會把「RTP>1 = 莊家倒虧」的彩種全部排除，那才是最該抓的
  //      （實測 8/12 當天 RTP 最高 3.9526，單一彩種最多倒虧 790,034）
  const defaultFiltersA = {
    minSales: { active: false, value: 0.00 },
    maxSales: { active: false, value: 2000.00 },
    minPnl: { active: false, value: 100000.00 },
    maxPnl: { active: false, value: 1000000.00 },
    minRtp: { active: true, value: 0.995 },
    maxRtp: { active: false, value: 1.000 },
  };

  // 側邊欄當下勾選(草稿) - 勾選時即時更新
  const [filtersA, setFiltersA] = useState(defaultFiltersA);
  // 實際套用到表格的條件 - 只在按「執行查詢」時才同步
  const [appliedFiltersA, setAppliedFiltersA] = useState(defaultFiltersA);

  // B 引擎（定向深查）：後端 member-bets 至少要指定一個對象，不能只給日期
  const [deepUser, setDeepUser] = useState('');
  const [deepLottery, setDeepLottery] = useState('');
  const [deepCycle, setDeepCycle] = useState('');
  const [deepResult, setDeepResult] = useState<any>(null);

  type SortCol = 'bets' | 'betAmount' | 'winAmount' | 'memberProfit' | 'rtp';
  type SortState = { col: SortCol; dir: 'asc' | 'desc' } | null;
  const [sortBy, setSortBy] = useState<SortState>(null);

  const handleSort = (col: SortCol) => {
    setSortBy(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'desc' };
      if (prev.dir === 'desc') return { col, dir: 'asc' };
      return null; // 第三下清除
    });
  };

  const filteredData = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    if (activeEngine === 'A') {
      // 粒度：預設「平台 × 彩種」逐列；勾了合併才按彩種名跨平台加總
      let rows = rawData;
      if (mergeByLottery) {
        const m = new Map<string, any>();
        for (const r of rawData) {
          const cur = m.get(r.lottery) ?? {
            id: `merged::${r.lottery}`, lottery: r.lottery, platformSet: new Set<string>(),
            people: 0, orderCount: 0, totalSales: 0, bonus: 0, treatment: 0, discount: 0, pnl: 0,
          };
          cur.platformSet.add(r.platform);
          cur.people += r.people;
          cur.orderCount += r.orderCount;
          cur.totalSales += r.totalSales;
          cur.bonus += r.bonus;
          cur.treatment += r.treatment;
          cur.discount += r.discount;
          cur.pnl += r.pnl;
          m.set(r.lottery, cur);
        }
        rows = [...m.values()].map((x: any) => ({
          ...x,
          platform: `${x.platformSet.size} 個平台`,
          // 合併後的 RTP 必須拿加總後的分子分母重算 —— 各平台 RTP 直接平均是錯的
          rtp: x.totalSales > 0 ? (x.bonus + x.treatment + x.discount) / x.totalSales : 0,
        }));
      }
      return rows.filter(item => {
        try {
          if (appliedFiltersA.minSales.active && item.totalSales < appliedFiltersA.minSales.value) return false;
          if (appliedFiltersA.maxSales.active && item.totalSales > appliedFiltersA.maxSales.value) return false;
          if (appliedFiltersA.minPnl.active && item.pnl < appliedFiltersA.minPnl.value) return false;
          if (appliedFiltersA.maxPnl.active && item.pnl > appliedFiltersA.maxPnl.value) return false;
          if (appliedFiltersA.minRtp.active && item.rtp < appliedFiltersA.minRtp.value) return false;
          if (appliedFiltersA.maxRtp.active && item.rtp > appliedFiltersA.maxRtp.value) return false;
          return true;
        } catch { return false; }
      });
    }
    // B（定向深查）：伺服器端已經彙總到會員維度，這裡只負責排序，預設按「會員盈虧」高→低
    const result = [...rawData];
    if (sortBy) {
      const sign = sortBy.dir === 'desc' ? -1 : 1;
      return result.sort((a, b) => {
        const av = Number(a[sortBy.col]) || 0;
        const bv = Number(b[sortBy.col]) || 0;
        return (av - bv) * sign;
      });
    }
    return result;
  }, [rawData, activeEngine, appliedFiltersA, sortBy, mergeByLottery]);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    setRawData([]);
    setRawCount(0);
    setRawSample(null);
    setShowRawSample(false);
    setCheckedItems(new Set());
    setSortBy(null);
    setHasQueried(true);
    setDeepResult(null);
    // 把當下側邊欄的條件「凍結」成套用版本，這之後再勾選也不會影響表格
    setAppliedFiltersA(filtersA);
    try {
      // ───── 引擎 A：open API（彩種統計，粒度為「平台 × 彩種」），走同源代理 GET ─────
      // 資料源是 lottery-stats 不是 lottery-analysis —— 後者對 XO/XY/OL/XH/LS 五個平台一律回 0，
      // 金額與本端點差 4000 倍以上，詳見 docs/API-現狀.md 第三節。
      if (activeEngine === 'A') {
        const qs = new URLSearchParams({ platform, dateStart, dateEnd }).toString();
        const res = await fetch(`/api/lottery-stats?${qs}`, { headers: { Accept: 'application/json' } });
        const json = await res.json();
        if (!res.ok || json?.error) {
          throw new Error(json?.error || `連線異常 (${res.status})`);
        }
        const rawArray: any[] = Array.isArray(json) ? json
          : (Array.isArray(json.rows) ? json.rows : (Array.isArray(json.data) ? json.data : []));
        setRawCount(rawArray.length);
        if (rawArray.length > 0) setRawSample(rawArray[0]);
        const finalRows = rawArray.map((r: any, i: number) => {
          const lottery = r['彩种'] ?? r['彩種'] ?? r.lottery ?? r.lottery_name ?? '-';
          const plat = r['平台'] ?? r.platform ?? '-';
          const totalSales = parseNum(r['投注金额'] ?? r['投注金額'] ?? r.betAmount ?? r.bet_amount);
          const bonus = parseNum(r['奖金'] ?? r['獎金'] ?? r.bonus);
          const treatment = parseNum(r['返点'] ?? r['返點'] ?? r.rebate ?? r.treatment);
          const discount = parseNum(r['_减让奖金'] ?? r['_減讓獎金']);
          return {
            id: `${plat}::${lottery}::${i}`,
            platform: plat,
            lottery,
            people: parseNum(r['人数'] ?? r['人數']),
            orderCount: parseNum(r['投注笔数'] ?? r['投注筆數'] ?? r.orderCount ?? r.order_count),
            totalSales,
            bonus,
            treatment,
            discount,
            pnl: parseNum(r['盈亏'] ?? r['盈虧'] ?? r.pnl ?? r.profit),
            // RTP 一律自己算，不吃後端的：後端有近 19% 的列根本沒給 RTP 欄位，
            // 直接採用會被當成 0，「RTP 0.995~1.0」這種條件就把它們全漏掉。
            // 公式 (獎金+返點+減讓獎金)/投注金額 —— 對後端有給值的 895 列驗證吻合 99.9%。
            rtp: totalSales > 0 ? (bonus + treatment + discount) / totalSales : 0,
          };
        });
        setRawData(finalRows);
        return;
      }

      // ───── 引擎 B（定向深查）：拉注單明細，伺服器端已彙總到會員維度 ─────
      // 不做全站掃描：後端 member-bets 單次上限 10000 筆且沒有分頁，
      // 實測整天全彩種要 1715MB、18 個彩種被截斷，數字必錯。詳見 docs/API-現狀.md 第四節。
      const bq = new URLSearchParams({ dateStart, dateEnd });
      if (deepUser.trim()) bq.set('username', deepUser.trim());
      if (deepLottery.trim()) bq.set('lottery', deepLottery.trim());
      if (deepCycle.trim()) bq.set('cycleValue', deepCycle.trim());
      const res = await fetch(`/api/member-bets?${bq.toString()}`, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `連線異常 (${res.status})`);
      }
      setDeepResult(json);
      setRawCount(json.summary?.records ?? 0);
      if (json.sample?.length) setRawSample(json.sample[0]);
      setRawData((json.byMember ?? []).map((m: any) => ({ ...m, id: m.username })));

    } catch (error: any) {
      console.error('查詢失敗:', error);
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (id: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) newChecked.delete(id);
    else newChecked.add(id);
    setCheckedItems(newChecked);
  };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900">
      <div className="w-80 bg-gray-200 border-r border-gray-300 p-4 overflow-y-auto">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">🎯 模塊切換</h2>
        <div className="space-y-2 mb-8">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="engine" checked={activeEngine === 'A'} onChange={() => setActiveEngine('A')} className="w-4 h-4 text-red-500" />
            <span className={activeEngine === 'A' ? "font-bold text-black" : "text-gray-600"}>彩種統計查詢</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="engine" checked={activeEngine === 'B'} onChange={() => setActiveEngine('B')} className="w-4 h-4 text-gray-800" />
            <span className={activeEngine === 'B' ? "font-bold text-black" : "text-gray-600"}>會員注單深查</span>
          </label>
        </div>

        <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">⚙️ 審計維度勾選</h3>
        <div className="mb-4 p-3 bg-white rounded shadow-sm border border-gray-200">
          <label className="block text-sm font-medium mb-1">平台 (或 ALL)</label>
          <input type="text" value={platform} onChange={e => setPlatform(e.target.value)} placeholder="ALL" className="w-full border p-1 rounded mb-2 text-black" />
          <label className="block text-sm font-medium mb-1">Date Start</label>
          <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="w-full border p-1 rounded mb-2 text-black" />
          <label className="block text-sm font-medium mb-1">Date End</label>
          <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="w-full border p-1 rounded text-black" />
          {/* 後端一天的邊界在當地時間 03:00 左右，不是 00:00 —— 只查單日會少掉晚班前段 */}
          {dateStart === dateEnd && (
            <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-1.5 leading-relaxed">
              ⚠️ 只查一天會缺一段。後端一天的邊界在當地時間 <b>03:00</b> 左右（不是 00:00），
              查單日拿到的是「當天 03:00 ～ 隔天 03:00」，晚班 00:00–03:00 那段會落在前一天。
              <button
                type="button"
                onClick={() => {
                  const d = new Date(dateEnd + 'T00:00:00Z');
                  d.setUTCDate(d.getUTCDate() - 1);
                  setDateStart(d.toISOString().slice(0, 10));
                }}
                className="mt-1 block text-blue-600 hover:text-blue-800 underline font-medium"
              >
                把開始日期往前推一天（湊齊完整自然日）
              </button>
            </div>
          )}
          {hasQueried && activeEngine === 'A'
            && JSON.stringify(filtersA) !== JSON.stringify(appliedFiltersA) && (
            <div className="mt-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-1.5 font-medium">
              ⏳ 條件有變更，按「執行查詢」才會套用
            </div>
          )}
          <button onClick={fetchData} disabled={loading} className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? '資料擷取中...' : '執行查詢'}
          </button>
        </div>

        {activeEngine === 'A' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer mb-3 p-2 bg-white rounded border border-gray-200">
              <input type="checkbox" checked={mergeByLottery} onChange={e => setMergeByLottery(e.target.checked)} className="w-4 h-4 cursor-pointer" />
              <span className="text-sm font-medium text-gray-700">按彩種合併（跨平台加總）</span>
            </label>
            <FilterInput label="Min銷量" filterObj={filtersA.minSales} stateUpdater={setFiltersA} stateKey="minSales" />
            <FilterInput label="Max銷量" filterObj={filtersA.maxSales} stateUpdater={setFiltersA} stateKey="maxSales" />
            <FilterInput label="Min盈虧" filterObj={filtersA.minPnl} stateUpdater={setFiltersA} stateKey="minPnl" />
            <FilterInput label="Max盈虧" filterObj={filtersA.maxPnl} stateUpdater={setFiltersA} stateKey="maxPnl" />
            <FilterInput label="Min RTP" filterObj={filtersA.minRtp} stateUpdater={setFiltersA} stateKey="minRtp" />
            <FilterInput label="Max RTP" filterObj={filtersA.maxRtp} stateUpdater={setFiltersA} stateKey="maxRtp" />
          </div>
        )}

        {activeEngine === 'B' && (
          <div>
            <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
              後端 <code>member-income</code> 目前任何日期都回 0 筆，全站掃描的五條規則暫時下架
              （定義留在 docs/API-現狀.md）。這裡改成拉注單明細做定向深查。
            </div>
            <div className="text-xs text-gray-500 mb-2 px-1">下面三個至少填一個，不能只給日期</div>
            <DeepInput label="會員帳號" hint="例如 lh838366" value={deepUser} onChange={setDeepUser} />
            <DeepInput label="彩種" hint="例如 東京1.5分彩" value={deepLottery} onChange={setDeepLottery} />
            <DeepInput label="期號" hint="例如 202608130360" value={deepCycle} onChange={setDeepCycle} />
            <div className="text-xs text-gray-500 px-1 leading-relaxed">
              查單一會員最快且數字完整。查大彩種可能超過 60MB 上限被擋下，
              那時候改用更短的日期區間。
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-6 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '彩種統計查詢' : '會員注單深查'}
        </div>

        {hasQueried && !loading && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm font-mono">
            {activeEngine === 'A' ? (
              <>
                <div>🔸 API 回傳原始筆數：<b>{rawCount}</b></div>
                <div>🔸 {mergeByLottery ? '按彩種合併後' : '平台 × 彩種'} 筆數：<b>{filteredData.length}</b></div>
              </>
            ) : deepResult?.summary ? (
              <>
                <div>🔸 注單筆數：<b>{deepResult.summary.records}</b>　會員 <b>{deepResult.summary.memberCount}</b> 人　IP <b>{deepResult.summary.ipCount}</b> 個</div>
                <div>🔸 投注 <b>{fmtMoney(deepResult.summary.betAmount)}</b>　派彩 <b>{fmtMoney(deepResult.summary.winAmount)}</b>　莊家盈虧{' '}
                  <b className={deepResult.summary.housePnl >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtMoney(deepResult.summary.housePnl)}</b>
                </div>
                <div className="text-xs text-gray-500">🔸 回應體 {(deepResult.summary.bytes / 1048576).toFixed(1)}MB</div>
                {deepResult.summary.truncated && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-400 rounded text-red-700 font-bold">
                    ⚠️ 撞到後端 10000 筆上限，這批資料<b>不完整</b>，上面的金額全部偏低。
                    請縮短日期區間、或改查單一會員帳號。
                  </div>
                )}
                {deepResult.summary.lotteryWarning && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-400 rounded text-red-700">
                    <b>⚠️ 彩種對不上，這批數字不能當成「{deepResult.summary.lotteryWarning.queried}」的數字用。</b>
                    <div className="mt-1 font-normal">
                      你查的是「{deepResult.summary.lotteryWarning.queried}」，後端實際回的是
                      「{deepResult.summary.lotteryWarning.actual.join('」、「') || '（空）'}」。
                      後端的 lottery 參數會把帶編號的名稱映射到別的彩種，而且彩種統計與注單明細之間還有簡繁字差異。
                      要準確的數字請<b>改查會員帳號</b>。
                    </div>
                  </div>
                )}
              </>
            ) : null}
            {activeEngine === 'A' && rawCount > 0 && filteredData.length === 0 && (
              <div className="text-red-600 font-bold mt-2">⚠️ API 有資料，但被過濾條件全部剃除！請放寬左側規則條件。</div>
            )}
            {rawCount === 0 && !errorMsg && (
              <div className="text-orange-600 font-bold mt-2">⚠️ API 回傳空陣列（日期/平台可能無資料，或後端結構不符）</div>
            )}
            {rawSample && (
              <div className="mt-2 pt-2 border-t border-yellow-300">
                <button
                  onClick={() => setShowRawSample(!showRawSample)}
                  className="text-blue-600 hover:text-blue-800 underline text-xs"
                >
                  {showRawSample ? '🔽 收起' : '🔍 檢視原始 API 第一筆資料 (用於確認欄位名稱)'}
                </button>
                {showRawSample && (
                  <div className="mt-2 bg-white border border-gray-300 rounded p-2 max-h-80 overflow-auto">
                    <div className="text-xs text-gray-500 mb-1">欄位 keys：</div>
                    <div className="text-xs text-purple-700 mb-2 break-all">
                      {Object.keys(rawSample).join('  |  ')}
                    </div>
                    <div className="text-xs text-gray-500 mb-1">完整內容：</div>
                    <pre className="text-xs text-gray-800 whitespace-pre-wrap break-all">
                      {JSON.stringify(rawSample, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow" role="alert">
            <p className="font-bold mb-2">查詢發生錯誤</p>
            <pre className="whitespace-pre-wrap text-sm font-mono">{errorMsg}</pre>
          </div>
        )}

        {activeEngine === 'B' && hasQueried && sortBy && (
          <div className="mb-3 text-xs text-gray-600">
            目前排序：<b>{ ({bets:'注單筆數', betAmount:'投注', winAmount:'派彩', memberProfit:'會員盈虧', rtp:'RTP'} as any)[sortBy.col] }</b> {sortBy.dir === 'desc' ? '↓ 高→低' : '↑ 低→高'}
            <button onClick={() => setSortBy(null)} className="ml-2 text-blue-500 hover:text-red-500 underline">清除排序</button>
          </div>
        )}

        {/* 班別分布 —— 用注單明細的 bet_time 自己切，後端沒有小時粒度的介面 */}
        {activeEngine === 'B' && deepResult?.byShift?.length > 0 && (() => {
          const off = deepResult.summary?.shiftTzOffsetHours ?? 8;
          // 把 UTC 時間換算成班別用的當地時間再顯示，讓人能核對切分對不對
          const local = (iso: string) => {
            if (!iso) return '-';
            const t = new Date(iso);
            if (isNaN(t.getTime())) return '-';
            return new Date(t.getTime() + off * 3600000).toISOString().slice(0, 19).replace('T', ' ');
          };
          return (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
              <div className="font-bold text-gray-700 mb-1">🕐 班別分布</div>
              <div className="text-xs text-gray-500 mb-3 leading-relaxed">
                早 08:00–16:00、中 16:00–24:00、晚 00:00–08:00。
                後端 <code>bet_time</code> 雖然標 <code>Z</code>，但實測存的是當地時間
                （经典重庆时时彩字面值 10:01~次日 01:56，正是該彩種公認的開盤時段），
                所以直接採用字面值{off !== 0 ? `，目前另外位移 ${off} 小時` : '、不做時區位移'}。
                請對照最右邊的「實際時間範圍」確認切分正確。
                {deepResult.summary?.recordsWithoutTime > 0 && (
                  <span className="text-orange-600 font-medium">
                    　有 {deepResult.summary.recordsWithoutTime} 筆沒有有效時間，未歸入任何班別。
                  </span>
                )}
              </div>
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="p-2 font-bold text-gray-600">日期</th>
                    <th className="p-2 font-bold text-gray-600">班別</th>
                    <th className="p-2 font-bold text-gray-600">注單</th>
                    <th className="p-2 font-bold text-gray-600">會員</th>
                    <th className="p-2 font-bold text-gray-600">投注</th>
                    <th className="p-2 font-bold text-gray-600">派彩</th>
                    <th className="p-2 font-bold text-gray-600">莊家盈虧</th>
                    <th className="p-2 font-bold text-gray-600">實際時間範圍（當地）</th>
                  </tr>
                </thead>
                <tbody>
                  {deepResult.byShift.map((s: any) => (
                    <tr key={`${s.date}|${s.shift}`} className="border-b hover:bg-blue-50">
                      <td className="p-2">{s.date}</td>
                      <td className="p-2 font-bold">{s.shift}</td>
                      <td className="p-2">{s.bets}</td>
                      <td className="p-2">{s.memberCount}</td>
                      <td className="p-2">{fmtMoney(s.betAmount)}</td>
                      <td className="p-2">{fmtMoney(s.winAmount)}</td>
                      <td className={`p-2 font-bold ${s.housePnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(s.housePnl)}</td>
                      <td className="p-2 text-xs font-mono text-gray-500">{local(s.firstBet)} ~ {local(s.lastBet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* 同 IP 多帳號 —— 機房 IP 會讓幾十個不相干的人共用一個出口，必須分開看 */}
        {activeEngine === 'B' && deepResult?.byIp?.length > 0 && (() => {
          const home = deepResult.byIp.filter((x: any) => !x.datacenter);
          const dc = deepResult.byIp.filter((x: any) => x.datacenter);
          return (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
              <div className="font-bold text-gray-700 mb-2">🔗 同 IP 多帳號</div>
              {home.length === 0 && <div className="text-sm text-gray-500">沒有住宅 IP 共用的情況。</div>}
              {home.map((x: any) => (
                <div key={x.ip} className="text-sm mb-1">
                  <span className="font-mono font-bold text-red-600">{x.ip}</span>
                  <span className="text-gray-500"> — {x.memberCount} 個帳號：</span>
                  <span className="text-blue-700">{x.members.join('、')}</span>
                </div>
              ))}
              {dc.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                  另有 {dc.length} 個機房 / 雲端出口 IP（{dc.slice(0, 3).map((x: any) => x.ip).join('、')}
                  {dc.length > 3 ? ' 等' : ''}）共用帳號，那是代理或 VPN，不能當成同一組人的證據，已排除。
                </div>
              )}
            </div>
          );
        })()}

        <div className="bg-white rounded-lg shadow border border-gray-200">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="p-4 font-bold text-gray-600">核查</th>
                {activeEngine === 'A' && <>
                  <th className="p-4 font-bold text-gray-600">平台</th>
                  <th className="p-4 font-bold text-gray-600">彩種</th>
                  <th className="p-4 font-bold text-gray-600">人數</th>
                  <th className="p-4 font-bold text-gray-600">投注筆數</th>
                </>}
                {activeEngine === 'B' && <>
                  <th className="p-4 font-bold text-gray-600">平台</th>
                  <th className="p-4 font-bold text-gray-600">會員帳號</th>
                  <th className="p-4 font-bold text-gray-600">彩種數</th>
                  <th className="p-4 font-bold text-gray-600">IP</th>
                </>}
                {activeEngine === 'A' ? (
                  <><th className="p-4 font-bold text-gray-600">投注金額</th><th className="p-4 font-bold text-gray-600">獎金</th><th className="p-4 font-bold text-gray-600">返點</th><th className="p-4 font-bold text-gray-600">盈虧</th><th className="p-4 font-bold text-gray-600">RTP</th></>
                ) : (
                  <>
                    {([
                      { col: 'bets', label: '注單筆數' },
                      { col: 'betAmount', label: '投注' },
                      { col: 'winAmount', label: '派彩' },
                      { col: 'memberProfit', label: '會員盈虧' },
                      { col: 'rtp', label: 'RTP' },
                    ] as { col: SortCol; label: string }[]).map(({ col, label }) => {
                      const isActive = sortBy?.col === col;
                      const arrow = isActive ? (sortBy!.dir === 'desc' ? '↓' : '↑') : '↕';
                      return (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                          className={`p-4 font-bold select-none cursor-pointer hover:bg-gray-200 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-600'}`}
                          title="點擊切換排序 (降冪→升冪→清除)"
                        >
                          {label} <span className={`ml-1 text-xs ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>{arrow}</span>
                        </th>
                      );
                    })}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-gray-500">{hasQueried ? '尚無符合條件的數據' : '請點擊執行查詢'}</td></tr>
              ) : (
                filteredData.map((item: any) => (
                  <tr key={item.id} className="border-b hover:bg-blue-50 transition-colors">
                    <td className="p-4"><input type="checkbox" className="w-4 h-4 cursor-pointer" checked={checkedItems.has(item.id)} onChange={() => toggleCheck(item.id)} /></td>
                    {activeEngine === 'A' && <>
                      <td className="p-4 font-medium">{item.platform}</td>
                      <td className="p-4 font-bold text-blue-600 whitespace-normal max-w-xs">{item.lottery}</td>
                      <td className="p-4">{item.people}</td>
                      <td className="p-4">{item.orderCount}</td>
                    </>}
                    {activeEngine === 'B' && <>
                      <td className="p-4 font-medium">{item.platform}</td>
                      <td className="p-4 text-blue-600 font-bold">{item.username}</td>
                      <td className="p-4">{item.lotteryCount}</td>
                      <td className="p-4 text-xs font-mono text-gray-600" title={item.ips?.join('\n')}>
                        {item.ipCount === 1 ? item.ips[0] : `${item.ipCount} 個`}
                      </td>
                    </>}
                    {activeEngine === 'A' ? (
                      <><td className="p-4">{fmtMoney(item.totalSales)}</td><td className="p-4">{fmtMoney(item.bonus)}</td><td className="p-4">{fmtMoney(item.treatment)}</td>
                        <td className={`p-4 font-bold ${item.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(item.pnl)}</td>
                        <td className="p-4">{fmtRtp(item.rtp)}</td></>
                    ) : (
                      <><td className="p-4">{item.bets}</td><td className="p-4">{fmtMoney(item.betAmount)}</td>
                        <td className="p-4">{fmtMoney(item.winAmount)}</td>
                        {/* 會員盈虧為正 = 會員贏錢 = 莊家輸，用紅色示警 */}
                        <td className={`p-4 font-bold ${item.memberProfit > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtMoney(item.memberProfit)}</td>
                        <td className={`p-4 ${item.rtp >= 1 ? 'font-bold text-red-600' : ''}`}>{fmtRtp(item.rtp)}</td></>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
