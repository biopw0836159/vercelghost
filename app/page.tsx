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

const normalizeData = (item: any, engine: 'A' | 'B') => {
  const deposit = Number(item['充值'] || item.deposit || item.deposit_amount || item.recharge || 0);
  const totalSales = Number(item['投注'] || item.totalSales || item.total_sales || item.sales || item.bet_amount || 0);
  const directRatio = Number(item['充销比'] || item['充銷比'] || item.deposit_sales_ratio || item.ratio || 0);
  const ratio = directRatio > 0 ? directRatio : (deposit > 0 ? Number((totalSales / deposit).toFixed(2)) : 0);

  return {
    id: item.account || item.username || item['用户名'] || item.member_id || item.id || Math.random().toString(),
    platform: item['平台'] || item.platform || item.site || item.merchant || '-',
    username: item['用户名'] || item.account || item.username || item.user_name || '-',
    lottery: item['彩种'] || item.lotteryType || item.lottery || item.lottery_name || '-',
    reason: Array.isArray(item.reason) ? item.reason.join(', ') :
            (typeof item.reason === 'string' ? item.reason :
             (item.abnormal_reason || item.remark || '')),
    totalSales,
    orderCount: Number(item.orderCount || item.order_count || item.orders || item.bet_count || 0),
    pnl: Number(item['盈亏'] || item.pnl || item.profit || item.net_profit || item.profit_loss || 0),
    rtp: Number(item.rtp || item.return_to_player || 0),
    deposit,
    ratio,
    treatment: Number(item['总返点'] || item['總返點'] || item.rebate || item.total_rebate || item.treatment || 0),
    betAmount: Number(item['投注'] || item.betAmount || item.bet_amount || item.sales || 0),
    profit: Number(item['盈亏'] || item.profit || item.pnl || item.net_profit || 0),
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
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [hasQueried, setHasQueried] = useState(false);

  const [filtersA, setFiltersA] = useState({
    minSales: { active: true, value: 0.00 },
    maxSales: { active: true, value: 2000.00 },
    maxOrders: { active: true, value: 12 },
    minPnl: { active: true, value: 100000.00 },
    maxPnl: { active: true, value: 1000000.00 },
    minRtp: { active: true, value: 0.995 },
    maxRtp: { active: true, value: 1.000 },
  });

  const [filtersB, setFiltersB] = useState({
    rule1: { active: false, ratioHigh: 50, salesMin: 30000 },
    rule2: { active: false, ratioLow: 2, salesMin: 30000 },
    rule3: { active: false, treatmentMin: 50000 },
    rule4: { active: false, depositMin: 100000 },
    rule5: { active: false, profitMin: 100000 },
  });

  const filteredData = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    if (activeEngine === 'A') {
      return rawData.filter(item => {
        try {
          if (filtersA.minSales.active && item.totalSales < filtersA.minSales.value) return false;
          if (filtersA.maxSales.active && item.totalSales > filtersA.maxSales.value) return false;
          if (filtersA.maxOrders.active && item.orderCount > filtersA.maxOrders.value) return false;
          if (filtersA.minPnl.active && item.pnl < filtersA.minPnl.value) return false;
          if (filtersA.maxPnl.active && item.pnl > filtersA.maxPnl.value) return false;
          if (filtersA.minRtp.active && item.rtp < filtersA.minRtp.value) return false;
          if (filtersA.maxRtp.active && item.rtp > filtersA.maxRtp.value) return false;
          return true;
        } catch { return false; }
      });
    }
    const anyRuleActive = Object.values(filtersB).some((r: any) => r.active);
    return rawData
      .map((item: any) => {
        const matched: string[] = [];
        try {
          if (filtersB.rule1.active && item.ratio >= filtersB.rule1.ratioHigh && item.totalSales >= filtersB.rule1.salesMin) matched.push('充銷比高');
          if (filtersB.rule2.active && item.ratio <= filtersB.rule2.ratioLow && item.totalSales >= filtersB.rule2.salesMin) matched.push('充銷比低');
          if (filtersB.rule3.active && item.treatment >= filtersB.rule3.treatmentMin) matched.push('高返點');
          if (filtersB.rule4.active && item.deposit >= filtersB.rule4.depositMin) matched.push('大額充值');
          if (filtersB.rule5.active && item.profit >= filtersB.rule5.profitMin) matched.push('大額盈利');
        } catch {}
        return { ...item, matchedReasons: matched };
      })
      .filter((item: any) => !anyRuleActive || item.matchedReasons.length > 0);
  }, [rawData, activeEngine, filtersA, filtersB]);

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
    setHasQueried(true);
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
      const cleanData = rawArray.map(item => normalizeData(item, activeEngine));
      setRawData(cleanData);

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
            <RuleCard rule={filtersB.rule1} ruleKey="rule1" title="① 充銷比(高) + 銷量" desc="充值銷量比 ≥ 閾值 且 銷量 ≥ 閾值"
              fields={[{ field: 'ratioHigh', label: '充銷比(高) ≥' }, { field: 'salesMin', label: '銷量 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule2} ruleKey="rule2" title="② 充銷比(低) + 銷量" desc="充值銷量比 ≤ 閾值 且 銷量 ≥ 閾值"
              fields={[{ field: 'ratioLow', label: '充銷比(低) ≤' }, { field: 'salesMin', label: '銷量 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule3} ruleKey="rule3" title="③ 返點" desc="返點 ≥ 閾值"
              fields={[{ field: 'treatmentMin', label: '返點 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule4} ruleKey="rule4" title="④ 充值金額" desc="充值 ≥ 閾值"
              fields={[{ field: 'depositMin', label: '充值 ≥' }]} stateUpdater={setFiltersB} />
            <RuleCard rule={filtersB.rule5} ruleKey="rule5" title="⑤ 盈虧" desc="盈利 ≥ 閾值"
              fields={[{ field: 'profitMin', label: '盈虧 ≥' }]} stateUpdater={setFiltersB} />
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-6 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '用戶彩票分析' : '盈虧排行'}
        </div>

        {hasQueried && !loading && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm font-mono">
            <div>🔸 API 回傳原始筆數：<b>{rawData.length}</b></div>
            <div>🔸 通過過濾條件筆數：<b>{filteredData.length}</b></div>
            {rawData.length > 0 && filteredData.length === 0 && (
              <div className="text-red-600 font-bold mt-2">⚠️ API 有資料，但被過濾條件全部剃除！請放寬左側規則條件。</div>
            )}
            {rawData.length === 0 && !errorMsg && (
              <div className="text-orange-600 font-bold mt-2">⚠️ API 回傳空陣列（日期/平台可能無資料，或後端結構不符）</div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow" role="alert">
            <p className="font-bold mb-2">查詢發生錯誤</p>
            <pre className="whitespace-pre-wrap text-sm font-mono">{errorMsg}</pre>
          </div>
        )}

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="p-4 font-bold text-gray-600">核查</th>
                <th className="p-4 font-bold text-gray-600">平台</th>
                <th className="p-4 font-bold text-gray-600">用戶名</th>
                {activeEngine === 'A' && <th className="p-4 font-bold text-gray-600">彩種</th>}
                <th className="p-4 font-bold text-gray-600">原因</th>
                {activeEngine === 'A' ? (
                  <><th className="p-4 font-bold text-gray-600">總銷量</th><th className="p-4 font-bold text-gray-600">單數</th><th className="p-4 font-bold text-gray-600">盈虧</th><th className="p-4 font-bold text-gray-600">RTP</th></>
                ) : (
                  <><th className="p-4 font-bold text-gray-600">銷量</th><th className="p-4 font-bold text-gray-600">充值</th><th className="p-4 font-bold text-gray-600">充值銷量比</th><th className="p-4 font-bold text-gray-600">返點</th><th className="p-4 font-bold text-gray-600">盈虧</th></>
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
