# 职途 Atlas 文档

当前说明适用于 **0.22.1**，按 2026-09-22 本地代码核对。功能与操作以当前说明为准，历史记录用于追溯当时的实现和验证范围。

## 当前说明

| 你要了解什么 | 文档 |
| --- | --- |
| 拿到软件后的安装与配置 | [首次使用](QUICK_START.md) · [0.22.1 分发验证](DISTRIBUTION_0221.md) |
| 通用求职、首次使用与本轮验收 | [0.22.0](GENERAL_RELEASE_022.md) |
| 地图发行限制与依赖许可核对 | [许可核对](LICENSE_AUDIT_20260922.md) |
| 数据发送与隐私边界 | [隐私说明](PRIVACY.md) |
| 开源代码、本机密钥、登录会话与备份边界 | [本机私有配置](LOCAL_CONFIGURATION.md) |
| 当前运行代码、沿用配置和迁移兼容的区别 | [代码来源与兼容范围](PROVENANCE.md) |
| 工程配置、共享路由与历史导入重写 | [0.21.2 重写与验证](REWRITE_0212_20260922.md) |
| 主 Agent 与子任务、拟回复和发送凭据 | [Agent 运行台](AGENT_WORKBENCH_021.md) |
| 全局协调、行动顺序、预算与边界 | [求职协调](COORDINATOR_020_20260921.md) |
| 项目定位、能力和入口 | [项目 README](../README.md) |
| 如何配置资料、找岗位、联系与跟进 | [使用指南](USER_GUIDE.md) |
| 模型选择、max 参数、工具和用量 | [模型与工具](COMMANDCODE.md) |
| 桌面、后台、数据库及数据流 | [架构说明](ARCHITECTURE.md) |
| 安装、迁移、备份、回滚、排错 | [运行与升级](OPERATIONS.md) |
| 存储去重、分页、分块备份与版本 6 回滚 | [存储升级与验证](STORAGE_UPGRADE_20260921.md) |
| 全国城市与地图数据来源 | [地图数据说明](../packages/ui/src/renderer/src/assets/README.md) |
| 旧安全评审与重构后的状态对照 | [安全评审记录](../SECURITY-REVIEW-web-service.md) |

## 历史记录

下列文档保留原版本的测试数、数据快照及安装方法，不作为当前版本的使用说明。不要在当前安装目录执行其中的旧 ASAR 替换步骤；使用 [当前升级说明](OPERATIONS.md)。

| 当时版本／主题 | 记录 |
| --- | --- |
| 13.3 项目迁移 | [历史交接](PROJECT_HANDOVER.md)、[验证](VALIDATION_20260919.md) |
| 13.4 模型渠道 | [验证](VALIDATION_COMMANDCODE_20260919.md) |
| 13.5 移除模拟盘界面 | [验证](VALIDATION_DISCOVERY_20260919.md) |
| 13.6 沟通中心 | [验证](VALIDATION_COMMUNICATION_20260919.md) |
| 13.7 匹配话术 | [验证](VALIDATION_CONVERSATION_PITCH_20260919.md) |
| 13.8 话术确认与资料结构 | [验证](VALIDATION_PROFILE_REVIEW_20260919.md) |
| 13.9 投递前核验 | [验证](VALIDATION_READINESS_20260920.md) |
| 13.10 项目证据 | [验证](VALIDATION_PORTFOLIO_20260920.md) |
| 13.11 双来源与自动发送授权 | [验证](VALIDATION_DUAL_CONTACT_20260920.md) |
| 13.12 企业搜索与研判 | [验证](VALIDATION_COMPANY_RESEARCH_20260920.md) |
| 0.18 独立运行与文档核对 | [内核验收](VALIDATION_INDEPENDENT_20260921.md)、[文档审查](DOCUMENTATION_REVIEW_20260921.md) |
| 0.18.1 业务与交互审查 | [系统审查](SYSTEM_REVIEW_20260921.md) |
| 0.19 全局评审与地区适配 | [系统评审](REVIEW_019_SYSTEM_20260921.md)、[全局分析](GLOBAL_ANALYSIS_20260921.md) |
| 0.21.1 私有配置隔离 | [验收](LOCAL_CONFIG_VALIDATION_20260922.md) |
| 0.21.1 来源与旧实现核查 | [本次核查](SOURCE_REVIEW_20260922.md) |

“当时通过隔离测试”“曾调用真实模型”“当前真实平台发送通过”是不同结论，不能相互替代。旧计划里的 M 阶段不因更新版本号或重写说明自动成为已验收。
