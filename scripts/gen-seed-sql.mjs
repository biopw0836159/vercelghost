// 讀帳號清單檔（一行一個帳號），產生批次 INSERT SQL。
// 用法：node scripts/gen-seed-sql.mjs [輸入檔] [輸出檔]
//   預設：_accounts.txt → seed_accounts.sql
// 全部預設密碼 a123456（共用 hash）、must_change=true、on conflict do nothing。
import { readFileSync, writeFileSync } from 'node:fs';

const HASH = '$2a$10$9L4wfQk8meD1RqaRf8W/7.ULtHcajoZqtUjy4jsGvMblLhoRRP7H.'; // = a123456
const inFile = process.argv[2] || '_accounts.txt';
const outFile = process.argv[3] || 'seed_accounts.sql';

let names = readFileSync(new URL('./' + inFile, import.meta.url), 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);

const seen = new Set();
const dups = [];
names = names.filter(n => { if (seen.has(n)) { dups.push(n); return false; } seen.add(n); return true; });

const rows = names.map(n => `  ('${n.replace(/'/g, "''")}', '${HASH}', true)`).join(',\n');
const sql = `insert into admin_users (username, password_hash, must_change) values\n${rows}\non conflict (username) do nothing;\n`;

writeFileSync(new URL('./' + outFile, import.meta.url), sql);
console.log('帳號數(去重後):', names.length);
if (dups.length) console.log('清單內重複已自動去除:', dups.join(', '));
console.log('已寫到 scripts/' + outFile);
