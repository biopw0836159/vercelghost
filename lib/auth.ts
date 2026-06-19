// JWT 簽發 / 驗證 helper（HS256 + JWT_SECRET）
// 精簡自 777 lib/api-auth.js —— 拿掉 api-key、pending-token、2FA 相關邏輯。
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const JWT_ALG = 'HS256' as const;
const JWT_EXPIRES_IN = '7d';

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 未設置');
  return s;
}

export type TokenPayload = {
  username: string;
  must_change?: boolean;
};

// 簽發 JWT（login 用）
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { algorithm: JWT_ALG, expiresIn: JWT_EXPIRES_IN });
}

// 驗證 JWT，回 { ok, payload?, error? }
export function verifyJwt(token: string | null | undefined):
  | { ok: true; payload: TokenPayload & { exp?: number } }
  | { ok: false; error: string } {
  if (!token) return { ok: false, error: 'no token' };
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALG] }) as TokenPayload & { exp?: number };
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: 'invalid token: ' + (e as Error).message };
  }
}

// 從 request 解析 Bearer token
export function bearerToken(req: Request): string | null {
  const a = req.headers.get('authorization');
  if (!a || !a.startsWith('Bearer ')) return null;
  const t = a.slice(7).trim();
  return t || null;
}

// 錯誤訊息脫敏 —— 完整錯誤打 server log，前端只看 generic message + reqId
export function safeError(status: number, internalErr: unknown, publicMsg: string) {
  const reqId = crypto.randomBytes(6).toString('hex');
  const err = internalErr as { message?: string; stack?: string };
  console.error(`[err:${reqId}]`, err?.message || internalErr, err?.stack || '');
  return NextResponse.json({ code: status, message: publicMsg, reqId }, { status });
}
