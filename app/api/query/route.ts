import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const engine = searchParams.get('engine'); // 'A' 或 'B'
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供開始與結束日期' }, { status: 400 });
  }

  // 根據引擎選擇對應的 API URL
  const TARGET_URL = engine === 'A' 
    ? process.env.API_URL_ENGINE_A 
    : process.env.API_URL_ENGINE_B;
    
  const API_KEY = process.env.TARGET_API_KEY;

  if (!TARGET_URL || !API_KEY) {
    return NextResponse.json({ error: '伺服器 API 配置缺失' }, { status: 500 });
  }

  // 組合目標 URL 與時間參數
  const targetWithParams = new URL(TARGET_URL);
  targetWithParams.searchParams.append('dateStart', dateStart);
  targetWithParams.searchParams.append('dateEnd', dateEnd);

  try {
    const response = await fetch(targetWithParams.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY.replace(/[<>]/g, '')}`, 
        'Accept': 'application/json',
        'Cache-Control': 'no-store', 
      },
    });

    if (!response.ok) throw new Error(`API 請求失敗: ${response.status}`);
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}