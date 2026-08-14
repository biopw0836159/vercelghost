# 抓鬼系统 — 数据源现状（实测 2026-08-13）

全部结论都是走授权代理 + `x-api-key` 实打 `stats-crawler.up.railway.app` 得到的，
验证日期用 2026-08-12 / 2026-08-11 两天定型数据，两天结果一致。

---

## 一、连线方式（不走代理一定失败）

后端有 ipGuard：**未授权来源不会回错误，而是 302 转去 booking.com**。
本机直连 8 个端点，8 个全部被转走 —— 看起来像「后端挂了」，其实是被挡。

所以任何环境（本机、Railway）都必须带 `PROXY_*` 走授权代理，
或者把该环境的出口 IP 加进后端白名单。Railway 出口 IP 不固定，实务上仍要走代理。

---

## 二、端点实测总表

| 端点 | 状态 | 8/12 实测 |
|---|---|---|
| `/api/open/lottery-stats?platform=ALL` | ✅ 可用，**目前最可靠** | 572 笔（18 平台 × 彩种），投注额 238,330,524.11 |
| `/api/open/external-game-stats?platform=ALL` | ✅ 可用 | 183 笔外接游戏 |
| `/api/v1/member-bets` | ⚠️ 可用但有硬限制 | 见第四节 |
| `/api/open/lottery-analysis?platform=ALL` | ❌ **数字不可信** | 见第三节 |
| `/api/open/member-income?platform=ALL` | ❌ **永远回 0 笔** | 见第三节 |
| `/api/v1/profit-loss` | ❌ 404 不存在 | — |
| `/api/v1/tx-records` | ❌ 404 不存在 | — |
| `/api/v1/member-overview` | ❌ 404 不存在 | — |

参数格式两套并存，不要搞混：

- `/api/open/*` 用小驼峰：`platform`、`dateStart`、`dateEnd`，`platform` **必填**（可传 `ALL`）
- `/api/v1/*` 用底线：`date_start`、`date_end`

### 平台清单：18 个

```
XO  XY  OL  XH  LS  ND  RF  TD  HS  YD  JY  MT  SH  YS  JD  FB  SY  LY
```

以 `lottery-stats?platform=ALL` 的回传为准（会随后台开关变动，不要写死在代码里）。
旧的 `app/api/query/route.ts` 写死 15 个、缺 **XO / RF / TD**，该档已删除。

---

## 三、两个坏掉的数据源

### 1. `lottery-analysis` —— A 引擎正在吃的，数字是错的

对 **XO / XY / OL / XH / LS 五个平台一律回 0 个彩种**，但这五个平台在 `lottery-stats`
里都有大量数据。两天复现，稳定。

即使在「有回数据」的平台上，金额也对不上，且彩种数量完全一致（不是漏彩种，是金额本身不对）：

| 平台 | lottery-stats 投注额 | lottery-analysis 投注额 | 彩种数 |
|---|---|---|---|
| ND | 38,046,056.48 | 8,750.90 | 57 vs 57 |
| RF | 36,967,628.79 | 5,429.31 | 50 vs 50 |
| TD | 32,623,772.91 | 8,258.03 | 56 vs 56 |
| OL | 19,679,482.69 | **0.00** | 25 vs **0** |
| XY | 17,203,603.40 | **0.00** | 47 vs **0** |
| XO | 16,432,970.57 | **0.00** | 47 vs **0** |
| LS | 5,589,230.60 | **0.00** | 23 vs **0** |
| XH | 2,599,266.32 | **0.00** | 14 vs **0** |
| **合计** | **238,330,524.11** | **51,952.36** | 相差 **4587 倍** |

8/11 同样跑一次：合计 252,349,298.49 vs 57,840.35，相差 4363 倍，同样是那五个平台回 0。

平均单笔金额可以佐证哪边合理：

- 注单明细（真实 `bet_amount`）：52.4 元/笔
- `lottery-stats`：29.4 元/笔
- `lottery-analysis`：**0.81 元/笔** ← 不合常理

**顺带解释了专案为什么会停在这里**：A 引擎默认条件是「盈亏 10 万～100 万」，
而 `lottery-analysis` 全站一天总额才 5 万 —— 无论怎么调都不可能筛出东西。

> **处置**：A 引擎改吃 `lottery-stats`（它多了「平台」「人数」两个栏位，反而更适合抓鬼）。
> `lottery-analysis` 在后端查清楚之前不要用。

### 2. `member-income` —— B 引擎的唯一数据源，永远空

`HTTP 200` 但 `0 笔`，试过全部组合都一样：

- 单平台 XO / 昨天
- ALL / 近 7 天、近 30 天
- ALL / 2026-06（专案最后一次开发的月份）
- ALL / 2026-04（API 文件示范的日期）

B 引擎五条抓鬼规则（充销比高、充销比低、高返点、大额盈利、无充值销量高）
全部建在这个端点上，**目前一条都跑不出结果**。

---

## 四、`member-bets`（注单明细）—— 能用，但不能拿来做全量汇总

回传 `{ records: [...], total }`，单笔栏位：

```
platform, username, user_ip, lottery, play_type, play_name,
cycle_value, position, bet_content_full, bet_amount, win_amount,
state, state_code, bet_time
```

`username` / `cycle_value` / `lottery` 三者至少要传一个，不能只给日期。

**实测把 8/12 全天 77 个彩种拉完的代价：**

| 指标 | 数值 |
|---|---|
| 总耗时 | 109.5 秒（并发 6） |
| 总传输量 | **1715 MB** |
| 单一彩种最大回应体 | **264.9 MB**（台湾PK10，才 4315 笔） |
| 总笔数 | 257,528 |
| 不重复会员 | 4,273 |
| **撞上 10000 笔上限被截断的彩种** | **18 个** |

两个致命点：

1. **10000 笔是硬上限**，`total` 也跟着回 10000（不是真实总数）。`page` / `page_size` 无效，
   只有 `limit` 有效（且只能往下砍）。被截断 = 汇总数字必错。
2. 单次回应可达 264MB，Railway 容器直接吃不消。

> **处置**：`member-bets` 只用于**定向深查**（指定会员、指定彩种、短时窗），
> 不做全量汇总。全量汇总必须由后端出汇总端点。

---

## 五、抓鬼新维度：`user_ip`

注单明细带 `user_ip`，这是现有五条规则没有的维度。8/12 一天扫出
**同 IP 共用 ≥3 个帐号的 IP 有 55 个**，最多的一个 IP 挂了 47 个帐号。

但**不能直接拿来当证据**——排行前几名是机房 IP，不是工作室：

| IP | 帐号数 | 判读 |
|---|---|---|
| 13.115.151.115 | 47 | AWS 东京机房段 → 代理/VPN 出口，误报 |
| 13.158.161.203 | 46 | 同上 |
| 13.230.115.175 | 32 | 同上 |
| 35.72.140.81 | 28 | 同上 |
| 120.228.113.78 | 12 | 中国移动住宅段 → **值得查** |
| 117.151.31.202 | 8 | 同上 |
| 123.147.244.194 | 8 | 同上 |

做这条规则一定要先把机房/云厂商 IP 段排除，否则整页都是误报。

---

## 五之二、B 引擎原五条规则（暂时下架，等 member-income 修好要接回来）

B 引擎已改成「定向深查」，原本这五条建在 `member-income` 上的规则先从介面移除。
规则定义记录在这里，后端修好后照这个恢复（栏位来自 member-income：
总投注 `totalSales`、总充值 `deposit`、总返点 `treatment`、总盈亏 `profit`，
充销比 `ratio = totalSales / deposit`，`deposit` 为 0 时 ratio 记 0）。
规则之间是「或」关系，命中任一条就列出，并在「原因」栏标记。

| # | 名称 | 条件 | 原预设值 |
|---|---|---|---|
| ① | 充销比高 + 销量区间 | `deposit > 0` 且 `ratio ≥ ratioHigh` 且 `salesMin ≤ totalSales ≤ salesMax` | ratioHigh 50、销量 30000～99999999 |
| ② | 充销比低 + 充值区间 | `deposit > 0` 且 `ratio ≤ ratioLow` 且 `depositMin ≤ deposit ≤ depositMax` | ratioLow 2、充值 1000～2000 |
| ③ | 高返点 | `treatment ≥ treatmentMin` | 50000 |
| ④ | 大额盈利 | `profit ≥ profitMin` | 100000 |
| ⑤ | 无充值销量高 | `deposit === 0` 且 `totalSales > 0` 且 `totalSales ≥ salesMin` | 5000 |

其中 ①②⑤ 需要充值数据，所以就算 `member-income` 修好，
若它不含充值栏位，这三条仍然要靠 `tx-records`（见第六节第 2 点）。

## 六、要请后端补的东西（可直接转给后端）

按重要性排序：

1. **修 `/api/open/member-income`** —— 现在任何日期任何平台都回空阵列，
   抓鬼系统的会员维度规则全部依赖它。

2. **开 `/api/open/tx-records`（充值/帐变，吃 `x-api-key`）** ——
   统计站内部已有 `/api/query-tx-records`，但那个吃登入 session，open API 这边没有对应版本。
   没有充值数据，「充销比高」「充销比低」「无充值销量高」三条规则做不了。

3. **`/api/v1/member-bets` 加分页** —— 现在 10000 笔硬截断且无 offset/page，
   一天有 18 个彩种会被砍。要嘛支援 `offset`，要嘛让 `date_start/date_end` 收带时间的值以便切片。

4. **查 `/api/open/lottery-analysis`** —— 五个平台回 0、金额与 `lottery-stats` 差 4000 倍以上。
   是口径不同还是坏了，要有个说法；若确定废弃，请直接下线以免误用。

5. 图上给的这三条路径不存在，请确认正名或补上：
   `/api/v1/profit-loss`、`/api/v1/tx-records`、`/api/v1/member-overview`。
