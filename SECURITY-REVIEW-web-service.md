# 职途 Atlas · Web 服务层与安全模型评审

> **旧版本安全评审＋0.18 状态对照**。下方原评审在独立内核改造前形成，行号和路径属于当时版本。“未修改任何文件”描述当时评审行为；原问题清单保留，并不表示每项仍可在当前代码复现。

## 2026-09-21 文档核对

这次核对已有代码与验收证据，没有开展新的渗透测试，也不宣称所有安全问题关闭。

| 原编号 | 当前状态及边界 |
| --- | --- |
| H1–H3 旧密钥写库及权限 | 旧写入模块已删除；迁移副本的目录／文件设为 0700／0600。原目录作为备份保留，不保证已清理历史敏感数据或改变旧权限；没有由此推定已泄露或已轮换凭据 |
| M1、L2 CSP／nosniff | 当前 HTTP 服务为响应设置 CSP 与 nosniff；正式接口测试已覆盖 |
| M2、M5 旧开发中间件 | `local-api.mjs` 已删除，Vite 不再提供这套未认证业务接口 |
| M3 任意文件 IPC | 旧读写接口已删除；当前 preload 为受限通道，通用业务由注册处理器执行 |
| M4 内部错误回显 | 已对常见路径、SQL 和凭据模式过滤；不是所有错误均已做结构化分级或完整审计，不能写成彻底解决 |
| M6 大请求／限流 | 正式 RPC 仍允许最大 64 MiB 请求体，尚无全局速率限制；仍是待改进项 |
| L1 空字节路径 | 当前显式拒绝，正式接口测试覆盖 400 响应 |
| L3 token 范围 | token 在后台启动时随机生成，配合来源校验；仍无细粒度角色、定时过期或逐操作凭据，不能描述为完整权限系统 |
| L4 构建竞态 | Vite 配置已不再重建服务；`web/serve.mjs` 仍同步构建固定缓存文件，独立网页进程并发构建锁未补齐 |

当前架构与数据外发范围见 [架构说明](docs/ARCHITECTURE.md)，已有验证见 [0.18 记录](docs/VALIDATION_INDEPENDENT_20260921.md)。

## 原始评审（历史正文）


评审范围：`atlas-server.ts` / `local-api.mjs` / `serve.mjs` / `vite.config.mjs` / `main.ts` / `rpc-client.ts` / `main/index.ts`，并覆盖敏感数据落盘（实测 `~/.geekgeekrun` 权限）。未修改任何文件。

> 实测环境：`umask=0002`；`~/.geekgeekrun`、`config`、`storage` 目录均为 `775`；`public.db=644`、`boss-cookies.json=664`（组可读+组可写+他人可读）、`atlas.db/atlas-runtime.json/llm.json=600`。

---

## 🔴 高严重度

### H1. `public.db` 全局可读(644)，且代码路径把 LLM API 密钥明文写入其中
- 位置：`packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation.ts:185,218`；落盘 `~/.geekgeekrun/storage/public.db`（实测 `644`）
- 问题：`providerApiSecret: llmConfig.providerApiSecret`（**明文密钥**）被写入 `llm_model_usage_record` 并持久化到 `public.db`。备份导出时还要专门 `UPDATE ... SET providerApiSecret=NULL`（`atlas-backup.ts:152`）——反证该库确实以明文存密钥。`public.db` 同时包含全部 BOSS 会话/职位 PII。
- 影响：多用户/共享机器上，**任意本地用户可读走明文 API 密钥**并冒用计费；可读全部求职会话隐私。本机该列当前实测 0 行非空，但 schema 与代码写入路径明确存在，且库文件本身全局可读。
- 修复：`public.db` 创建/打开时 `chmod 0600`（目录 `0700`）；**不再持久化明文密钥**（按 schema 暗示改存 `providerApiSecretMd5`）；轮换已落盘密钥；对 `vite.config.mjs` 只读打开的库同样确保权限。

### H2. BOSS 登录 Cookie 全局/组可读且组可写(664)
- 位置：`packages/geek-auto-start-chat-with-boss/runtime-file-utils.mjs:242`（`writeStorageFile` → `:251` `fsPromise.writeFile`，**无 mode/chmod**）；初始创建 `:200` 同样无 mode
- 问题：`boss-cookies.json` / `boss-local-storage.json` 以默认 umask 落盘，实测 `664`（umask 0002 下组可读+组可写，他人可读）。
- 影响：BOSS 登录 Cookie = 完整账号会话。他人可读→**会话劫持/冒充发消息**；组可写→篡改注入恶意 Cookie。对比 `writeConfigFile`（`:36-38`）用了 `0o600`，存储侧独缺防护。
- 修复：`writeStorageFile` 写入后 `chmod 0o600`；存量文件补 `chmod`；目录 `0700`；必要时提示用户重新登录以吊销已泄露 Cookie。

### H3. 数据根目录/子目录为 775（非 700），与 atlas-store 的 0700 意图不一致
- 位置：`runtime-file-utils.mjs:128,134`（`mkdirSync` 无 mode）；`atlas-store.ts:21` 仅对 `storage` 传 `0o700` 且不改变已存在目录
- 问题：谁先创建谁决定权限；`runtime-file-utils` 先建则目录 `775`，导致组/他人可列举、配合 umask 0002 使新建文件组可写。
- 影响：本地信息枚举 + 组内横向篡改面。
- 修复：三处目录统一 `mkdirSync(...,{mode:0o700})` 并在启动时 `chmod` 收敛；进程内设置更严格 umask。

---

## 🟡 中严重度

### M1. Web 端缺失 CSP，而桌面端有 CSP（双模式行为分叉）
- 位置：`atlas-server.ts:30-31`（仅 `X-Frame-Options`/`Referrer-Policy`，**无 Content-Security-Policy**）；对照 `renderer/index.html:9-10` 有 CSP；`web/desktop.html` 无
- 问题：生产 Web 服务不下发 CSP。
- 影响：叠加“token 注入 DOM + 全能 bearer token”，一旦渲染层存在任何 HTML/JS 注入，无 CSP 兜底，攻击脚本可读 meta token 并驱动全部高危 channel（`career-backup-restore`/`career-tasks-policy`/`career-contact-start`）。
- 修复：Web 响应统一加 CSP（至少 `default-src 'self'; script-src 'self'; object-src 'none'`），与桌面端策略对齐。

### M2. dev 中间件无 token 认证，仅靠 Origin + 静态头
- 位置：`local-api.mjs:9`（`x-atlas-client!=='local-dashboard'` 为公开常量，见 `rpc-client.ts:22`）
- 问题：Vite dev 服务 RPC 只有 Origin/host/静态头校验，**无 bearer token**；生产 `atlas-server.ts` 有 token。两套认证模型分叉。
- 影响：非浏览器本地客户端、或能伪造/省略 Origin 的路径，可直接调用全部 career handlers；dev 环境凭据强度远低于 prod。
- 修复：dev 复用同一 token 机制，或将 dev 中间件限定 loopback 且要求 token。

### M3. `read-storage-file` / `write-storage-file` IPC 路径穿越
- 位置：`packages/ui/src/main/utils/initPublicIpc.ts:68-76` → `readStorageFile(payload.fileName)`（内部 `path.join(storage, fileName)`）
- 问题：`fileName` 未按 `storageFileNameList` 白名单校验。`../../config/llm.json` 可越出 storage 读到 API 密钥；亦可任意写。
- 影响：桌面渲染层一旦被 XSS/依赖投毒，即升级为任意文件读写与密钥外泄。
- 修复：白名单校验 `fileName`（拒绝含 `..`/分隔符/不在 `storageFileNameList`）。

### M4. RPC/错误响应回显内部异常 `e.message`
- 位置：`atlas-server.ts:63`、`local-api.mjs:18`
- 问题：原始异常消息直接返回客户端，可能含路径、SQL 片段、堆栈线索。
- 影响：向持有任一本地入口的攻击者泄露内部结构。
- 修复：对外返回通用错误，细节仅服务端记录。

### M5. `local-api.mjs` 用 `body += chunk.toString('utf8')` 拼大体
- 位置：`local-api.mjs:12`
- 问题：O(n²) 拼接；且分片会切断多字节字符（中文简历 basis 可达 45000 字），跨 chunk 边界产生乱码。`atlas-server.ts:53-57`（`Buffer.concat`）处理正确，二者不一致。
- 影响：dev 模式下大中文 payload 数据损坏；轻微 DoS。
- 修复：改为收集 Buffer 后一次性 `toString`。

### M6. 请求体全量入内存 + 无速率限制
- 位置：`atlas-server.ts:53-56`（64MB）、`local-api.mjs:12`（11MB）
- 问题：两处限制差异大且均无限流解析、无速率限制。
- 影响：本地内存耗尽 DoS；限制口径不统一。
- 修复：统一并下调限制、流式解析、loopback 速率限制。

---

## 🟢 低严重度

### L1. `%00` 空字节路径致未捕获异常，可能崩溃独立 Web 服务
- 位置：`atlas-server.ts:70-74`（`decodeURIComponent` 后再 `path.resolve`，空字节在 try 之外）
- 问题：`path.resolve` 遇 `\x00` 抛 `ERR_INVALID_ARG_VALUE`，异步 handler reject → `unhandledRejection`（Node≥15 默认终止进程）；`serve.mjs` 无兜底。
- 影响：单个本地请求即使服务崩溃（DoS）。
- 修复：显式拒绝空字节；将 resolve/exists 包进 try/catch。

### L2. JSON/403 响应缺 `X-Content-Type-Options: nosniff`
- 位置：`atlas-server.ts:32-38`（`send()` 未设）；仅静态分支 `:83` 设置
- 修复：`send()` 统一补 `nosniff`。

### L3. Bearer token 无作用域/过期，注入 HTML meta = 全能凭据
- 位置：`atlas-server.ts:16,89`；`main.ts:21-32`
- 问题：单 token 授予全部 channel、不过期；同源任意 JS 可从 meta 取用。
- 影响：任何注入即可完全驱动自动化。
- 修复：token 绑定 origin、缩短生命周期、对危险 channel 二次确认。

### L4. `vite.config.mjs` 每次配置加载同步全量 esbuild 重建 `.atlas-cache/*.cjs`
- 位置：`vite.config.mjs:14`、`serve.mjs:5`
- 问题：同步 buildSync 阻塞配置加载；并发 vite 进程写同一 outfile 有竞态；每次都重建故无过期缓存，但缺原子写/锁。另 `server.fs.allow` 放开到 `../../..`（dev-only，偏大）。
- 修复：按源文件 hash 决定是否重建；临时文件+rename 原子写；构建加锁；收紧 `fs.allow`。

---

## ✅ 已做得当（正面）
- `timingSafeEqual` 用法正确：先比长度再常量时间比较，避免长度泄露与抛错（`atlas-server.ts:10-14`）。
- 绑定 `127.0.0.1`（`:98`）+ `Host` 头强校验（`:39`）→ 有效缓解 DNS rebinding。
- 静态路径穿越被 `startsWith(webRoot+sep)` 阻断（`:74-76`）；RPC 走 Origin+`sec-fetch-site`+无 CORS，CSRF 防护充分。
- `atlas-runtime.json`/`atlas.db`/`llm.json` 均 `0600`；含 token 的 HTML 响应 `no-store`（不缓存 token）。
- 备份 `AES-256-GCM + scrypt`，导出时剥离 Cookie/密钥（`atlas-backup.ts`）。
- `career-model-settings` 不向前端返回明文密钥（`atlas-model-config.ts:41-48`）；web 模式禁用 `career-copy-text`（`atlas-service.ts:204`）。

---

## Top 5 必改项
1. **H1/H2/H3 存储权限**：`public.db`(0600/目录0700)、`boss-cookies.json`(0600)、目录统一 0700，并停止把明文 API 密钥写入 `public.db`、轮换已泄露密钥。
2. **M3 路径穿越**：`read-storage-file`/`write-storage-file` 加文件名白名单，堵住渲染层→任意文件读写。
3. **M1 Web CSP**：为 Web 响应补 CSP，与桌面端对齐，兜底 token-in-DOM 的注入风险。
4. **M2 dev 认证补齐 + M4/M6**：dev 中间件引入 token（消除与 prod 的认证分叉），错误信息不再回显内部细节，统一并收紧 body 限制与速率限制。
5. **L1/L4 健壮性**：空字节路径 try/catch 防崩溃；esbuild 产物原子写 + 按需重建 + 构建锁，收紧 `fs.allow`。
