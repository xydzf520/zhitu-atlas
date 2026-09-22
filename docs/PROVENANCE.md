# 代码来源与兼容范围

Atlas 早期基于 [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 改造，本机核对基线为 `c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a`。保留这条来源记录，不将项目历史改写为完全从零开始。

## 当前代码

当前只有 `packages/ui` 一个应用工作区。桌面、后台、预加载、业务服务和 BOSS 执行链使用 Atlas 实现。旧自动开聊包、旧跟进进程、旧 IPC 文件读写接口、旧开发业务中间件及旧数据模型执行器已移除，构建不依赖它们。

0.21.1 核查曾发现 8 份相同的工程配置。**0.21.2 已重新建立这些配置**：格式与忽略规则统一到项目根目录，工作区明确限定 `packages/ui`，Node／网页编译配置由 Atlas 本身维护，并移除旧编译模板依赖。与该上游基线逐文件比对，当前跟踪文件已无完全相同项。此结论只描述文件内容，不抹去早期项目来源。

Electron、Vue、Element Plus、Leaflet、fflate 等是通用第三方组件，继续按各组件自身的许可使用。Puppeteer 仅用于开发验证脚本，不参与 Atlas 客户端的 BOSS 执行链。坐标转换和地图数据说明见 [坐标转换许可](licenses/coordtransform.txt) 与 [地图来源](MAP_DATA_SOURCES.md)。上游根包在核对基线声明 `ISC`；本次清理不修改已有许可或第三方署名。

2026-09-22 复核该基线：[`package.json`](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/package.json) 声明 ISC，但未取得同一提交的根目录独立 LICENSE；[原 README](https://github.com/geekgeekrun/geekgeekrun/blob/c4ebdb0882d8dbecfd9864f980f6d13bd1eb4b2a/README.md) 另有用途提示。这些事实一并保留，不把包声明或文件不再相同解释为已证明所有历史衍生权利均已消失。当前根 ISC 只覆盖 Atlas 可授权的自有内容。

## 为什么仍有兼容名称

| 保留内容 | 作用 | 不会做什么 |
| --- | --- | --- |
| `~/.geekgeekrun` 首次迁移入口 | 没有新数据目录时，用 Atlas 迁移代码保留旧资料，迁移后暂停自动执行 | 不启动上游程序，也不向旧目录继续写入 |
| `public.db`、旧配置与历史档案读取 | 将记录导入 Atlas，保留来源、未知账号归属与恢复能力 | 不恢复旧库的持续写入进程 |
| 旧页面名称的路由跳转 | 统一路由解析器将两端旧书签带到 Atlas 页面，保留筛选条件 | 不加载旧组件或启动第二套自动任务 |
| 开源检查中的历史对象标识 | 精确识别已核对的上游空凭据示例 | 不把旧模块加入源码、前端或发行包 |
| 历史验收中的旧路径 | 如实记录当时的版本和恢复证据 | 不作为当前安装命令 |

BOSS 自身的 `/web/geek/` 页面与接口路径是招聘平台地址，不能按旧项目残留删除。

历史档案导入器也已重写，按账号、岗位与消息时间建立关联，保留冲突原文，不覆盖已有资料。没有当前页面调用的旧资料适配与旧策略写入接口已删除；仍被使用的资料、策略与历史查询入口继续工作。

`pnpm check:runtime` 从实际入口构建依赖图；`pnpm check:public:history` 检查源码及本地可达 Git 历史。核查方法及局限见 [重写前核查](SOURCE_REVIEW_20260922.md)，本次实现见 [0.21.2 重写记录](REWRITE_0212_20260922.md)。
