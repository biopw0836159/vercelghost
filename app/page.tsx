'use client';
import { useState, useMemo, useEffect } from 'react';

const LOGIN_URL = 'https://stats-crawler.up.railway.app/api/auth/login';
const TOKEN_KEY = 'audit_jwt_token';
const ALL_PLATFORMS = ["XH","LS","OL","XY","SH","YS","JY","HS","FB","SY","LY","MT","JD","ND","YD"];
const ENGINE_URLS: Record<string, string> = {
  A: 'https://stats-crawler.up.railway.app/api/query-user-lottery-analysis',
  B: 'https://stats-crawler.up.railway.app/api/query-member-income',
};

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token));
    const exp = payload.exp;
    if (!exp) return false;
    const expMs = exp > 1e12 ? exp : exp * 1000;
    return Date.now() > expMs;
  } catch {
    return true;
  }
}

// 處理後台可能回傳帶逗號的字串數字，例如 "53,684.13"
const parseNum = (v: any): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const cleaned = String(v).replace(/,/g, '').trim();
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

// 模糊搜尋 key (去除空白/底線/連字號，做小寫比對)
const findField = (item: any, patterns: RegExp[]): any => {
  for (const key of Object.keys(item)) {
    const norm = key.replace(/[\s_\-]/g, '').toLowerCase();
    for (const p of patterns) {
      if (p.test(norm) || p.test(key)) return item[key];
    }
  }
  return undefined;
};

const normalizeData = (item: any, engine: 'A' | 'B') => {
  const deposit = parseNum(item['充值'] ?? item.deposit ?? item.deposit_amount ?? item.recharge ?? findField(item, [/充值/, /deposit/i, /recharge/i]));
  const totalSales = parseNum(item['投注'] ?? item.totalSales ?? item.total_sales ?? item.sales ?? item.bet_amount ?? findField(item, [/投注/, /銷量/, /销量/, /sales/i, /betamount/i]));
  const directRatio = parseNum(item['充销比'] ?? item['充銷比'] ?? item.deposit_sales_ratio ?? item.ratio ?? findField(item, [/充销比/, /充銷比/, /depositsalesratio/i]));
  const ratio = directRatio > 0 ? directRatio : (deposit > 0 ? Number((totalSales / deposit).toFixed(2)) : 0);

  // 返點：先試精確 key，再用模糊比對 (只要 key 裡有「返点」「返點」「rebate」就抓)
  const rebateRaw =
    item['总返点'] ?? item['總返點'] ?? item['总返點'] ?? item['總返点'] ??
    item.rebate ?? item.total_rebate ?? item.totalRebate ?? item.treatment ??
    findField(item, [/返点/, /返點/, /rebate/i]);

  return {
    id: `${item['平台'] || item.platform || item.site || item.merchant || '-'}::${item.account || item.username || item['用户名'] || item.member_id || item.id || Math.random().toString()}::${item['彩种'] || item.lotteryType || item.lottery || item.lottery_name || '-'}`,
    platform: item['平台'] || item.platform || item.site || item.merchant || '-',
    username: item['用户名'] || item.account || item.username || item.user_name || '-',
    lottery: item['彩种'] || item.lotteryType || item.lottery || item.lottery_name || '-',
    reason: Array.isArray(item.reason) ? item.reason.join(', ') :
            (typeof item.reason === 'string' ? item.reason :
             (item.abnormal_reason || item.remark || '')),
    totalSales,
    orderCount: parseNum(item.orderCount ?? item.order_count ?? item.orders ?? item.bet_count),
    pnl: parseNum(item['盈亏'] ?? item.pnl ?? item.profit ?? item.net_profit ?? item.profit_loss),
    rtp: parseNum(item.rtp ?? item.return_to_player),
    deposit,
    ratio,
    treatment: parseNum(rebateRaw),
    betAmount: parseNum(item['投注'] ?? item.betAmount ?? item.bet_amount ?? item.sales),
    profit: parseNum(item['盈亏'] ?? item.profit ?? item.pnl ?? item.net_profit),
  };
};

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

const RuleCard = ({ rule, ruleKey, title, desc, fields, stateUpdater }: any) => (
  <div className={`mb-3 p-3 rounded border transition-colors ${rule.active ? 'bg-white border-blue-400 shadow-sm' : 'bg-gray-100 border-gray-200'}`}>
    <div className="flex items-center gap-2 mb-1">
      <input type="checkbox" checked={rule.active}
        onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [ruleKey]: { ...prev[ruleKey], active: e.target.checked } }))}
        className="w-4 h-4 cursor-pointer" />
      <label className="text-sm font-bold text-gray-800">{title}</label>
    </div>
    {desc && <div className="text-xs text-gray-500 mb-2 pl-6">{desc}</div>}
    <div className="space-y-2 pl-6">
      {fields.map((f: any) => (
        <div key={f.field}>
          <label className="text-xs text-gray-600 block mb-0.5">{f.label}</label>
          <input type="number" disabled={!rule.active} value={rule[f.field]}
            onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [ruleKey]: { ...prev[ruleKey], [f.field]: Number(e.target.value) } }))}
            className="w-full p-1.5 border rounded bg-gray-800 text-white disabled:opacity-40 text-sm" />
        </div>
      ))}
    </div>
  </div>
);

export default function AuditDashboard() {
  const [token, setToken] = useState<string>('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const today = new Date();
  const fiveDaysAgo = new Date(today);
  fiveDaysAgo.setDate(today.getDate() - 5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [activeEngine, setActiveEngine] = useState<'A' | 'B'>('A');
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

  const defaultFiltersA = {
    minSales: { active: true, value: 0.00 },
    maxSales: { active: true, value: 2000.00 },
    maxOrders: { active: true, value: 12 },
    minPnl: { active: true, value: 100000.00 },
    maxPnl: { active: true, value: 1000000.00 },
    minRtp: { active: true, value: 0.995 },
    maxRtp: { active: true, value: 1.000 },
  };

  const defaultFiltersB = {
    rule1: { active: false, ratioHigh: 50, salesMin: 30000, salesMax: 99999999 },
    rule2: { active: false, ratioLow: 2, depositMin: 1000, depositMax: 2000 },
    rule3: { active: false, treatmentMin: 50000 },
    rule4: { active: false, profitMin: 100000 },       // 原 rule5 (大額盈利)
    rule5: { active: false, salesMin: 5000 },          // 原 rule6 (無充值銷量高)
  };

  // 側邊欄當下勾選(草稿) - 勾選時即時更新
  const [filtersA, setFiltersA] = useState(defaultFiltersA);
  const [filtersB, setFiltersB] = useState(defaultFiltersB);

  // 實際套用到表格的條件 - 只在按「執行查詢」時才同步
  const [appliedFiltersA, setAppliedFiltersA] = useState(defaultFiltersA);
  const [appliedFiltersB, setAppliedFiltersB] = useState(defaultFiltersB);

  type SortCol = 'totalSales' | 'deposit' | 'ratio' | 'treatment' | 'profit';
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
      return rawData.filter(item => {
        try {
          if (appliedFiltersA.minSales.active && item.totalSales < appliedFiltersA.minSales.value) return false;
          if (appliedFiltersA.maxSales.active && item.totalSales > appliedFiltersA.maxSales.value) return false;
          if (appliedFiltersA.maxOrders.active && item.orderCount > appliedFiltersA.maxOrders.value) return false;
          if (appliedFiltersA.minPnl.active && item.pnl < appliedFiltersA.minPnl.value) return false;
          if (appliedFiltersA.maxPnl.active && item.pnl > appliedFiltersA.maxPnl.value) return false;
          if (appliedFiltersA.minRtp.active && item.rtp < appliedFiltersA.minRtp.value) return false;
          if (appliedFiltersA.maxRtp.active && item.rtp > appliedFiltersA.maxRtp.value) return false;
          return true;
        } catch { return false; }
      });
    }
    const anyRuleActive = Object.values(appliedFiltersB).some((r: any) => r.active);
    const result = rawData
      .map((item: any) => {
        const matched: string[] = [];
        try {
          // ① 充銷比高 + 銷量區間：比值≥閾值 且 銷量在[min,max]區間內
          if (appliedFiltersB.rule1.active && item.deposit > 0
              && item.ratio >= appliedFiltersB.rule1.ratioHigh
              && item.totalSales >= appliedFiltersB.rule1.salesMin
              && item.totalSales <= appliedFiltersB.rule1.salesMax) matched.push('充銷比高');
          // ② 充銷比低 + 充值區間：比值≤閾值 且 充值在[min,max]區間內
          if (appliedFiltersB.rule2.active && item.deposit > 0
              && item.ratio <= appliedFiltersB.rule2.ratioLow
              && item.deposit >= appliedFiltersB.rule2.depositMin
              && item.deposit <= appliedFiltersB.rule2.depositMax) matched.push('充銷比低');
          // ③ 高返點
          if (appliedFiltersB.rule3.active && item.treatment >= appliedFiltersB.rule3.treatmentMin) matched.push('高返點');
          // ④ 大額盈利 (原 rule5)
          if (appliedFiltersB.rule4.active && item.profit >= appliedFiltersB.rule4.profitMin) matched.push('大額盈利');
          // ⑤ 無充值銷量高 (原 rule6)
          if (appliedFiltersB.rule5.active && item.deposit === 0 && item.totalSales > 0
              && appliedFiltersB.rule5.salesMin > 0
              && item.totalSales >= appliedFiltersB.rule5.salesMin) matched.push('無充值銷量高');
        } catch {}
        return { ...item, matchedReasons: matched };
      })
      .filter((item: any) => !anyRuleActive || item.matchedReasons.length > 0);

    if (sortBy) {
      const sign = sortBy.dir === 'desc' ? -1 : 1;
      return [...result].sort((a, b) => {
        const av = Number(a[sortBy.col]) || 0;
        const bv = Number(b[sortBy.col]) || 0;
        return (av - bv) * sign;
      });
    }
    return result;
  }, [rawData, activeEngine, appliedFiltersA, appliedFiltersB, sortBy]);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved && !isTokenExpired(saved)) setToken(saved);
  }, []);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await res.json();
      const jwt = data.token || data.data?.token || data.accessToken;
      if (!jwt) throw new Error(data.message || '登入失敗，請確認帳號密碼');
      sessionStorage.setItem(TOKEN_KEY, jwt);
      setToken(jwt);
    } catch (e: any) {
      setLoginError(e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white rounded-lg shadow-lg p-8 w-80">
          <h2 className="text-2xl font-bold mb-6 text-center">審計系統登入</h2>
          <input className="w-full border p-2 rounded mb-3" placeholder="帳號" value={loginUser} onChange={e => setLoginUser(e.target.value)} />
          <input className="w-full border p-2 rounded mb-4" type="password" placeholder="密碼" value={loginPass} onChange={e => setLoginPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          {loginError && <p className="text-red-500 text-sm mb-3">{loginError}</p>}
          <button onClick={handleLogin} disabled={loginLoading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {loginLoading ? '登入中...' : '登入'}
          </button>
        </div>
      </div>
    );
  }

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
    // 把當下側邊欄的條件「凍結」成套用版本，這之後再勾選也不會影響表格
    setAppliedFiltersA(filtersA);
    setAppliedFiltersB(filtersB);
    try {
      const platforms = platform === 'ALL' ? ALL_PLATFORMS : [platform];
      const body = {
        account: '',
        byPlayType: false,
        dateStart,
        dateEnd,
        lottery: '',
        noAccountMode: true,
        platforms,
      };

      const res = await fetch(ENGINE_URLS[activeEngine] || ENGINE_URLS['A'], {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (json.code === 401 || res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken('');
        throw new Error('登入已過期，請重新登入');
      }
      if (!res.ok || json.error) {
        throw new Error(json.message || json.error || `連線異常 (${res.status})`);
      }

      const rawArray: any[] = Array.isArray(json.rows) ? json.rows : (Array.isArray(json) ? json : []);
      setRawCount(rawArray.length);
      if (rawArray.length > 0) setRawSample(rawArray[0]);
      const cleanData = rawArray.map(item => normalizeData(item, activeEngine));

      // 引擎 A (用戶彩票分析)：一個用戶會有多個彩種，key 要帶 lottery，否則會被當成重複丟掉
      // 引擎 B (盈虧排行)：一人一筆，只用 平台+用戶名 即可
      const seen = new Map<string, any>();
      for (const row of cleanData) {
        const key = activeEngine === 'A'
          ? `${row.platform}::${row.username}::${row.lottery}`
          : `${row.platform}::${row.username}`;
        if (!seen.has(key)) seen.set(key, row);
      }
      const deduped = Array.from(seen.values());

      setRawData(deduped);

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
            <span className={activeEngine === 'A' ? "font-bold text-black" : "text-gray-600"}>用戶彩票分析</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="engine" checked={activeEngine === 'B'} onChange={() => setActiveEngine('B')} className="w-4 h-4 text-gray-800" />
            <span className={activeEngine === 'B' ? "font-bold text-black" : "text-gray-600"}>盈虧排行</span>
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
          {hasQueried && (activeEngine === 'A'
            ? JSON.stringify(filtersA) !== JSON.stringify(appliedFiltersA)
            : JSON.stringify(filtersB) !== JSON.stringify(appliedFiltersB)
          ) && (
            <div className="mt-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-1.5 font-medium">
              ⏳ 條件有變更，按「執行查詢」才會套用
            </div>
          )}
          <button onClick={fetchData} disabled={loading} className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? '資料擷取中...' : '執行查詢'}
          </button>
          <button onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(''); }} className="mt-2 w-full bg-gray-400 text-white py-1 rounded hover:bg-gray-500 text-sm">
            登出
          </button>
        </div>

        {activeEngine === 'A' && (
          <div className="space-y-2">
            <FilterInput label="Min銷量" filterObj={filtersA.minSales} stateUpdater={setFiltersA} stateKey="minSales" />
            <FilterInput label="Max銷量" filterObj={filtersA.maxSales} stateUpdater={setFiltersA} stateKey="maxSales" />
            <FilterInput label="單數 ≤" filterObj={filtersA.maxOrders} stateUpdater={setFiltersA} stateKey="maxOrders" />
            <FilterInput label="Min盈虧" filterObj={filtersA.minPnl} stateUpdater={setFiltersA} stateKey="minPnl" />
            <FilterInput label="Max盈虧" filterObj={filtersA.maxPnl} stateUpdater={setFiltersA} stateKey="maxPnl" />
            <FilterInput label="Min RTP" filterObj={filtersA.minRtp} stateUpdater={setFiltersA} stateKey="minRtp" />
            <FilterInput label="Max RTP" filterObj={filtersA.maxRtp} stateUpdater={setFiltersA} stateKey="maxRtp" />
          </div>
        )}

        {activeEngine === 'B' && (
          <div>
            <div className="text-xs text-gray-500 mb-2 px-1">勾選要啟用的規則，規則之間為「或」關係</div>
            <RuleCard rule={filtersB.rule1} ruleKey="rule1" title="① 充銷比(高) + 銷量區間" desc="比值≥閾值 且 銷量落在[最小, 最大]區間內"
              fields={[
                { field: 'ratioHigh', label: '充銷比(高) ≥' },
                { field: 'salesMin', label: '銷量(小) ≥' },
                { field: 'salesMax', label: '銷量(大) ≤' },
              ]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule2} ruleKey="rule2" title="② 充銷比(低) + 充值區間" desc="比值≤閾值 且 充值落在[最小, 最大]區間內"
              fields={[
                { field: 'ratioLow', label: '充銷比(低) ≤' },
                { field: 'depositMin', label: '充值(小) ≥' },
                { field: 'depositMax', label: '充值(大) ≤' },
              ]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule3} ruleKey="rule3" title="③ 返點" desc="返點 ≥ 閾值"
              fields={[{ field: 'treatmentMin', label: '返點 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule4} ruleKey="rule4" title="④ 盈虧" desc="盈利 ≥ 閾值"
              fields={[{ field: 'profitMin', label: '盈虧 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule5} ruleKey="rule5" title="⑤ 無充值銷量高" desc="充值 = 0 且 銷量 ≥ 閾值"
              fields={[{ field: 'salesMin', label: '銷量 ≥' }]} stateUpdater={setFiltersB} />
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-6 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '用戶彩票分析' : '盈虧排行'}
        </div>

        {hasQueried && !loading && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm font-mono">
            <div>🔸 API 回傳原始筆數：<b>{rawCount}</b></div>
            <div>🔸 前端去重後筆數：<b>{rawData.length}</b></div>
            <div>🔸 通過過濾條件筆數：<b>{filteredData.length}</b></div>
            {activeEngine === 'B' && (() => {
              const active: string[] = [];
              if (appliedFiltersB.rule1.active) active.push(`①充銷比高: 比值≥${appliedFiltersB.rule1.ratioHigh}, 銷量∈[${appliedFiltersB.rule1.salesMin}, ${appliedFiltersB.rule1.salesMax}]`);
              if (appliedFiltersB.rule2.active) active.push(`②充銷比低: 比值≤${appliedFiltersB.rule2.ratioLow}, 充值∈[${appliedFiltersB.rule2.depositMin}, ${appliedFiltersB.rule2.depositMax}]`);
              if (appliedFiltersB.rule3.active) active.push(`③高返點: 返點≥${appliedFiltersB.rule3.treatmentMin}`);
              if (appliedFiltersB.rule4.active) active.push(`④大額盈利: 盈虧≥${appliedFiltersB.rule4.profitMin}`);
              if (appliedFiltersB.rule5.active) active.push(`⑤無充值銷量高: 銷量≥${appliedFiltersB.rule5.salesMin}`);
              return active.length > 0 ? (
                <div className="mt-1 text-xs text-gray-700">
                  <span className="font-bold">🔧 本次查詢套用規則：</span>
                  <ul className="list-disc ml-5 mt-1">
                    {active.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              ) : null;
            })()}
            {rawCount > 0 && filteredData.length === 0 && (
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
            目前排序：<b>{ ({totalSales:'銷量', deposit:'充值', ratio:'充值銷量比', treatment:'返點', profit:'盈虧'} as any)[sortBy.col] }</b> {sortBy.dir === 'desc' ? '↓ 高→低' : '↑ 低→高'}
            <button onClick={() => setSortBy(null)} className="ml-2 text-blue-500 hover:text-red-500 underline">清除排序</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow border border-gray-200">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b sticky top-0 z-20 shadow-sm">
              <tr>
                <th className="p-4 font-bold text-gray-600">核查</th>
                <th className="p-4 font-bold text-gray-600">平台</th>
                <th className="p-4 font-bold text-gray-600">用戶名</th>
                {activeEngine === 'A' && <th className="p-4 font-bold text-gray-600">彩種</th>}
                <th className="p-4 font-bold text-gray-600">原因</th>
                {activeEngine === 'A' ? (
                  <><th className="p-4 font-bold text-gray-600">總銷量</th><th className="p-4 font-bold text-gray-600">單數</th><th className="p-4 font-bold text-gray-600">盈虧</th><th className="p-4 font-bold text-gray-600">RTP</th></>
                ) : (
                  <>
                    {([
                      { col: 'totalSales', label: '銷量' },
                      { col: 'deposit', label: '充值' },
                      { col: 'ratio', label: '充值銷量比' },
                      { col: 'treatment', label: '返點' },
                      { col: 'profit', label: '盈虧' },
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
                    <td className="p-4 font-medium">{item.platform}</td>
                    <td className="p-4 text-blue-600 font-bold">{item.username}</td>
                    {activeEngine === 'A' && <td className="p-4">{item.lottery}</td>}
                    <td className="p-4">
                      {activeEngine === 'B' && item.matchedReasons?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.matchedReasons.map((r: string, i: number) => (
                            <span key={i} className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold whitespace-nowrap">{r}</span>
                          ))}
                        </div>
                      ) : (
                        item.reason && <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold">{item.reason}</span>
                      )}
                    </td>
                    {activeEngine === 'A' ? (
                      <><td className="p-4">{item.totalSales}</td><td className="p-4">{item.orderCount}</td>
                        <td className={`p-4 font-bold ${item.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.pnl}</td>
                        <td className="p-4">{item.rtp}</td></>
                    ) : (
                      <><td className="p-4">{item.totalSales}</td><td className="p-4">{item.deposit}</td>
                        <td className="p-4">{item.ratio}</td><td className="p-4">{item.treatment}</td>
                        <td className={`p-4 font-bold ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.profit}</td></>
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
