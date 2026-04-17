'use client';
import { useState, useMemo } from 'react';

// 【嚴謹模式】資料正規化攔截器：無論 API 回傳什麼格式的命名，全數清洗為標準格式
const normalizeData = (item: any, engine: 'A' | 'B') => {
  return {
    // 共用欄位 (涵蓋常見的各種 API 命名習慣)
    id: item.account || item.username || item.member_id || item.id || Math.random().toString(),
    platform: item.platform || item.site || item.merchant || '-',
    username: item.account || item.username || item.user_name || '-',
    lottery: item.lotteryType || item.lottery || item.lottery_name || '-',
    // 安全處理 Reason：避免 API 回傳陣列或物件導致 React 崩潰
    reason: Array.isArray(item.reason) ? item.reason.join(', ') :
            (typeof item.reason === 'string' ? item.reason :
             (item.abnormal_reason || item.remark || '')),

    // 引擎 A 數值 (強制轉型為數字，防禦 NaN 崩潰)
    totalSales: Number(item.totalSales || item.total_sales || item.sales || item.bet_amount || 0),
    orderCount: Number(item.orderCount || item.order_count || item.orders || item.bet_count || 0),
    pnl: Number(item.pnl || item.profit || item.net_profit || item.profit_loss || 0),
    rtp: Number(item.rtp || item.return_to_player || 0),

    // 引擎 B 數值
    ratio: Number(item.ratio || item.deposit_sales_ratio || item.充销比 || 0),
    deposit: Number(item.deposit || item.deposit_amount || item.recharge || 0),
    treatment: Number(item.treatment || item.bonus || item.activity || 0),
    betAmount: Number(item.betAmount || item.bet_amount || item.sales || 0),
    profit: Number(item.profit || item.pnl || item.net_profit || 0)
  };
};

// 單值輸入組件（引擎 A 使用，保持原樣）
const FilterInput = ({ label, filterObj, stateUpdater, stateKey }: any) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-1">
      <input
        type="checkbox"
        checked={filterObj.active}
        onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [stateKey]: { ...prev[stateKey], active: e.target.checked } }))}
        className="w-4 h-4 cursor-pointer"
      />
      <label className="text-sm font-medium text-gray-700">{label}</label>
    </div>
    <input
      type="number"
      disabled={!filterObj.active}
      value={filterObj.value}
      onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [stateKey]: { ...prev[stateKey], value: Number(e.target.value) } }))}
      className="w-full p-2 border rounded bg-gray-800 text-white disabled:opacity-50"
    />
  </div>
);

// 【新增】規則卡片組件（引擎 B 使用，支援單/雙條件欄位）
const RuleCard = ({ rule, ruleKey, title, desc, fields, stateUpdater }: any) => (
  <div className={`mb-3 p-3 rounded border transition-colors ${rule.active ? 'bg-white border-blue-400 shadow-sm' : 'bg-gray-100 border-gray-200'}`}>
    <div className="flex items-center gap-2 mb-1">
      <input
        type="checkbox"
        checked={rule.active}
        onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [ruleKey]: { ...prev[ruleKey], active: e.target.checked } }))}
        className="w-4 h-4 cursor-pointer"
      />
      <label className="text-sm font-bold text-gray-800">{title}</label>
    </div>
    {desc && <div className="text-xs text-gray-500 mb-2 pl-6">{desc}</div>}
    <div className="space-y-2 pl-6">
      {fields.map((f: any) => (
        <div key={f.field}>
          <label className="text-xs text-gray-600 block mb-0.5">{f.label}</label>
          <input
            type="number"
            disabled={!rule.active}
            value={rule[f.field]}
            onChange={(e) => stateUpdater((prev: any) => ({
              ...prev,
              [ruleKey]: { ...prev[ruleKey], [f.field]: Number(e.target.value) }
            }))}
            className="w-full p-1.5 border rounded bg-gray-800 text-white disabled:opacity-40 text-sm"
          />
        </div>
      ))}
    </div>
  </div>
);

export default function AuditDashboard() {
  const [activeEngine, setActiveEngine] = useState<'A' | 'B'>('A');
  const [dateStart, setDateStart] = useState('2026-04-01');
  const [dateEnd, setDateEnd] = useState('2026-04-08');
  const [platform, setPlatform] = useState('ALL');

  const [rawData, setRawData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [hasQueried, setHasQueried] = useState(false);

  // 引擎 A 條件（維持原樣）
  const [filtersA, setFiltersA] = useState({
    minSales: { active: true, value: 0.00 },
    maxSales: { active: true, value: 2000.00 },
    maxOrders: { active: true, value: 12 },
    minPnl: { active: true, value: 100000.00 },
    maxPnl: { active: true, value: 1000000.00 },
    minRtp: { active: true, value: 0.995 },
    maxRtp: { active: true, value: 1.000 },
  });

  // 【重構】引擎 B 條件 — 五條獨立規則
  const [filtersB, setFiltersB] = useState({
    // 規則 1：充銷比(高) + 銷量 — 雙重條件
    rule1: { active: false, ratioHigh: 50, salesMin: 30000 },
    // 規則 2：充銷比(低) + 銷量 — 雙重條件
    rule2: { active: false, ratioLow: 2, salesMin: 30000 },
    // 規則 3：返點
    rule3: { active: false, treatmentMin: 50000 },
    // 規則 4：充值金額
    rule4: { active: false, depositMin: 100000 },
    // 規則 5：盈虧
    rule5: { active: false, profitMin: 100000 },
  });

  // 執行查詢與資料清洗
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    setRawData([]);
    setHasQueried(true);
    try {
      const res = await fetch(
        `/api/query?engine=${activeEngine}` +
        `&dateStart=${encodeURIComponent(dateStart)}` +
        `&dateEnd=${encodeURIComponent(dateEnd)}` +
        `&platform=${encodeURIComponent(platform || 'ALL')}`
      );

      // 【關鍵防禦】先讀原始文字，檢查是否為 JSON，避免 "Unexpected token '<'" 崩潰
      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();

      if (!contentType.includes('application/json')) {
        // 回傳 HTML 或其他非 JSON 格式 — 通常是路由未部署/環境變數錯誤/伺服器崩潰
        const preview = rawText.substring(0, 200).replace(/\s+/g, ' ');
        throw new Error(
          `API 回應不是 JSON (HTTP ${res.status})。\n` +
          `Content-Type: ${contentType || '(空)'}\n` +
          `內容開頭: ${preview}\n\n` +
          `🔍 常見原因:\n` +
          `  • Vercel 環境變數未設定 (API_URL_ENGINE_A/B, TARGET_API_KEY)\n` +
          `  • API 路由未部署成功\n` +
          `  • Vercel Deployment Protection 被開啟\n` +
          `  • 後端 URL 格式錯誤（缺 https:// 或有多餘空白）\n\n` +
          `請到 Vercel Dashboard → Logs 查看 [query] 開頭的日誌。`
        );
      }

      let json;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(`API 回傳的 JSON 格式損毀。開頭: ${rawText.substring(0, 150)}`);
      }

      if (!res.ok || json.error) {
        throw new Error(json.error || `伺服器連線異常 (${res.status})`);
      }

      let rawArray = [];
      if (Array.isArray(json)) rawArray = json;
      else if (json && Array.isArray(json.data)) rawArray = json.data;
      else if (json && Array.isArray(json.list)) rawArray = json.list;
      else throw new Error('API 查詢成功，但回傳的不是有效的資料陣列');

      const cleanData = rawArray.map((item: any) => normalizeData(item, activeEngine));
      setRawData(cleanData);
    } catch (error: any) {
      console.error('查詢失敗:', error);
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  // 【重構】過濾邏輯：引擎 A 保持 AND；引擎 B 改為 OR + 標籤化
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

    // 引擎 B：為每筆資料標記命中的規則，再以 OR 邏輯過濾
    const anyRuleActive = Object.values(filtersB).some((r: any) => r.active);

    return rawData
      .map((item: any) => {
        const matched: string[] = [];
        try {
          // 規則 1：充銷比(高) + 銷量（雙重條件，兩個都要成立）
          if (filtersB.rule1.active &&
              item.ratio >= filtersB.rule1.ratioHigh &&
              item.totalSales >= filtersB.rule1.salesMin) {
            matched.push('充銷比高');
          }
          // 規則 2：充銷比(低) + 銷量（雙重條件）
          if (filtersB.rule2.active &&
              item.ratio <= filtersB.rule2.ratioLow &&
              item.totalSales >= filtersB.rule2.salesMin) {
            matched.push('充銷比低');
          }
          // 規則 3：返點
          if (filtersB.rule3.active && item.treatment >= filtersB.rule3.treatmentMin) {
            matched.push('高返點');
          }
          // 規則 4：充值金額
          if (filtersB.rule4.active && item.deposit >= filtersB.rule4.depositMin) {
            matched.push('大額充值');
          }
          // 規則 5：盈虧
          if (filtersB.rule5.active && item.profit >= filtersB.rule5.profitMin) {
            matched.push('大額盈利');
          }
        } catch {}
        return { ...item, matchedReasons: matched };
      })
      .filter((item: any) => {
        if (!anyRuleActive) return true;           // 未啟用任何規則 → 顯示全部
        return item.matchedReasons.length > 0;     // 已啟用規則 → 至少命中一條
      });
  }, [rawData, activeEngine, filtersA, filtersB]);

  const toggleCheck = (id: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) newChecked.delete(id);
    else newChecked.add(id);
    setCheckedItems(newChecked);
  };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900">
      {/* 左側面板 */}
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
           <label className="block text-sm font-medium mb-1">平台 (多個用逗號, 或 ALL)</label>
           <input
             type="text"
             value={platform}
             onChange={e => setPlatform(e.target.value)}
             placeholder="ALL"
             className="w-full border p-1 rounded mb-2 text-black"
           />
           <label className="block text-sm font-medium mb-1">Date Start</label>
           <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="w-full border p-1 rounded mb-2 text-black"/>
           <label className="block text-sm font-medium mb-1">Date End</label>
           <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="w-full border p-1 rounded text-black"/>
           <button onClick={fetchData} disabled={loading} className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
             {loading ? '資料擷取中...' : '執行查詢'}
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
            <div className="text-xs text-gray-500 mb-2 px-1">
              勾選要啟用的規則，規則之間為「或」關係 —— 會員命中任一規則即顯示
            </div>
            <RuleCard
              rule={filtersB.rule1}
              ruleKey="rule1"
              title="① 充銷比(高) + 銷量"
              desc="比值 ≥ 閾值 且 銷量 ≥ 閾值（雙重條件）"
              fields={[
                { field: 'ratioHigh', label: '充銷比(高) ≥' },
                { field: 'salesMin', label: '銷量 ≥' },
              ]}
              stateUpdater={setFiltersB}
            />
            <RuleCard
              rule={filtersB.rule2}
              ruleKey="rule2"
              title="② 充銷比(低) + 銷量"
              desc="比值 ≤ 閾值 且 銷量 ≥ 閾值（雙重條件）"
              fields={[
                { field: 'ratioLow', label: '充銷比(低) ≤' },
                { field: 'salesMin', label: '銷量 ≥' },
              ]}
              stateUpdater={setFiltersB}
            />
            <RuleCard
              rule={filtersB.rule3}
              ruleKey="rule3"
              title="③ 返點"
              desc="返點+工資 ≥ 閾值"
              fields={[
                { field: 'treatmentMin', label: '返點 ≥' },
              ]}
              stateUpdater={setFiltersB}
            />
            <RuleCard
              rule={filtersB.rule4}
              ruleKey="rule4"
              title="④ 充值金額"
              desc="充值 ≥ 閾值"
              fields={[
                { field: 'depositMin', label: '充值 ≥' },
              ]}
              stateUpdater={setFiltersB}
            />
            <RuleCard
              rule={filtersB.rule5}
              ruleKey="rule5"
              title="⑤ 盈虧"
              desc="盈利 ≥ 閾值"
              fields={[
                { field: 'profitMin', label: '盈虧 ≥' },
              ]}
              stateUpdater={setFiltersB}
            />
          </div>
        )}
      </div>

      {/* 右側表格區 */}
      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-6 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '用戶彩票分析' : '盈虧排行'}
        </div>

        {/* 診斷計數器：清楚顯示 API 回傳幾筆、過濾後剩幾筆 */}
        {hasQueried && !loading && (
          <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm font-mono">
            <div>🔸 API 回傳原始筆數：<b>{rawData.length}</b></div>
            <div>🔸 通過過濾條件筆數：<b>{filteredData.length}</b></div>
            {rawData.length > 0 && filteredData.length === 0 && (
              <div className="text-red-600 font-bold mt-2">
                ⚠️ API 有資料，但被過濾條件全部剃除！請放寬左側規則條件。
              </div>
            )}
            {rawData.length === 0 && !errorMsg && (
              <div className="text-orange-600 font-bold mt-2">
                ⚠️ API 回傳空陣列（日期/平台可能無資料，或後端結構不符）
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

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="p-4 font-bold text-gray-600">核查</th>
                <th className="p-4 font-bold text-gray-600">平台</th>
                <th className="p-4 font-bold text-gray-600">用戶名</th>
                <th className="p-4 font-bold text-gray-600">彩種</th>
                <th className="p-4 font-bold text-gray-600">原因</th>
                {activeEngine === 'A' ? (
                  <>
                    <th className="p-4 font-bold text-gray-600">總銷量</th>
                    <th className="p-4 font-bold text-gray-600">單數</th>
                    <th className="p-4 font-bold text-gray-600">盈虧</th>
                    <th className="p-4 font-bold text-gray-600">RTP</th>
                  </>
                ) : (
                  <>
                    <th className="p-4 font-bold text-gray-600">銷量</th>
                    <th className="p-4 font-bold text-gray-600">充值</th>
                    <th className="p-4 font-bold text-gray-600">比值</th>
                    <th className="p-4 font-bold text-gray-600">返點</th>
                    <th className="p-4 font-bold text-gray-600">盈虧</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-gray-500">
                  {hasQueried ? '尚無符合條件的數據' : '請點擊執行查詢'}
                </td></tr>
              ) : (
                filteredData.map((item: any) => (
                  <tr key={item.id} className="border-b hover:bg-blue-50 transition-colors">
                    <td className="p-4">
                      <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={checkedItems.has(item.id)} onChange={() => toggleCheck(item.id)} />
                    </td>
                    <td className="p-4 font-medium">{item.platform}</td>
                    <td className="p-4 text-blue-600 font-bold">{item.username}</td>
                    <td className="p-4">{item.lottery}</td>
                    <td className="p-4">
                      {/* 引擎 B：顯示命中的所有規則標籤；引擎 A：顯示 API 回傳的原始 reason */}
                      {activeEngine === 'B' && item.matchedReasons && item.matchedReasons.length > 0 ? (
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
                      <>
                        <td className="p-4">{item.totalSales}</td>
                        <td className="p-4">{item.orderCount}</td>
                        <td className={`p-4 font-bold ${item.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.pnl}</td>
                        <td className="p-4">{item.rtp}</td>
                      </>
                    ) : (
                      <>
                        <td className="p-4">{item.totalSales}</td>
                        <td className="p-4">{item.deposit}</td>
                        <td className="p-4">{item.ratio}</td>
                        <td className="p-4">{item.treatment}</td>
                        <td className={`p-4 font-bold ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{item.profit}</td>
                      </>
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
