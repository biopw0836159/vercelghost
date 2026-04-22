import { NextResponse } from 'next/server';

const ALL_PLATFORMS = ["XH", "LS", "OL", "XY", "SH", "YS", "JY", "HS", "FB", "SY", "LY", "MT", "JD", "ND", "YD"];

const ENGINE_URLS: Record<string, string> = {
  A: 'https://stats-crawler.up.railway.app/api/query-user-lottery-analysis',
  B: 'https://stats-crawler.up.railway.app/api/query-member-income',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const engine = searchParams.get('engine') || 'A';
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');
  const platform = searchParams.get('platform') || 'ALL';

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供開始與結束日期' }, { status: 400 });
  }

  const TARGET_URL = ENGINE_URLS[engine] || ENGINE_URLS['A'];
  const JWT_TOKEN = process.env.TARGET_JWT_TOKEN;

  if (!JWT_TOKEN) {
    return NextResponse.json({ error: '伺服器 JWT Token 未設定' }, { status: 500 });
  }

  const platforms = platform === 'ALL' ? ALL_PLATFORMS : [platform];

  const body = {
    account: '',
    byPlayType: false,
    dateStart,
    dateEnd,
    lottery: '',
    noAccountMode: false,
    platforms,
  };

  try {
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      throw new Error(`後端回應錯誤 HTTP ${response.status}，內容：${rawText.substring(0, 200)}`);
    }

    if (!contentType.includes('application/json')) {
      throw new Error(`後端回傳非 JSON (${response.status})，內容：${rawText.substring(0, 200)}`);
    }

    const data = JSON.parse(rawText);
    const rows = Array.isArray(data.rows) ? data.rows : (Array.isArray(data) ? data : []);
    return NextResponse.json(rows);

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
