# Railway 部署

原本这个专案是丢 Vercel 的（仓库名 `vercelghost` 就是这么来的），现在改用 Railway。

## 一、专案设定

Railway → New Project → Deploy from GitHub repo → 选 `biopw0836159/vercelghost`。

建置不用手动设定，[`railway.json`](../railway.json) 已经写好：

- builder：NIXPACKS（会自动认出 Next.js，跑 `npm ci` → `npm run build`）
- 启动指令：`npm run start`
- healthcheck：`/api/health`
- 失败自动重启，最多 10 次

> healthcheck **不能**打 `/`。加了 IP 白名单之后 `/` 一律回 403，而 healthcheck
> 由 Railway 内部发起、来源 IP 不在白名单，会被判定为不健康而陷入重启循环。
> 所以另外开了 `/api/health`，并在 `proxy.ts` 的 matcher 里排除它。

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
| `ALLOWED_IPS` | IP 白名单，逗号分隔，支援 CIDR | **整站一律 403** |
| `STATS_BACKEND_URL` | 选填，不设预设 `https://stats-crawler.up.railway.app` | — |

`PROXY_HOST/PORT/USER/PASS` 也可以改成设一个完整的 `PROXY=http://user:pass@host:port` 代替。

### 存取控制：IP 白名单

原本的 Supabase 帐密登入已经整套移除（连 `@supabase/supabase-js`、`bcryptjs`、
`jsonwebtoken` 依赖都拿掉了），改用 [`proxy.ts`](../proxy.ts) 做 IP 白名单。
Next 16 把 `middleware` 改名成 `proxy`，档案要放专案根目录、与 `app/` 同层。

- `ALLOWED_IPS` **没设时一律拒绝**，不是一律放行 —— 这站看得到 18 个平台的投注、
  盈亏、会员帐号和 IP，设定没做完之前不能裸奔
- 被拒页面会显示判定到的来源 IP，方便把自己加进白名单
- 本机 `next dev` 会自动豁免（`NODE_ENV=development`），否则本机没有
  `x-forwarded-for`，开发时自己也进不去

来源 IP 取自 `x-forwarded-for` 的第一段，取不到才退回 `x-real-ip`。

## 三、代理不是可选的

后端 stats-crawler 有 ipGuard：**未授权来源不会回错误，而是 302 转去 booking.com**。
实测本机直连 8 个端点全部被转走。

Railway 的对外 IP 不固定，所以不能靠把 IP 加白名单解决，**必须走 `PROXY_*`**。
如果部署后查询一直报「後端轉址（status 302…）」，就是代理变量没设或设错，不是后端挂了。

## 四、部署后自我检查

1. 开首页
   - 看到 403 且显示你的 IP → 把那个 IP 加进 `ALLOWED_IPS`
   - 看到主介面 → 白名单正确
2. A 引擎选昨天日期、平台留 `ALL` → 按执行查询
   - 正常：约 500～600 笔（18 个平台 × 各自彩种）
   - 回 0 笔或报转址错误 → 代理变量问题
3. B 引擎（会员注单深查）填一个会员帐号试
   - 正常：拿得到该会员的注单汇总
   - 报 60MB 超限 → 查询范围太大，缩短日期或改查单一会员

## 五、还没做的事

- Vercel 上那个旧部署要不要关掉，等确认 Railway 这边稳了再决定
- 目前没有 CI，push 到 main 就会自动部署，没有预览环境
- 换网路（换 wifi、用手机、出门）来源 IP 会变，得再加白名单。
  如果之后觉得麻烦，可以改回帐密登入，或改成帐密 + IP 双重
