import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const engine = searchParams.get('engine'); // 'A' 或 'B'
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');
  const platform = searchParams.get('platform') || 'ALL'; // 必填，預設 ALL

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

  // 組合目標 URL 與參數（platform / dateStart / dateEnd 皆為必填）
  const targetWithParams = new URL(TARGET_URL);
  targetWithParams.searchParams.append('platform', platform);
  targetWithParams.searchParams.append('dateStart', dateStart);
  targetWithParams.searchParams.append('dateEnd', dateEnd);

  // 方便在 Vercel Function Logs 排查
  console.log('[query] engine:', engine);
  console.log('[query] target URL:', targetWithParams.toString());

  try {
    const response = await fetch(targetWithParams.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY.replace(/[<>]/g, '')}`,
        'Accept': 'application/json',
        'Cache-Control': 'no-store',
      },
    });

    // 【嚴謹模式除錯核心】：不直接轉 JSON，強制先讀取原始文字
    const rawText = await response.text();

    console.log('[query] status:', response.status);
    console.log('[query] body length:', rawText.length);

    if (!response.ok) {
      throw new Error(`Railway 回報錯誤 (HTTP ${response.status})。內容: ${rawText.substring(0, 100)}`);
    }

    // 空 body 視為「零筆資料」而不是錯誤
    if (!rawText || rawText.trim() === '') {
      return NextResponse.json([]);
    }

    try {
      const data = JSON.parse(rawText);
      return NextResponse.json(data);
    } catch {
      throw new Error(`Railway (引擎 ${engine}) 回傳的不是有效 JSON。內容開頭為: ${rawText.substring(0, 80)}...`);
    }

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
