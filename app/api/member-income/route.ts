// GET /api/member-income  —— B 引擎（會員輸贏統計）同源代理
// 前端打這個（同源、免 CORS）→ 伺服器端帶 x-api-key + PROXY 打後端 open API。
// Query：platform（逗號分隔或 ALL）、dateStart、dateEnd（yyyy-MM-dd）
import { NextResponse } from 'next/server';
import { fetchOpenApi } from '@/lib/open-api';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') || 'ALL';
  const dateStart = searchParams.get('dateStart');
  const dateEnd = searchParams.get('dateEnd');

  if (!dateStart || !dateEnd) {
    return NextResponse.json({ error: '必須提供 dateStart 與 dateEnd' }, { status: 400 });
  }

  const r = await fetchOpenApi('/api/open/member-income', { platform, dateStart, dateEnd });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.rows);
}
