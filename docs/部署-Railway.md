# Railway 部署

原本这个专案是丢 Vercel 的（仓库名 `vercelghost` 就是这么来的），现在改用 Railway。

## 一、专案设定

Railway → New Project → Deploy from GitHub repo → 选 `biopw0836159/vercelghost`。

建置不用手动设定，[`railway.json`](../railway.json) 已经写好：

- builder：NIXPACKS（会自动认出 Next.js，跑 `npm ci` → `npm run build`）
- 启动指令：`npm run start`
- healthcheck：`/`（登入页，不需登入就会回 200）
- 失败自动重启，最多 10 次

Node 版本靠 `package.json` 的 `engines` 锁在 `>=20.9.0`（Next 16 的下限）。

**连接埠不用管**：`next start` 会自己读 Railway 注入的 `PORT` 环境变量，
预设也已经监听 `0.0.0.0`，不需要加 `-p` 参数。

## 二、环境变量（Railway → Variables）

以下全部都要设，少一个就会以不同方式坏掉：

| 变量 | 说明 | 少了会怎样 |
|---|---|---|
| `APIKEY` | open API 金钥，带在 `x-api-key` | 所有查询回「伺服器 APIKEY 未设定」 |
| `PROXY_HOST` | 授权代理位址 | 见下方「代理」 |
| `PROXY_PORT` | 代理连接埠 | 同上 |
| `PROXY_USER` | 代理帐号 | 同上 |
| `PROXY_PASS` | 代理密码 | 同上 |
| `SUPABASE_URL` | Supabase 专案网址 | 登入 500 |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key，不是 anon key | 登入 500 |
| `JWT_SECRET` | 自签 JWT 密钥（随机长字串） | 登入 500 |
| `STATS_BACKEND_URL` | 选填，不设预设 `https://stats-crawler.up.railway.app` | — |

`PROXY_HOST/PORT/USER/PASS` 也可以改成设一个完整的 `PROXY=http://user:pass@host:port` 代替。

> `SUPABASE_URL` 结尾**不要**带 `/rest/v1/`。2026-06-19 那次登入 500 就是这么来的
> （PostgREST 回 PGRST125）。程式已经会容错去尾，但别故意去踩。

## 三、代理不是可选的

后端 stats-crawler 有 ipGuard：**未授权来源不会回错误，而是 302 转去 booking.com**。
实测本机直连 8 个端点全部被转走。

Railway 的对外 IP 不固定，所以不能靠把 IP 加白名单解决，**必须走 `PROXY_*`**。
如果部署后查询一直报「後端轉址（status 302…）」，就是代理变量没设或设错，不是后端挂了。

## 四、部署后自我检查

1. 开首页 → 应该看到「審計系統登入」
2. 登入 → 进不去表示 Supabase 三个变量有问题（看 Railway logs 的 `[err:xxxx]`）
3. A 引擎选昨天日期、平台留 `ALL` → 按执行查询
   - 正常：约 500～600 笔（18 个平台 × 各自彩种）
   - 回 0 笔或报转址错误 → 代理变量问题
4. B 引擎目前一定是 0 笔，那是后端 `member-income` 的问题，不是部署问题，
   详见 [API-现状.md](API-现状.md)

## 五、还没做的事

- Vercel 上那个旧部署要不要关掉，等确认 Railway 这边稳了再决定
- 目前没有 CI，push 到 main 就会自动部署，没有预览环境
