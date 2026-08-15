// 產生 AUTH_USERS 環境變數用的帳密設定值（密碼不會被存下來，只存 scrypt 雜湊）
//
// 用法：
//   node scripts/gen-user.mjs <帳號> <密碼>
//   node scripts/gen-user.mjs --secret     只產生 AUTH_SECRET
//
// 產出的字串貼到 Railway 的環境變數：
//   AUTH_USERS=帳號:salt:hash        （多組用逗號分隔）
//   AUTH_SECRET=<隨機字串>            （換掉等於讓所有人重新登入）
import { scryptSync, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);

if (args[0] === '--secret') {
  console.log(`AUTH_SECRET=${randomBytes(32).toString('hex')}`);
  process.exit(0);
}

const [username, password] = args;
if (!username || !password) {
  console.error('用法：node scripts/gen-user.mjs <帳號> <密碼>');
  console.error('　　　node scripts/gen-user.mjs --secret');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex');

console.log(`${username}:${salt}:${hash}`);
console.error(`\n（上面這串貼進 AUTH_USERS。多個帳號用逗號串起來。密碼本身沒有被存下來。）`);
