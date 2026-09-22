# 第三方组件与资料

Atlas 自有代码使用根目录 ISC 许可证。第三方代码和数据保留各自的许可；根许可证不重新授权地图数据、平台内容、模型服务或用户资料。

| 内容 | 来源与处理 |
| --- | --- |
| 早期项目来源 | [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun)，核对基线根包声明 ISC；当前重写与迁移范围见 [来源记录](docs/PROVENANCE.md)。保留历史来源，不以文件重写声称不存在来源关系。 |
| 桌面运行时 | Electron；完整发行包保留 `licenses/Electron-LICENSE` 与 Chromium 许可文本，根目录 LICENSE 为 Atlas 自有代码的 ISC。 |
| 界面与运行依赖 | Vue、Vue Router、Pinia、Element Plus、Leaflet、fflate 等，按锁文件确定版本。打包时生成所有已安装工作区依赖的许可目录，包含构建依赖，不代表它们均进入客户端执行链。 |
| 坐标转换 | wandergis/coordtransform，MIT，见 [完整许可](docs/licenses/coordtransform.txt)。 |
| 城市点位 | GeoNames，CC BY 4.0，见 [来源与处理](docs/MAP_DATA_SOURCES.md)。 |
| 在线地图 | 天地图 WMTS，由使用者配置自己的 Key 并遵守提供方服务条件。源码／安装包不包含底图或边界数据，不重新授权在线服务，见 [地图接入](docs/MAP_DATA_SOURCES.md)。 |

`scripts/atlas-licenses.cjs` 生成 `licenses/dependencies/` 与索引，保留依赖包自带的 LICENSE、COPYING、NOTICE、AUTHORS。单独的署名文件不被当作完整许可证。补充文本的精确版本、上游提交／标签、原文 SHA-256 和来源见 [补充清单](docs/licenses/dependencies.json)；收集时离线验证，不使用其他版本的许可替代。

2026-09-22 核对：本机安装的 486 个依赖包中，472 个可提供许可文本（其中 14 个使用补充文本，含此前的 Element Plus），14 个仍只有许可声明、尚待补齐文本。这是安装树范围，包含开发工具；不是客户端实际执行的依赖数量。[具体结果、网页输出核对与地图待处理项](docs/LICENSE_AUDIT_20260922.md)。清单生成或软件测试通过均不代表完整发行包已通过许可核查。
