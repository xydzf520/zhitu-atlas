# 参与开发

欢迎修复问题、改进不同职业的匹配、完善平台适配或使用体验。先用 Issue 描述实际场景和可复现步骤；小修复可以直接提交 PR。

## 本机开发

Node.js 22.13+、pnpm 8.15.9。首次执行 `pnpm install --frozen-lockfile`，随后运行 `pnpm check`。桌面需要 Linux 图形环境；Windows/macOS 尚未完成完整客户端验收。

开发和运行测试使用独立目录，不复用真实求职数据：

```bash
export ATLAS_DATA_ROOT="$(mktemp -d)/data"
export ATLAS_PORT=5188
pnpm build
pnpm dev
```

默认测试只使用隔离样例，不连接招聘账号。含 `--real` 或 `--judge-real` 的评估会调用你配置的模型并可能产生费用；不要放进默认 CI。可用 `ATLAS_EVALUATION_DATA_ROOT` 指定真实评估来源，评估报告属于私人资料，不提交仓库。

## 提交要求

- 修改规则时增加跨职业、未知条件和误匹配用例，不用修改分数来掩盖误判。
- 模型只能生成内容和只读建议，不得绕过发送授权、确认记录和账号隔离。
- 平台发送必须保留去重、输入检查和结果核验；模拟测试与真实账号验收分别标记。
- UI 显示来源、未知项和实际状态；支持键盘、窄屏及加载失败，不制造录用概率。
- 附上相关验证结果。执行 `pnpm check:public:history` 后检查截图、日志是否脱敏。
- PR 说明问题、用户可见变化、测试和未验证范围。不要附真实简历、聊天、Cookie、密钥或数据库。

保留源码及第三方许可。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。
