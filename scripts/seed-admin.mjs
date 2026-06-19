// 種一個管理員帳號到 Supabase admin_users（首登強制改密）
//
// 用法：
//   node scripts/seed-admin.mjs <username> <預設密碼>
//
// 需要環境變數（放 .env.local 或先 export）：
//   SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
//
// 已存在同名帳號 → 報錯不覆蓋（要重設密碼請走 app 內改密，或自行在 Supabase 改）。
import { createClient } from '@supabase/supabase-js';
import bcryptjs from 'bcryptjs';
import { readFileSync } from 'node:fs';

// 簡易載入 .env.local（不依賴 dotenv）
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // 沒有 .env.local 就靠外部 env
}

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('用法：node scripts/seed-admin.mjs <username> <預設密碼>');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('缺 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（放 .env.local 或先 export）');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: existing } = await supabase
  .from('admin_users').select('username').eq('username', username).maybeSingle();
if (existing) {
  console.error(`帳號 "${username}" 已存在，未做變更。`);
  process.exit(1);
}

const password_hash = await bcryptjs.hash(password, 10);
const { error } = await supabase
  .from('admin_users')
  .insert({ username, password_hash, must_change: true });

if (error) {
  console.error('寫入失敗：', error.message);
  process.exit(1);
}

console.log(`✅ 已建立帳號 "${username}"（首登須改密）`);
