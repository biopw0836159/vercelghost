'use client';
import { useState, useMemo } from 'react';

export default function AuditDashboard() {
  const [activeEngine, setActiveEngine] = useState<'A' | 'B'>('A');
  const [dateStart, setDateStart] = useState('2026-04-01');
  const [dateEnd, setDateEnd] = useState('2026-04-08');
  
  const [rawData, setRawData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

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

  const fetchData = async () => {
    setLoading(true);
    setRawData([]);
    try {
      const res = await fetch(`/api/query?engine=${activeEngine}&dateStart=${dateStart}&dateEnd=${dateEnd}`);
      const json = await res.json();
      setRawData(json.data || json || []); 
    } catch (error) {
      alert('查詢失敗，請檢查網路或 API 狀態');
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    return rawData.filter(item => {
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
        if (filtersB.salesMin.active && item.sales < filtersB.salesMin.value) return false;
        if (filtersB.salesMax.active && item.sales > filtersB.salesMax.value) return false;
        if (filtersB.depositMin.active && item.deposit < filtersB.depositMin.value) return false;
        if (filtersB.depositMax.active && item.deposit > filtersB.depositMax.value) return false;
        if (filtersB.treatment.active && item.treatment < filtersB.treatment.value) return false;
        if (filtersB.betAmount.active && item.betAmount < filtersB.betAmount.value) return false;
        if (filtersB.profit.active && item.profit < filtersB.profit.value) return false;
        return true;
      }
    });
  }, [rawData, activeEngine, filtersA, filtersB]);

  const toggleCheck = (id: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) newChecked.delete(id);
    else newChecked.add(id);
    setCheckedItems(newChecked);
  };

  const FilterInput = ({ label, filterObj, stateUpdater, stateKey }: any) => (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <input 
          type="checkbox" 
          checked={filterObj.active} 
          onChange={(e) => stateUpdater((prev: any) => ({ ...prev, [stateKey]: { ...prev[stateKey], active: e.target.checked } }))}
          className="w-4 h-4"
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
           <label className="block text-sm font-medium mb-1">Date Start</label>
           <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="w-full border p-1 rounded mb-2 text-black"/>
           <label className="block text-sm font-medium mb-1">Date End</label>
           <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="w-full border p-1 rounded text-black"/>
           <button onClick={fetchData} disabled={loading} className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
             {loading ? '抓取資料中...' : '執行查詢'}
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

      <div className="flex-1 p-8 overflow-y-auto bg-gray-50">
        <div className="bg-slate-800 text-white rounded-lg p-6 mb-8 text-center text-3xl font-bold shadow-lg">
          📊 {activeEngine === 'A' ? '用戶彩票分析' : '盈虧排行'}
        </div>
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
                <tr><td colSpan={10} className="p-8 text-center text-gray-500">尚無符合條件的數據，或請點擊查詢</td></tr>
              ) : (
                filteredData.map((item, idx) => {
                  const id = item.account || item.username || String(idx); 
                  return (
                    <tr key={id} className="border-b hover:bg-blue-50 transition-colors">
                      <td className="p-4">
                        <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={checkedItems.has(id)} onChange={() => toggleCheck(id)} />
                      </td>
                      <td className="p-4 font-medium">{item.platform || '-'}</td>
                      <td className="p-4 text-blue-600 font-bold">{item.account || item.username || '-'}</td>
                      <td className="p-4">{item.lotteryType || item.lottery || '-'}</td>
                      <td className="p-4">
                        {item.reason && <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold">{item.reason}</span>}
                      </td>
                      {activeEngine === 'A' ? (
                        <>
                          <td className="p-4">{item.totalSales}</td>
                          <td className="p-4">{item.orderCount}</td>
                          <td className="p-4 font-bold text-green-600">{item.pnl}</td>
                          <td className="p-4">{item.rtp}</td>
                        </>
                      ) : (
                        <>
                          <td className="p-4">{item.sales}</td>
                          <td className="p-4">{item.deposit}</td>
                          <td className="p-4">{item.ratio}</td>
                          <td className="p-4">{item.treatment}</td>
                          <td className="p-4 font-bold text-green-600">{item.profit || item.pnl}</td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}