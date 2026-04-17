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

// FilterInput 放在元件外部，避免每次 render 被重新建立（修正輸入框失焦問題）
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

export default function AuditDashboard() {
  const [activeEngine, setActiveEngine] = useState<'A' | 'B'>('A');
  const [dateStart, setDateStart] = useState('2026-04-01');
  const [dateEnd, setDateEnd] = useState('2026-04-08');
  const [platform, setPlatform] = useState('ALL'); // 新增：平台代碼（必填，預設 ALL）

  const [rawData, setRawData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // 引擎 A 條件
  const [filtersA, setFiltersA] = useState({
    minSales: { active: true, value: 0.00 },
    maxSales: { active: true, value: 2000.00 },
    maxOrders: { active: true, value: 12 },
    minPnl: { active: true, value: 100000.00 },
    maxPnl: { active: true, value: 1000000.00 },
    minRtp: { active: true, value: 0.995 },
    maxRtp: { active: true, value: 1.000 },
  });

  // 引擎 B 條件
  const [filtersB, setFiltersB] = useState({
    ratioLow: { active: true, value: 2.00 },
    ratioHigh: { active: true, value: 50.00 },
    salesMin: { active: true, value: 30000 },
    salesMax: { active: true, value: 99999999 },
    depositMin: { active: true, value: 1000 },
    depositMax: { active: true, value: 2000 },
    treatment: { active: true, value: 50000 },
    betAmount: { active: true, value: 200000 },
    profit: { active: true, value: 100000 },
  });

  // 執行查詢與資料清洗
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    setRawData([]);
    try {
      const res = await fetch(
        `/api/query?engine=${activeEngine}` +
        `&dateStart=${encodeURIComponent(dateStart)}` +
        `&dateEnd=${encodeURIComponent(dateEnd)}` +
        `&platform=${encodeURIComponent(platform || 'ALL')}`
      );
      const json = await res.json();

      if (!res.ok || json.error) {
        throw new Error(json.error || `伺服器連線異常 (${res.status})`);
      }

      // 安全提取陣列
      let rawArray = [];
      if (Array.isArray(json)) rawArray = json;
      else if (json && Array.isArray(json.data)) rawArray = json.data;
      else if (json && Array.isArray(json.list)) rawArray = json.list;
      else throw new Error('API 查詢成功，但回傳的不是有效的資料陣列');

      // 執行嚴謹正規化
      const cleanData = rawArray.map((item: any) => normalizeData(item, activeEngine));
      setRawData(cleanData);
    } catch (error: any) {
      console.error('查詢失敗:', error);
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  // 嚴謹過濾邏輯 (基於已清洗的乾淨資料)
  const filteredData = useMemo(() => {
    if (!Array.isArray(rawData)) return [];

    return rawData.filter(item => {
      try {
        if (activeEngine === 'A') {
          if (filtersA.minSales.active && item.totalSales < filtersA.minSales.value) return false;
          if (filtersA.maxSales.active && item.totalSales > filtersA.maxSales.value) return false;
          if (filtersA.maxOrders.active && item.orderCount > filtersA.maxOrders.value) return false;
          if (filtersA.minPnl.active && item.pnl < filtersA.minPnl.value) return false;
          if (filtersA.maxPnl.active && item.pnl > filtersA.maxPnl.value) return false;
          if (filtersA.minRtp.active && item.rtp < filtersA.minRtp.value) return false;
          if (filtersA.maxRtp.active && item.rtp > filtersA.maxRtp.value) return false;
          return true;
        } else {
          if (filtersB.ratioLow.active && item.ratio < filtersB.ratioLow.value) return false;
          if (filtersB.ratioHigh.active && item.ratio > filtersB.ratioHigh.value) return false;
          if (filtersB.salesMin.active && item.totalSales < filtersB.salesMin.value) return false;
          if (filtersB.salesMax.active && item.totalSales > filtersB.salesMax.value) return false;
          if (filtersB.depositMin.active && item.deposit < filtersB.depositMin.value) return false;
          if (filtersB.depositMax.active && item.deposit > filtersB.depositMax.value) return false;
          if (filtersB.treatment.active && item.treatment < filtersB.treatment.value) return false;
          if (filtersB.betAmount.active && item.betAmount < filtersB.betAmount.value) return false;
          if (filtersB.profit.active && item.profit < filtersB.profit.value) return false;
          return true;
        }
      } catch {
        return false; // 過濾發生例外時，安全剃除該筆資料
      }
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
          <div className="space-y-2">
            <FilterInput label="充銷比(低)設定值" filterObj={filtersB.ratioLow} stateUpdater={setFiltersB} stateKey="ratioLow" />
            <FilterInput label="充銷比(高)設定值" filterObj={filtersB.ratioHigh} stateUpdater={setFiltersB} stateKey="ratioHigh" />
            <FilterInput label="銷量(小)" filterObj={filtersB.salesMin} stateUpdater={setFiltersB} stateKey="salesMin" />
            <FilterInput label="銷量(大)" filterObj={filtersB.salesMax} stateUpdater={setFiltersB} stateKey="salesMax" />
            <FilterInput label="充值(小)" filterObj={filtersB.depositMin} stateUpdater={setFiltersB} stateKey="depositMin" />
            <FilterInput label="充值(大)" filterObj={filtersB.depositMax} stateUpdater={setFiltersB} stateKey="depositMax" />
            <FilterInput label="待遇設定值" filterObj={filtersB.treatment} stateUpdater={setFiltersB} stateKey="treatment" />
            <FilterInput label="下注額設定" filterObj={filtersB.betAmount} stateUpdater={setFiltersB} stateKey="betAmount" />
            <FilterInput label="盈利設定" filterObj={filtersB.profit} stateUpdater={setFiltersB} stateKey="profit" />
          </div>
        )}
      </div>

      {/* 右側表格區 */}
      <div className="flex-1 p-8 overflow-y-auto bg-gray-50 relative">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-8 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '用戶彩票分析' : '盈虧排行'}
        </div>

        {/* 嚴謹錯誤訊息提示區 */}
        {errorMsg && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow" role="alert">
            <p className="font-bold">查詢發生錯誤</p>
            <p>{errorMsg}</p>
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
                    <th className="p-4 font-bold text-gray-600">待遇</th>
                    <th className="p-4 font-bold text-gray-600">盈虧</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-gray-500">尚無符合條件的數據，或請點擊執行查詢</td></tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-blue-50 transition-colors">
                    <td className="p-4">
                      <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={checkedItems.has(item.id)} onChange={() => toggleCheck(item.id)} />
                    </td>
                    <td className="p-4 font-medium">{item.platform}</td>
                    <td className="p-4 text-blue-600 font-bold">{item.username}</td>
                    <td className="p-4">{item.lottery}</td>
                    <td className="p-4">
                      {item.reason && <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold">{item.reason}</span>}
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
