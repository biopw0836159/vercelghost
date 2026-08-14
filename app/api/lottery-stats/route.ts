// GET /api/lottery-stats  —— A 引擎（彩种统计）同源代理
// 前端打这个（同源、免 CORS）→ 伺服器端带 x-api-key + PROXY 打后端 open API。
// Query：platform（逗号分隔或 ALL）、dateStart、dateEnd（yyyy-MM-dd）
//
// 为什么用 lottery-stats 而不是 lottery-analysis：见 docs/API-现状.md 第三节。
// 简单说 lottery-analysis 对 XO/XY/OL/XH/LS 五个平台回 0，金额与本端点差 4000 倍以上。
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

  const r = await fetchOpenApi('/api/open/lottery-stats', { platform, dateStart, dateEnd });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.rows);
}
