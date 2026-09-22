# 独立项目迁移（历史记录）

> 当前运行方式与数据目录已在 0.18.0 更新，参见 [独立内核验收](VALIDATION_INDEPENDENT_20260921.md)。当前操作见 [运行与升级](OPERATIONS.md)。以下保留 2026-09-19 的历史交接内容；旧源码链接、数据目录和安装说明不应直接用于当前版本。

日期：2026-09-19。应用版本：0.17.4+atlas.13.3。

项目已迁到 `$HOME/work/zhitu-atlas`，作为独立 Git 仓库维护。原工作目录的 `work/geekgeekrun-src` 保留兼容符号链接；已安装客户端仍位于用户级安装目录，不依赖源码所在目录。

新仓库保留完整产品源码、工作区包、网页入口、静态资源、锁文件、回归测试和构建验收工具。临时研究仓库、用户简历、运行数据库、账号会话、API 凭据及本机安装包不属于源码提交内容，继续保留在原数据或成果目录。

上游来源：`https://github.com/geekgeekrun/geekgeekrun.git`，本机原始基线为 `c4ebdb0`。旧 Git 元数据保存在本机 `.local-backups/upstream.git`，不推送到新仓库。新仓库从清理后的 Atlas 快照开始独立历史，避免携带旧版模型示例密钥；上游 remote 仅用于日后读取与比较。

## 本轮变更

- 根目录统一提供 start、dev、build、test、typecheck、check、web 入口。
- 明确 Node.js 22 和 pnpm 8.15.9 环境，补充直接使用的构建工具依赖。
- Agent、自动联系和模拟盘界面检查的输出改为项目内 `artifacts/`，不再依赖旧工作目录。
- 移除包含硬编码示例密钥的旧第三方模型预设。
- 补充项目 README、数据排除规则及来源说明。
- 运行数据和自动发送状态不因源码目录迁移而改变。

## 验证

在迁移后的根目录运行 `node scripts/atlas-project.mjs check`，结果记录于 `docs/VALIDATION_20260919.md`。独立迁移不扩大已有平台功能的验收范围；真实发送仍按既有资料确认、内容与平台回读规则执行。

## 后续维护

在新目录进行改动并向私有 Gitea origin 推送。不要提交 `.local-backups`、`artifacts` 或 `~/.geekgeekrun`。准备公开发布时，应另行检查上游许可、第三方资源和平台能力的公开说明。
