# 职途 Atlas 桌面与网页

这是 Atlas 唯一的应用工作区。当前版本以 [package.json](package.json) 为准，运行命令从项目根目录执行。

- [项目定位与开始使用](../../README.md)
- [日常操作](../../docs/USER_GUIDE.md)
- [运行组成与数据流](../../docs/ARCHITECTURE.md)
- [构建、安装、迁移和回滚](../../docs/OPERATIONS.md)

桌面基于 Electron 与 Vue，正式网页使用同一套业务界面。本机服务负责通用业务和 AI 队列，桌面负责 BOSS 浏览器工作器，两者使用同一 Atlas SQLite 存储模块。模型配置和附件另存于本机，不能把“共用数据库”理解为“所有文件都在数据库中”。

正式发行包包含 Electron、桌面入口、后台、预加载桥接和网页资源；SQLite 使用 Node 内置模块。当前完整发行验收覆盖 Linux，其他系统待独立验证。

`pnpm check:runtime` 检查桌面、后台、预加载的真实构建依赖图，区分执行模块与迁移兼容代码，见 [代码来源与兼容范围](../../docs/PROVENANCE.md)。
