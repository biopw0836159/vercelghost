# Railway 部署

原本这个专案是丢 Vercel 的（仓库名 `vercelghost` 就是这么来的），现在改用 Railway。

## 现况（2026-08-14 上线）

| 项目 | 值 |
|---|---|
| 网址 | **https://ghsot-production.up.railway.app** |
| Railway 专案 / 服务 | `zhuagui` / `ghost` |
| 部署来源 | GitHub `biopw0836159/vercelghost` 的 `main` 分支 |
| 白名单 `ALLOWED_IPS` | `52.192.113.75`（即授权代理的出口 IP） |
| 登入帐号 | `owlrisk`（密码不写在这里，改密码见下方） |

> ⚠️ **服务名与网址是两件事，别以为改名就会换网址**（2026-08-17 实测厘清）：
> 服务名现在叫 `ghost`，网址却仍是 `ghsot-...` —— 网址只在**第一次生成时**取自服务名，
> 之后改名不会跟着动。所以现在两者对不上是正常的，同事不用换网址。
>
> 想真的换网址，得删掉旧 domain 再建新的（`serviceDomainCreate` 会依当下服务名生成）。
> `serviceDomainUpdate` 传 `domain` **回 true 但完全不生效**，别被它骗了。
> 另外 Railway 的域名是**全局唯一**：`ghost-production.up.railway.app` 已被别的帐号占用，
> 重建只会拿到带随机后缀的 `ghost-production-2b8c...`，所以这次决定不换、维持旧网址。

## 进站要过两道

1. **IP 白名单** —— 浏览器必须挂 `52.192.113.75` 那个代理，直连一定看到「存取被拒」。
   这是刻意的设定，不是故障。
2. **帐密登入** —— 过了白名单会看到登入页，输入帐密才进得去。
   session 是 HMAC 签名的 httpOnly cookie，有效 12 小时。

两道都是在 [`proxy.ts`](../proxy.ts) 里做的，顺序是先 IP 后帐密。
**没设 `AUTH_USERS` / `AUTH_SECRET` 时第二道会自动略过**，只靠 IP 白名单 ——
这是刻意的，免得设定还没做完就把人锁在门外。

### 改密码 / 加帐号

```bash
node scripts/gen-user.mjs <帐号> <密码>     # 产生 帐号:salt:hash
node scripts/gen-user.mjs --secret          # 产生 AUTH_SECRET
```

把产生的字串贴进 Railway 的 `AUTH_USERS`（多个帐号用逗号分隔）。
**密码本身不会被存下来**，存的是 scrypt 杂凑。换掉 `AUTH_SECRET` 等于让所有人重新登入。

上线当天实测：直连 403、走代理 200、走代理打 A 引擎拿到 8/13 的 563 笔
（18 个平台、投注合计 242,523,019.35）。

家用宽带那种浮动 IP 没有加进白名单，因为它会变。要加的话，403 页面上会直接
显示当下的来源 IP，把它加进 `ALLOWED_IPS` 即可。

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
| `ALLOWED_IPS` | IP 白名单，逗号分隔，支援 CIDR（IPv4 / IPv6 皆可） | **整站一律 403** |
| `AUTH_USERS` | 帐密，格式 `帐号:salt:hash`，多组逗号分隔 | 帐密那道自动略过，只剩 IP 白名单 |
| `AUTH_SECRET` | 签 session cookie 用的随机字串 | 同上 |
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

## 三之二、Railway 重新部署的坑

**push 到 GitHub 不会自动部署 —— 因为 Railway 与本仓库的连接是断的。**
Railway 服务的 Settings 里，「Branch connected to production」显示红字
`GitHub Repo not found`。`git push` 之后线上还是旧版，必须手动触发。
2026-08-15 踩过：push 完等了十分钟才发现根本没有新部署被建立。
判断方式是直接问 Railway 有没有该 commit 的部署，不要靠「线上功能有没有出现」去猜。

根因（2026-08-16 查明）：**Railway 的 GitHub App 授权范围里没有本仓库**。
拿同帐号的 report-hub 对照就清楚了 —— 它是 **private** 仓库却能自动部署，
说明 App 授权本身是好的、它在授权列表里；本仓库是 **public**，不在列表里。
于是形成这个组合：

- Railway 不需要授权就能匿名 clone public 仓库 → **手动带 `commitSha` 部署一直成功**
- 但收 push 事件（webhook）需要授权 → **push 永远不触发部署**，UI 也查不到分支信息

**从 Railway 侧重连解决不了，已实测（2026-08-16）**：
跑 `serviceConnect({repo:'biopw0836159/vercelghost', branch:'main'})` 回传成功，
但那只是让 Railway 重新记下 repo。之后 push 一个 commit、观察 4 分钟，
**没有任何部署被建立** → webhook 依然不存在。

⚠️ 副作用要知道：`serviceConnect` 当下会**立刻部署一次当时的最新 commit**
（public 仓库不需授权即可 clone）。所以跑它等于顺手上线一次，别在不想变更线上时跑。

**⚠️⚠️ 2026-08-17 晚间起 GitHub 正在 critical 事故，这期间的任何判断都不算数**：
`githubstatus` 显示 **Webhooks = partial_outage、API Requests = major_outage**
（事故 UTC 13:40 起）。push 不触发部署、Railway UI 显示 `GitHub Repo not found`，
在事故期间**都可能只是 GitHub 挂了**，不代表配置有问题。
→ 要判断连接到底好没好，**必须等 GitHub 恢复 operational 之后再 push 一次实测**。
查法：`https://www.githubstatus.com/api/v2/summary.json`。

注意时间线别搞混：2026-08-15 那次「push 完等十分钟没有部署」发生在事故之前，
所以那次是真问题；而 08-17 晚间的两次复测都在事故期间，结论作废。

**⚠️ 「授权范围没包含本仓库」的推论，2026-08-17 经截图核对是错的**：
Railway App 的 Repository access 选的是 Only select repositories，四个仓库
（`vercelghost`、`777444`、`report-hub`、`99999999`）里**本来就有 `vercelghost`**。
所以 public / private 那个对照只能解释「手动部署为何仍可用」，
解释不了 webhook 为何没建立 —— 真正原因另有其他，别再照那个方向查。

在那之前，一律用 `serviceInstanceDeployV2` 显式带 commitSha 手动部署。

`serviceInstanceDeployV2` 触发重部署时，用的是**服务当前记录的 commit，不会自动拉最新**。
上线当天就踩到：修好 healthcheck 后 push，但重部署仍在跑旧 commit，连失败两次。

要部署最新版，得显式带 `commitSha`：

```graphql
mutation($eid: String!, $sid: String!, $sha: String!) {
  serviceInstanceDeployV2(environmentId: $eid, serviceId: $sid, commitSha: $sha)
}
```

另外，**部署失败后 Railway 不会自动重试**，得手动再触发一次。

## 四、部署后自我检查

1. 开首页
   - 看到 403 且显示你的 IP → 浏览器没挂代理（正常情况），或需要把该 IP 加进 `ALLOWED_IPS`
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
