// 帳密登入（與 IP 白名單並存的第二道）
//
// 刻意不引入任何相依套件 —— 密碼雜湊與 session 簽章都用 Node 內建 crypto：
//   · 密碼：scrypt（記憶體困難，比單純 SHA 抗暴力破解）+ 每個帳號各自的 salt
//   · session：HMAC-SHA256 簽名的 cookie，伺服器端驗證，前端改不動
//
// 帳密存環境變數，不進資料庫也不寫死在程式碼：
//   AUTH_USERS=帳號:salt(hex):hash(hex),帳號2:salt:hash
//   AUTH_SECRET=<隨機長字串>        簽 session 用，換掉等於讓所有人重新登入
// 產生設定值用 scripts/gen-user.mjs。
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

const SCRYPT_KEYLEN = 32;
// 有效期 12 小時：夠一個班次用完，隔天要重新登入
export const SESSION_MAX_AGE_SEC = 12 * 60 * 60;
export const SESSION_COOKIE = 'zg_session';

function parseUsers(): Map<string, { salt: string; hash: string }> {
  const raw = process.env.AUTH_USERS || '';
  const m = new Map<string, { salt: string; hash: string }>();
  for (const entry of raw.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length !== 3) continue;
    const [username, salt, hash] = parts.map(s => s.trim());
    if (username && salt && hash) m.set(username, { salt, hash });
  }
  return m;
}

/** 有沒有設定任何帳號 —— 沒設的話登入功能等於關閉 */
export function authConfigured(): boolean {
  return parseUsers().size > 0 && !!process.env.AUTH_SECRET;
}

export function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN).toString('hex');
}

/** 驗證帳密。一律走定時比較，避免用回應時間猜密碼 */
export function verifyUser(username: string, password: string): boolean {
  const users = parseUsers();
  const rec = users.get(username);
  // 查無此帳號時仍做一次雜湊，讓「帳號不存在」與「密碼錯誤」的耗時接近
  const salt = rec?.salt ?? randomBytes(16).toString('hex');
  const expected = rec?.hash ?? randomBytes(SCRYPT_KEYLEN).toString('hex');
  const actual = hashPassword(password, salt);
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  const equal = timingSafeEqual(a, b);
  return !!rec && equal;
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** 產生 session cookie 值：帳號.到期時間.簽章 */
export function createSession(username: string): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const payload = `${Buffer.from(username).toString('base64url')}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** 驗證 session cookie，回帳號；無效或過期回 null */
export function verifySession(value: string | undefined | null): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userB64, expStr, sig] = parts;
  const payload = `${userB64}.${expStr}`;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return null;

  try {
    return Buffer.from(userB64, 'base64url').toString('utf8') || null;
  } catch {
    return null;
  }
}
