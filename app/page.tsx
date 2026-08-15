'use client';
import { useState, useMemo, useEffect } from 'react';

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

// 金額顯示：千分位 + 三位小數，刻意對齊後台「彩種統計」頁的顯示格式，
// 對帳時可以直接逐位比對，不用心算四捨五入。
// （直接印原始值會出現 13685.289999999999 這種浮點尾巴，很難讀。）
const fmtMoney = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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

  const [activeEngine, setActiveEngine] = useState<'A' | 'B' | 'C'>('A');
  // A 引擎的資料種類：彩票（lottery-stats）或外接遊戲（external-game-stats），
  // 對應後台「彩種統計」與「外接統計」兩個選單。兩者欄位不同，不能混算。
  const [gameKind, setGameKind] = useState<'lottery' | 'external'>('lottery');
  // C 引擎（新進會員）：抓批量創號的特徵 —— 同上級 / 同獎金號 / 同註冊碼 / 同首充 / 同 IP / 創號密集
  const [nmMinGroup, setNmMinGroup] = useState('2');
  const [nmResult, setNmResult] = useState<any>(null);
  const [mergeByLottery, setMergeByLottery] = useState(false);
  const [dateStart, setDateStart] = useState(fmt(fiveDaysAgo));
  const [dateEnd, setDateEnd] = useState(fmt(today));
  // 平台改成勾選式。清單不寫死（平台會增減），從當期實際有資料的平台動態取。
  // selectedPlatforms 為空 = 全部（送出時給 ALL）。
  const [platformList, setPlatformList] = useState<{ series: string; platforms: string[] }[]>([]);
  // 各平台在「彩票 / 外接」哪一邊有資料 —— 剛上線的平台常常只有一邊
  const [platformSources, setPlatformSources] = useState<Record<string, string[]>>({});
  const [externalSourceOk, setExternalSourceOk] = useState(true);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformErr, setPlatformErr] = useState('');
  const platform = selectedPlatforms.length ? selectedPlatforms.join(',') : 'ALL';

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
  // 時段篩選：空字串 = 全部時段。班別定義同下方 DeepInput 區的說明。
  const [deepShift, setDeepShift] = useState('');
  // B 引擎（會員盈虧）：補充值/返點/工資，並套用原本那五條抓鬼規則。
  // ⚠ B 引擎只有 today/month/lifetime 三個窗口，不支援任意日期 —— 查歷史日期時對應不上。
  const [enrichWindow, setEnrichWindow] = useState('today');
  const [enrichData, setEnrichData] = useState<Record<string, any> | null>(null);
  const [enrichNote, setEnrichNote] = useState('');
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichErr, setEnrichErr] = useState('');
  const [rules, setRules] = useState({
    ratioHigh: '50', r1SalesMin: '30000', r1SalesMax: '',
    ratioLow: '2', r2DepositMin: '1000', r2DepositMax: '2000',
    treatmentMin: '50000', profitMin: '100000', r5SalesMin: '5000',
  });
  const [deepPlatform, setDeepPlatform] = useState('');
  const [deepUser, setDeepUser] = useState('');
  const [deepLottery, setDeepLottery] = useState('');
  const [deepCycle, setDeepCycle] = useState('');
  const [deepResult, setDeepResult] = useState<any>(null);
  const [deepProgress, setDeepProgress] = useState<{ pages: number; records: number; counted: number } | null>(null);

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
    setDeepProgress(null);
    setEnrichData(null);
    setEnrichNote('');
    setNmResult(null);
    // 把當下側邊欄的條件「凍結」成套用版本，這之後再勾選也不會影響表格
    setAppliedFiltersA(filtersA);
    try {
      // ───── 引擎 A：open API（彩種統計，粒度為「平台 × 彩種」），走同源代理 GET ─────
      // 資料源是 lottery-stats 不是 lottery-analysis —— 後者對 XO/XY/OL/XH/LS 五個平台一律回 0，
      // 金額與本端點差 4000 倍以上，詳見 docs/API-現狀.md 第三節。
      if (activeEngine === 'A') {
        const qs = new URLSearchParams({ platform, dateStart, dateEnd }).toString();
        // 外接遊戲是另一支端點、另一套欄位，不能跟彩票混在一起算
        const endpoint = gameKind === 'external' ? '/api/external-stats' : '/api/lottery-stats';
        const res = await fetch(`${endpoint}?${qs}`, { headers: { Accept: 'application/json' } });
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

      // ───── 引擎 C（新進會員）：抓批量創號特徵 ─────
      if (activeEngine === 'C') {
        const q = new URLSearchParams({ dateStart, dateEnd, minGroup: nmMinGroup || '2' });
        if (platform && platform.toUpperCase() !== 'ALL') q.set('platform', platform);
        const res = await fetch(`/api/new-members?${q.toString()}`, { headers: { Accept: 'application/json' } });
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `連線異常 (${res.status})`);
        setNmResult(json);
        setRawCount(json.summary?.records ?? 0);
        if (json.members?.length) setRawSample(json.members[0]);
        setRawData([]);
        return;
      }

      // ───── 引擎 B（定向深查）：拉注單明細，伺服器端已彙總到會員維度 ─────
      // 不做全站掃描：後端 member-bets 單次上限 10000 筆且沒有分頁，
      // 實測整天全彩種要 1715MB、18 個彩種被截斷，數字必錯。詳見 docs/API-現狀.md 第四節。
      const bq = new URLSearchParams({ dateStart, dateEnd });
      if (deepUser.trim()) bq.set('username', deepUser.trim());
      if (deepLottery.trim()) bq.set('lottery', deepLottery.trim());
      if (deepCycle.trim()) bq.set('cycleValue', deepCycle.trim());
      if (deepShift) bq.set('shift', deepShift);
      if (deepPlatform.trim()) bq.set('platform', deepPlatform.trim());
      // 查彩種/期號要把該平台整段期間的注單拉完才準，動輒數分鐘，
      // 非串流會被 Railway 閘道 300 秒切斷（502）。所以這種查詢改走串流：
      // 邊拉邊回報進度，連線持續有資料就不會被切。查帳號很快，走一般模式即可。
      const needStream = !deepUser.trim();
      let json: any;

      if (needStream) {
        bq.set('stream', '1');
        const res = await fetch(`/api/member-bets?${bq.toString()}`);
        if (!res.ok || !res.body) throw new Error(`連線異常 (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const obj = JSON.parse(line);
            if (obj.type === 'progress') setDeepProgress({ pages: obj.pages, records: obj.records, counted: obj.counted });
            else if (obj.type === 'error') throw new Error(obj.error);
            else if (obj.type === 'result') json = obj;
          }
        }
        if (!json) throw new Error('串流結束但沒有拿到結果');
      } else {
        const res = await fetch(`/api/member-bets?${bq.toString()}`, { headers: { Accept: 'application/json' } });
        json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `連線異常 (${res.status})`);
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

  // 對目前表格裡的會員逐個補 B 引擎資料（充值/返點/工資），並套用五條規則。
  // B 引擎只能逐個查（約 1 秒/人），所以限量 30 人、由使用者按鈕觸發，不自動跑。
  const enrichMembers = async () => {
    setEnrichLoading(true);
    setEnrichErr('');
    try {
      // 不截斷：表格裡有幾個就查幾個。B 引擎約 1 秒/人、伺服器端併發 10，
      // 人多就是久一點，但不會少查。
      const targets = filteredData
        .map((m: any) => `${(m.platform || '').split(',')[0]}:${m.username}`)
        .filter((s: string) => !s.startsWith(':') && !s.endsWith(':'));
      if (!targets.length) throw new Error('目前表格沒有可查的會員');

      const q = new URLSearchParams({ members: targets.join(','), window: enrichWindow });
      for (const [k, v] of Object.entries(rules)) if (String(v).trim() !== '') q.set(k, String(v).trim());

      const res = await fetch(`/api/member-enrich?${q.toString()}`, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || `連線異常 (${res.status})`);

      const map: Record<string, any> = {};
      for (const m of json.members || []) map[m.username] = m;
      setEnrichData(map);
      setEnrichNote(`${json.windowNote}　（查了 ${json.queried} 人，成功 ${json.okCount}、查到資料 ${json.foundCount}${json.capped ? '；超過 30 人已截斷' : ''}）`);
    } catch (e: any) {
      setEnrichErr(e.message);
      setEnrichData(null);
    } finally {
      setEnrichLoading(false);
    }
  };

  // 日期一變就重抓平台清單（不同日期有資料的平台可能不同），並把已不存在的選擇清掉
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPlatformLoading(true);
      setPlatformErr('');
      try {
        const res = await fetch(`/api/platforms?dateStart=${dateStart}&dateEnd=${dateEnd}`, { headers: { Accept: 'application/json' } });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || json?.error) throw new Error(json?.error || `連線異常 (${res.status})`);
        setPlatformList(json.grouped ?? []);
        setPlatformSources(json.sources ?? {});
        setExternalSourceOk(json.externalSourceOk !== false);
        const valid: string[] = json.platforms ?? [];
        setSelectedPlatforms(prev => prev.filter(p => valid.includes(p)));
      } catch (e: any) {
        if (!cancelled) setPlatformErr(e.message);
      } finally {
        if (!cancelled) setPlatformLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateStart, dateEnd]);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
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
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="engine" checked={activeEngine === 'C'} onChange={() => setActiveEngine('C')} className="w-4 h-4 text-gray-800" />
            <span className={activeEngine === 'C' ? "font-bold text-black" : "text-gray-600"}>新進會員</span>
          </label>
        </div>

        <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">⚙️ 審計維度勾選</h3>
        <div className="mb-4 p-3 bg-white rounded shadow-sm border border-gray-200">
          {activeEngine === 'A' && (
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">遊戲類型</label>
              <select value={gameKind} onChange={e => setGameKind(e.target.value as 'lottery' | 'external')}
                className="w-full border p-1.5 rounded text-black bg-white">
                <option value="lottery">彩票（對應後台「彩種統計」）</option>
                <option value="external">外接遊戲（對應後台「外接統計」）</option>
              </select>
              {gameKind === 'external' && (
                <div className="mt-1 text-xs text-gray-600 leading-relaxed">
                  外接是棋牌 / 電子 / 真人，跟彩票是兩套資料。
                  <b>人數欄位不完整</b>（後端有近八成的遊戲回 0 人），別拿來算人均；
                  盈虧一律採用後端給的值（後端對不同遊戲的算法不一致）。
                </div>
              )}
            </div>
          )}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">
                平台
                <span className="ml-1 text-xs font-normal text-gray-500">
                  {selectedPlatforms.length ? `已選 ${selectedPlatforms.length} 個` : '未選 = 全部'}
                </span>
              </label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setSelectedPlatforms(platformList.flatMap(g => g.platforms))}
                  className="text-xs px-2 py-0.5 border rounded bg-white hover:bg-gray-100">全選</button>
                <button type="button" onClick={() => setSelectedPlatforms([])}
                  className="text-xs px-2 py-0.5 border rounded bg-white hover:bg-gray-100">清除</button>
              </div>
            </div>

            {platformLoading && <div className="text-xs text-gray-500">讀取平台清單…</div>}
            {platformErr && <div className="text-xs text-red-600">平台清單讀取失敗：{platformErr}</div>}

            {platformList.map(g => (
              <div key={g.series} className="mb-1.5">
                <div className="text-xs text-gray-500 mb-0.5">{g.series} 系列</div>
                <div className="flex flex-wrap gap-1">
                  {g.platforms.map(p => {
                    const on = selectedPlatforms.includes(p);
                    // 剛上線的平台常常只有一邊有流水。標出來，免得使用者切到彩票查到 0 筆
                    // 就以為壞了 —— 那是這平台目前真的只有外接遊戲。
                    const src = platformSources[p] ?? [];
                    const onlyExternal = src.length === 1 && src[0] === '外接';
                    const onlyLottery = src.length === 1 && src[0] === '彩票';
                    return (
                      <button key={p} type="button" onClick={() => togglePlatform(p)}
                        title={src.length ? `目前有資料的：${src.join(' + ')}` : undefined}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          on ? 'bg-blue-600 text-white border border-blue-600 font-bold'
                             : 'bg-white text-gray-700 hover:bg-gray-100 ' +
                               (onlyExternal || onlyLottery ? 'border border-dashed border-amber-500' : 'border border-gray-300')
                        }`}>
                        {p}
                        {onlyExternal && <span className={`ml-0.5 ${on ? 'text-blue-100' : 'text-amber-600'}`}>·外</span>}
                        {onlyLottery && <span className={`ml-0.5 ${on ? 'text-blue-100' : 'text-amber-600'}`}>·彩</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="text-xs text-gray-500 mt-1 leading-relaxed">
              清單依所選日期實際有資料的平台產生（本次 {platformList.reduce((n, g) => n + g.platforms.length, 0)} 個），
              不是寫死的 —— <b className="text-gray-700">新平台上線只要後台發出資料就會自動出現</b>，不必改設定。
              標 <span className="text-amber-600">·外</span> / <span className="text-amber-600">·彩</span> 的平台目前只有單邊有流水
              （常見於剛上線），另一邊查到 0 筆是正常的。
              <b className="text-gray-700">數量若比平常少，代表後端該次回應不完整</b>，
              重新整理再看一次（清單只快取 3 分鐘）。
              {!externalSourceOk && (
                <b className="block text-red-600 mt-0.5">
                  ⚠️ 外接來源這次沒取到，清單可能少了「只有外接遊戲」的平台，請重新整理。
                </b>
              )}
            </div>
          </div>
          <label className="block text-sm font-medium mb-1">Date Start</label>
          <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="w-full border p-1 rounded mb-2 text-black" />
          <label className="block text-sm font-medium mb-1">Date End</label>
          <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="w-full border p-1 rounded text-black" />
          {/* 如實說明源頭口徑，不替使用者湊自然日 —— 一切以源頭給什麼為準 */}
          <div className="mt-2 text-xs text-gray-600 bg-gray-50 border border-gray-300 rounded p-1.5 leading-relaxed">
            日期口徑照源頭：後端一天的邊界是當地時間 <b>03:00</b>（不是 00:00），
            所以查 {dateStart === dateEnd ? '單日' : '這個區間'} 拿到的是
            「{dateStart} 03:00 ～ {(() => {
              const d = new Date(dateEnd + 'T00:00:00Z');
              d.setUTCDate(d.getUTCDate() + 1);
              return d.toISOString().slice(0, 10);
            })()} 03:00」。
          </div>
          {hasQueried && activeEngine === 'A'
            && JSON.stringify(filtersA) !== JSON.stringify(appliedFiltersA) && (
            <div className="mt-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-1.5 font-medium">
              ⏳ 條件有變更，按「執行查詢」才會套用
            </div>
          )}
          <button onClick={fetchData} disabled={loading} className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? '資料擷取中...' : '執行查詢'}
          </button>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
            className="mt-2 w-full bg-gray-400 text-white py-1 rounded hover:bg-gray-500 text-sm">
            登出
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

        {activeEngine === 'C' && (
          <div>
            <div className="mb-3 p-2 bg-gray-100 border border-gray-300 rounded text-xs text-gray-700 leading-relaxed">
              抓批量創號的特徵：把<b>同上級 / 同獎金號 / 同註冊碼 / 同首充金額 / 同 IP</b>
              的帳號歸在一起，另外標出<b>短時間內密集創號</b>的批次。
              <br />
              這裡只陳述「哪些帳號的某個值相同」，<b>不代表就是同一批人</b> ——
              尤其同 IP，機房出口會讓不相干的人共用，所以機房另外分開標。
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1 text-gray-700">幾人以上才算一組</label>
              <input type="number" min={2} value={nmMinGroup} onChange={e => setNmMinGroup(e.target.value)}
                className="w-full border p-2 rounded text-black" />
              <div className="text-xs text-gray-500 mt-1">預設 2。調高可以只看比較大的批次。</div>
            </div>
            <div className="text-xs text-gray-500 px-1 leading-relaxed">
              平台與日期用上面那組。平台留 <code>ALL</code> 會查當期所有有資料的平台，
              平台多的話會慢一些（後端要逐平台抓）。
            </div>
          </div>
        )}

        {activeEngine === 'B' && (
          <div>
            <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-xs text-amber-800">
              後端 <code>member-income</code> 目前任何日期都回 0 筆，全站掃描的五條規則暫時下架
              （定義留在 docs/API-現狀.md）。這裡改成拉注單明細做定向深查。
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1 text-gray-700">時段</label>
              <select value={deepShift} onChange={e => setDeepShift(e.target.value)}
                className="w-full border p-2 rounded text-black bg-white">
                <option value="">全部時段</option>
                <option value="早">早班 08:00–16:00</option>
                <option value="中">中班 16:00–24:00</option>
                <option value="晚">晚班 00:00–08:00</option>
              </select>
              <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                在日期區間內再依班別篩選，只有選定時段的注單會計入統計。
                班別用源頭 <code>bet_time</code> 的字面值判定，不做時區位移。
              </div>
            </div>
            <div className="text-xs text-gray-500 mb-2 px-1">下面三個至少填一個，不能只給日期</div>
            <DeepInput label="會員帳號" hint="例如 lh838366" value={deepUser} onChange={setDeepUser} />
            <DeepInput label="彩種" hint="例如 東京1.5分彩" value={deepLottery} onChange={setDeepLottery} />
            <DeepInput label="期號" hint="例如 202608130360" value={deepCycle} onChange={setDeepCycle} />
            <div className="text-xs text-gray-500 px-1 leading-relaxed mb-4">
              全部走 C 引擎，翻頁翻到底、不設資料量上限，數字不會被截斷。
              帳號、彩種、期號都交給後端過濾，通常 1 秒內。
              <br />
              <b className="text-gray-700">彩種名要用「彩種統計查詢」表格裡的寫法</b>
              （例如 <code>排列五(15)</code> 這種帶編號的），直接複製過來即可；
              注單裡顯示的名稱（如 <code>排列三五</code>）後端不認、會回 0 筆。
            </div>
            <DeepInput label="平台（選填，可用逗號分隔）" hint="例如 HS 或 HS,XO；留空 = 全部平台" value={deepPlatform} onChange={setDeepPlatform} />

            <div className="border-t border-gray-300 pt-3">
              <div className="font-bold text-sm text-gray-700 mb-1">B 引擎（充值/返點/工資）</div>
              <div className="text-xs text-gray-500 mb-2 leading-relaxed">
                查完注單後，可對表格裡的會員逐個補 B 引擎資料，並套用下面五條規則。
                <span className="text-orange-700 font-medium">
                  ⚠ B 引擎只有 today / month / lifetime 三個窗口，不吃任意日期 ——
                  查歷史日期時這些數字對應不到那一天。
                </span>
              </div>
              <label className="block text-xs font-medium mb-1 text-gray-700">B 引擎窗口</label>
              <select value={enrichWindow} onChange={e => setEnrichWindow(e.target.value)}
                className="w-full border p-2 rounded text-black bg-white mb-2 text-sm">
                <option value="today">今天 today</option>
                <option value="month">本月 month</option>
                <option value="lifetime">歷史累計 lifetime</option>
              </select>

              <details className="mb-2">
                <summary className="text-xs text-blue-600 cursor-pointer select-none">五條規則門檻（留空 = 不啟用該條）</summary>
                <div className="mt-2 space-y-1.5">
                  {([
                    ['ratioHigh', '① 充銷比 ≥'], ['r1SalesMin', '　 銷量 ≥'], ['r1SalesMax', '　 銷量 ≤'],
                    ['ratioLow', '② 充銷比 ≤'], ['r2DepositMin', '　 充值 ≥'], ['r2DepositMax', '　 充值 ≤'],
                    ['treatmentMin', '③ 返點 ≥'], ['profitMin', '④ 會員盈虧 ≥'], ['r5SalesMin', '⑤ 無充值·銷量 ≥'],
                  ] as [keyof typeof rules, string][]).map(([k, label]) => (
                    <div key={k} className="flex items-center gap-2">
                      <label className="text-xs text-gray-600 w-28 shrink-0">{label}</label>
                      <input type="number" value={rules[k]}
                        onChange={e => setRules(prev => ({ ...prev, [k]: e.target.value }))}
                        className="flex-1 border p-1 rounded text-black text-xs" />
                    </div>
                  ))}
                </div>
              </details>

              <button onClick={enrichMembers} disabled={enrichLoading || !hasQueried}
                className="w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800 disabled:opacity-50 text-sm">
                {enrichLoading
                  ? `查詢中…（${filteredData.length} 人，約 ${Math.ceil(filteredData.length / 10)} 秒）`
                  : `補 B 引擎資料（表格內 ${filteredData.length} 人全查）`}
              </button>
              {enrichErr && <div className="mt-2 text-xs text-red-600">{enrichErr}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-6 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A'
            ? (gameKind === 'external' ? '外接遊戲統計' : '彩種統計查詢')
            : activeEngine === 'B' ? '會員注單深查' : '新進會員'}
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
                <div>
                  🔸 注單筆數：<b>{deepResult.summary.records}</b>　會員 <b>{deepResult.summary.memberCount}</b> 人　IP <b>{deepResult.summary.ipCount}</b> 個
                  {deepResult.summary.shift && (
                    <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">
                      只計 {deepResult.summary.shift}班
                    </span>
                  )}
                </div>
                {deepResult.summary.shift && (
                  <div className="text-xs text-gray-600">
                    　 源頭這個區間共 {deepResult.summary.recordsFromSource} 筆，
                    篩掉其他時段 {deepResult.summary.excludedByShift} 筆後計入 {deepResult.summary.records} 筆
                  </div>
                )}
                <div>🔸 投注 <b>{fmtMoney(deepResult.summary.betAmount)}</b>　派彩 <b>{fmtMoney(deepResult.summary.winAmount)}</b>　莊家盈虧{' '}
                  <b className={deepResult.summary.housePnl >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtMoney(deepResult.summary.housePnl)}</b>
                </div>
                {deepResult.summary.spanFirst && (
                  <div>🔸 源頭實際涵蓋：<b>{deepResult.summary.spanFirst.slice(0, 19).replace('T', ' ')}</b> ～ <b>{deepResult.summary.spanLast.slice(0, 19).replace('T', ' ')}</b></div>
                )}
                <div className="text-xs text-gray-500">
                  🔸 資料源：{deepResult.summary.engine === 'C' ? `C 引擎（翻了 ${deepResult.summary.pages} 頁）` : '舊 member-bets 端點'}
                  {deepResult.summary.cancelled > 0 && (
                    <span className="ml-2 text-orange-700">
                      · 含 {deepResult.summary.cancelled} 筆撤單（投注 {fmtMoney(deepResult.summary.cancelledAmount)}，源頭已計入上面金額）
                    </span>
                  )}
                </div>
                {enrichNote && (
                  <div className="mt-2 p-2 bg-emerald-50 border border-emerald-300 rounded text-xs text-emerald-900 leading-relaxed">
                    <b>B 引擎資料（{deepResult.summary ? enrichWindow : ''}）：</b>{enrichNote}
                  </div>
                )}
                <div className="text-xs text-gray-500">🔸 回應體 {(deepResult.summary.bytes / 1048576).toFixed(1)}MB</div>
                {deepResult.summary.truncated && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-400 rounded text-red-700">
                    <b>⚠️ 這批資料不完整，上面的金額偏低，不要直接拿去下判斷。</b>
                    <div className="mt-1 font-normal">
                      原因：{deepResult.summary.stoppedReason || '未知'}
                      <br />
                      重跑一次通常就會拿到完整資料（同條件會重新拉，不吃快取的不完整結果）。
                    </div>
                  </div>
                )}
                {!deepResult.summary.truncated && deepResult.summary.retries > 0 && (
                  <div className="text-xs text-gray-500">
                    🔸 中途上游有 {deepResult.summary.retries} 次請求失敗，已自動重試成功，資料完整
                  </div>
                )}
                {deepResult.summary.lotteryWarning && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-400 rounded text-amber-900">
                    <b>查「{deepResult.summary.lotteryWarning.queried}」沒有任何注單。</b>
                    <div className="mt-1 font-normal">
                      多半是彩種名寫法不同。請<b>直接複製 A 引擎（彩種統計查詢）表格裡的彩種名</b>，
                      例如 <code>排列五(15)</code> 這種帶編號的寫法 —— 後端認的是那一套，
                      注單裡顯示的名稱（如 <code>排列三五</code>）反而查不到。
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

        {/* 串流進度：查彩種/期號要拉全量，讓人看得到跑到哪，而不是對著轉圈猜 */}
        {loading && deepProgress && (
          <div className="bg-blue-50 border border-blue-300 rounded p-3 mb-4 text-sm font-mono">
            <div className="font-bold text-blue-800 mb-1">⏳ 拉取中（資料不設上限，翻頁翻到底）</div>
            <div>已翻 <b>{deepProgress.pages}</b> 頁　源頭 <b>{deepProgress.records.toLocaleString()}</b> 筆
              符合條件 <b>{deepProgress.counted.toLocaleString()}</b> 筆</div>
            <div className="text-xs text-gray-600 mt-1">
              C 引擎沒有彩種/期號參數，只能拉完再本地精確比對 —— 慢，但不會串到別的彩種、也不會少資料。
            </div>
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

        {/* 新進會員：分組結果 + 明細 */}
        {activeEngine === 'C' && nmResult && (() => {
          const s = nmResult.summary;
          const home = (nmResult.byIp ?? []).filter((x: any) => !x.datacenter);
          const dc = (nmResult.byIp ?? []).filter((x: any) => x.datacenter);
          const Group = ({ title, hint, items, valueLabel }: any) => (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
              <div className="font-bold text-gray-700 mb-1">{title}　<span className="font-normal text-gray-500 text-sm">{items.length} 組</span></div>
              {hint && <div className="text-xs text-gray-500 mb-2 leading-relaxed">{hint}</div>}
              {items.length === 0 ? (
                <div className="text-sm text-gray-500">沒有達到門檻的組。</div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="p-2 font-bold text-gray-600">{valueLabel}</th>
                      <th className="p-2 font-bold text-gray-600 w-20">帳號數</th>
                      <th className="p-2 font-bold text-gray-600">帳號</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 30).map((g: any) => (
                      <tr key={g.value} className="border-b hover:bg-blue-50">
                        <td className="p-2 font-mono font-bold text-blue-700 whitespace-nowrap">{g.value}</td>
                        <td className="p-2 font-bold">{g.count}</td>
                        <td className="p-2 text-xs text-gray-700 break-all">{g.members.join('、')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {items.length > 30 && <div className="text-xs text-gray-500 mt-2">只顯示前 30 組，共 {items.length} 組。</div>}
            </div>
          );

          return (
            <>
              <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm font-mono">
                <div>🔸 新進會員 <b>{s.records}</b> 人　平台 <b>{s.platformCount}</b> 個（{s.platforms.join(', ')}）</div>
                <div>🔸 有首充 <b>{s.withFirstDeposit}</b> 人　有註冊碼 <b>{s.withRegCode}</b> 人　門檻 {s.minGroup} 人成組</div>
                <div className="text-xs text-gray-600 mt-1">🔸 {s.dateNote}</div>
                {s.upstreamErrors?.length > 0 && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-400 rounded text-red-700">
                    ⚠️ 後端有平台抓取失敗，這批資料不完整：{JSON.stringify(s.upstreamErrors)}
                  </div>
                )}
              </div>

              <Group title="🔗 同上級" valueLabel="平台/上級" items={nmResult.byAgent}
                hint="同一個上級底下新開的帳號。正常代理也會有，看的是數量與其他特徵是否同時成立。" />
              <Group title="🎯 同獎金號" valueLabel="平台/獎金號" items={nmResult.byBonusCode}
                hint="獎金號由上級統一下發，整批一致代表同一條線批量開的。" />
              <Group title="🔖 同註冊碼" valueLabel="平台/註冊碼" items={nmResult.byRegCode}
                hint="同一個推廣連結進來的。" />
              <Group title="💰 同首充金額" valueLabel="首充金額" items={nmResult.byFirstDeposit}
                hint="批量養號常見首充金額一致。金額小的組參考價值低（很多人剛好充一樣的數）。" />

              <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
                <div className="font-bold text-gray-700 mb-1">🌐 同最後登入 IP　<span className="font-normal text-gray-500 text-sm">住宅 {home.length} 組</span></div>
                <div className="text-xs text-gray-500 mb-2">機房 / 雲端出口會讓不相干的人共用同一個 IP，所以分開列，不要當成同一批人的證據。</div>
                {home.length === 0 ? <div className="text-sm text-gray-500">沒有住宅 IP 共用的情況。</div> : home.map((g: any) => (
                  <div key={g.value} className="text-sm mb-1">
                    <span className="font-mono font-bold text-red-600">{g.value}</span>
                    <span className="text-gray-500"> — {g.count} 個帳號：</span>
                    <span className="text-blue-700">{g.members.join('、')}</span>
                  </div>
                ))}
                {dc.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                    另有 {dc.length} 個機房 / 雲端出口 IP（{dc.slice(0, 3).map((x: any) => x.value).join('、')}{dc.length > 3 ? ' 等' : ''}）共用帳號，已排除。
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-4">
                <div className="font-bold text-gray-700 mb-1">⏱ 密集創號　<span className="font-normal text-gray-500 text-sm">{nmResult.timeClusters.length} 批</span></div>
                <div className="text-xs text-gray-500 mb-2">同平台同上級、30 分鐘內註冊 {s.minGroup} 個以上算一批。</div>
                {nmResult.timeClusters.length === 0 ? <div className="text-sm text-gray-500">沒有達到門檻的批次。</div> : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100 border-b">
                      <tr>
                        <th className="p-2 font-bold text-gray-600">平台</th>
                        <th className="p-2 font-bold text-gray-600">上級</th>
                        <th className="p-2 font-bold text-gray-600 w-16">人數</th>
                        <th className="p-2 font-bold text-gray-600">時間範圍</th>
                        <th className="p-2 font-bold text-gray-600">帳號</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nmResult.timeClusters.slice(0, 30).map((c: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-blue-50">
                          <td className="p-2">{c.platform}</td>
                          <td className="p-2 font-mono text-blue-700">{c.agent}</td>
                          <td className="p-2 font-bold">{c.count}</td>
                          <td className="p-2 text-xs font-mono text-gray-600">{c.from} ~ {c.to.slice(11)}</td>
                          <td className="p-2 text-xs text-gray-700 break-all">{c.members.join('、')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-lg shadow border border-gray-200">
                <div className="p-4 font-bold text-gray-700 border-b">📋 全部新進會員（{nmResult.members.length} 人）</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-gray-100 border-b sticky top-0 z-20">
                      <tr>
                        {['平台', '帳號', '上級', '獎金號', '註冊時間', '首充金額', '首充管道', '最後登入IP', '來源', '註冊碼'].map(h => (
                          <th key={h} className="p-3 font-bold text-gray-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nmResult.members.map((m: any, i: number) => (
                        <tr key={`${m.platform}/${m.account}/${i}`} className="border-b hover:bg-blue-50">
                          <td className="p-3">{m.platform}</td>
                          <td className="p-3 font-bold text-blue-600">{m.account}</td>
                          <td className="p-3">{m.agent || '—'}</td>
                          <td className="p-3 font-mono">{m.bonusCode || '—'}</td>
                          <td className="p-3 text-xs font-mono text-gray-600">{m.registeredAt}</td>
                          <td className="p-3">{m.firstDepositAmount > 0 ? fmtMoney(m.firstDepositAmount) : '—'}</td>
                          <td className="p-3">{m.firstDepositChannel || '—'}</td>
                          <td className="p-3 text-xs font-mono text-gray-600">{m.lastLoginIp || '—'}</td>
                          <td className="p-3 text-xs">{m.source || '—'}</td>
                          <td className="p-3 font-mono text-xs">{m.regCode || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          );
        })()}

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
                早 08:00–16:00、中 16:00–24:00、晚 00:00–08:00，
                直接用源頭 <code>bet_time</code> 的字面值切{off !== 0 ? `（另外位移 ${off} 小時）` : '，不做時區位移'}。
                因為後端一天的邊界是當地 03:00，一次查詢會橫跨兩個日期，
                所以下面按「日期 × 班別」分開列，如實呈現源頭給的範圍，不做湊整。
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

        {/* A / B 引擎的主表格；C 引擎有自己的呈現，不走這裡 */}
        <div className={`bg-white rounded-lg shadow border border-gray-200 ${activeEngine === 'C' ? 'hidden' : ''}`}>
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="p-4 font-bold text-gray-600">核查</th>
                {activeEngine === 'A' && <>
                  <th className="p-4 font-bold text-gray-600">平台</th>
                  <th className="p-4 font-bold text-gray-600">{gameKind === 'external' ? '遊戲' : '彩種'}</th>
                  <th className="p-4 font-bold text-gray-600">
                    人數{gameKind === 'external' && <span className="font-normal text-gray-400 text-xs"> (多數為 0)</span>}
                  </th>
                  <th className="p-4 font-bold text-gray-600">投注筆數</th>
                </>}
                {activeEngine === 'B' && <>
                  <th className="p-4 font-bold text-gray-600">平台</th>
                  <th className="p-4 font-bold text-gray-600">會員帳號</th>
                  <th className="p-4 font-bold text-gray-600">彩種數</th>
                  <th className="p-4 font-bold text-gray-600">IP</th>
                  {enrichData && <>
                    <th className="p-4 font-bold text-emerald-700">充值</th>
                    <th className="p-4 font-bold text-emerald-700">返點</th>
                    <th className="p-4 font-bold text-emerald-700">工資</th>
                    <th className="p-4 font-bold text-emerald-700">充銷比</th>
                    <th className="p-4 font-bold text-emerald-700">命中規則</th>
                  </>}
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
                      {enrichData && (() => {
                        const e = enrichData[item.username];
                        if (!e) return <><td className="p-4 text-gray-400" colSpan={5}>未查</td></>;
                        if (!e.ok) return <><td className="p-4 text-red-500 text-xs" colSpan={5}>{e.error}</td></>;
                        if (!e.found) return <><td className="p-4 text-gray-400 text-xs" colSpan={5}>B 引擎查無此帳號</td></>;
                        return <>
                          <td className="p-4">{fmtMoney(e.deposit)}</td>
                          <td className="p-4">{fmtMoney(e.treatment)}</td>
                          <td className="p-4">{fmtMoney(e.activity)}</td>
                          <td className="p-4">{e.ratio === null ? <span className="text-gray-400">充值 0</span> : e.ratio}</td>
                          <td className="p-4">
                            {e.matched?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {e.matched.map((r: string, i: number) => (
                                  <span key={i} className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold whitespace-nowrap">{r}</span>
                                ))}
                              </div>
                            ) : <span className="text-gray-400 text-xs">—</span>}
                          </td>
                        </>;
                      })()}
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
