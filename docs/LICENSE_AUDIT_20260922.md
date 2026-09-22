# 0.22.0 许可核对（历史记录）

**后续状态：0.22.1 已移除本文指出的 DataV 边界文件和匿名高德接入，改用使用者自己的天地图配置；下文保留核对当时的事实。当前分发方式与限制见 [0.22.1 交付](DISTRIBUTION_0221.md)。旧 Git 历史不随源码包提供。**

核对日期：2026-09-22。范围为当前源码、锁文件对应的本机依赖、网页实际构建输出、打包脚本及地图数据的官方来源材料。

**结论：当前含地图资产的源码与完整客户端，尚不能按“许可已核查通过”公开发行。主要缺口是 DataV 边界的再分发授权和高德底图的正式接入许可。** 已补齐部分依赖材料，但不能用软件测试或依赖清单代替地图授权。

## 核对结果

| 对象 | 结果 | 依据／范围 |
| --- | --- | --- |
| Atlas 自有代码 | 根 ISC 已提供 | 仅适用于有权授权的自有内容，不覆盖第三方资料 |
| 已安装 npm 依赖 | 486 个均有许可声明；472 个有归档文本，14 个仍待补全文本 | 包含构建、测试和打包工具，不代表全部进入客户端 |
| 网页输出的 JavaScript 依赖 | 21 个均有可追溯的许可文本 | 从实际 Rollup 输出模块采集；不是完整发行包的全部资产审计 |
| 桌面额外运行依赖 | fflate 的 MIT 文本已收集 | 打包脚本将 fflate 随应用分发 |
| Electron / Chromium | 许可文件保留 | `licenses/Electron-LICENSE`、`LICENSES.chromium.html`；本轮未独立审计其全部原生传递组件 |
| 坐标转换 | MIT 原文保留 | [coordtransform 许可](licenses/coordtransform.txt) |
| GeoNames 参考点 | 来源声明 CC BY 4.0 | 项目保留署名、许可链接和数据处理说明；不将参考点当作国界授权 |
| DataV 本地边界 | 再分发权尚未核实 | 官方示例提供下载地址，未找到随第三方开源仓库／安装包再分发的明确许可 |
| 高德在线底图 | 正式接入授权尚未核实 | 当前为 Leaflet 直接读取瓦片地址，不是已核实授权的 SDK 集成 |

## 依赖材料已修正

原清单有 27 个依赖没有单独的许可文件。本次从精确版本对应的上游提交／标签补齐 11 个：esbuild Linux 二进制包、@polka/url、@puppeteer/browsers、Rollup Linux 二进制包、app-builder-lib、dmg-builder、filelist、jake、puppeteer、puppeteer-core、sirv。另外从 degenerator 和 netmask 发布包的 README 中提取其完整 MIT 许可段，保留原始文本。

加上此前的 Element Plus，现有 14 份精确版本补充材料。每份记录来源和 SHA-256；README 提取还绑定原文件哈希。相关 Apache 项目的同一引用根目录未取得额外 NOTICE，不据此断言所有目录都不存在通知。补充记录见 [dependencies.json](licenses/dependencies.json)。

剩余 14 个：`app-builder-bin@4.0.0`、`bluebird-lst@1.0.9`、`chromium-pickle-js@0.2.0`、`compare-version@0.1.2`、`de-indent@1.0.2`、`eastasianwidth@0.2.0`、`err-code@2.0.3`、`keyv@4.5.4`、`lazy-val@1.0.5`、`lodash-unified@1.0.3`、`temp-file@3.4.0`、`tmp-promise@3.0.3`、`truncate-utf8-bytes@1.0.2`、`utf8-byte-length@1.0.4`。

其中后两者声明 WTFPL，其余声明 MIT；这不等于“没有许可”，也不等于它们全部随客户端分发。精确版本元数据和已找到的署名文件记录在 [待补清单](licenses/review-required.json)。需补对应权利方文本或进一步核实分发范围，不伪造作者、年份或用最新版 LICENSE 替代。

本机 486 个 npm 包的许可声明中未发现 GPL／AGPL；此统计不覆盖 Electron 原生依赖、包内未声明的第三方片段和地图数据，不能据此声称全项目没有其他义务。

此前将 `lodash-unified` 直接列作客户端运行依赖许可缺口不准确：实际网页输出未包含该包代码，包含的是已有许可文本的 `lodash-es@4.17.21`。本次已修正文档。网页模块核对排除 CSS、图片、地图、桌面主进程／预加载及 Electron 原生组件，不能推广为整个客户端只有 21 个依赖。

## 地图为什么仍未通过

当前文件 `packages/ui/src/common/data/map-boundaries.json` 的 SHA-256 与来源记录一致：`99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275`。保留台湾省、南海诸岛和全部断续线要素的几何检查是必要验证，但与版权、接入许可是两回事。

- [DataV 官方 SDK 示例](https://help.aliyun.com/zh/datav/datav-atlas/developer-reference/atlas-sdk-introduction)提供 GeoJSON／瓦片地址，没有在该示例中找到开源再分发授权。[DataV 服务协议](https://help.aliyun.com/zh/datav/datav-7-0/support/required-agreements/)第 5.3 条对相关资料的知识产权与未授权分发作出限制。因此“公开可下载”不足以证明可以随本项目转授权。
- [高德开放平台服务协议](https://developer.amap.com/pages/terms/)第 3.5 条限定数据展示、存储及脱离服务使用的方式，第 3.8 条保留未明确授予的权利。个人免费配额还有认证及用途条件，不能解释为任何开源软件或商业使用都免费。当前实现缺少对应应用的授权依据，补署名不能代替核实接入许可。
- [GeoNames 官方说明](https://www.geonames.org/about.html)及 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)允许按条件共享和改编。项目使用的是经筛选的城市／区县点位，渲染时进行坐标转换，相关署名、许可及处理说明见 [地图来源](MAP_DATA_SOURCES.md)。这不授权 DataV 或高德边界。

建议的整改顺序：先将地图提供方抽成可配置适配器，再按提供方文档与许可接入；凭据留在使用者本机。当前边界不能继续默认随公开仓库打包，须取得明确再分发授权，或使用授权与地图使用条件均可核实的替代资源。不能只更换下载 URL、补一个审图号，或换成缺少所需要素的地图来宣布问题解决。使用者申请 Key 也不自动意味着所有用途获得许可。

## 历史来源

已核对 GeekGeekRun 基线提交的根包 ISC 声明，同时发现同一基线未取得根目录独立 LICENSE，README 另有用途提示。二者的关系未在本轮作法律定性，来源事实已写入 [PROVENANCE](PROVENANCE.md)。文件重写或没有字节完全相同的文件，不能单独证明衍生关系已消失；保留来源及适用的第三方署名。

## 本次验证与复现

```sh
node --test tests/licenses.test.cjs
pnpm licenses:collect
pnpm check:licenses:web
node scripts/atlas-public-check.cjs
```

- 新增 6 项测试通过：纯署名文件不充当完整许可、精确版本匹配、原文损坏、许可声明冲突、README 来源变化、重复版本／路径及工作区别名去重。
- 许可收集结果为 486 个包、14 份补充文本、14 项文本待补。
- 网页实际生产构建通过，输出依赖 21 个，许可文本缺口为 0。构建仍有体积超过 500 kB 的既有提示；它与许可结论无关。
- 在临时目录重新打包并检查 20 个许可／说明文件，补充文本哈希全部一致，Electron 许可未被根 ISC 覆盖；检查后删除临时包。当前源码检查扫描 334 个文件无规则命中，未在本轮重跑全部应用测试。
- 本机详细证据位于忽略提交的 `artifacts/license-audit/`。采集脚本可复现，摘要不是通用法律认证，也不是供应链安全审计。

本轮只补充源码中的核查工具、许可材料和说明；未替换运行中的客户端、未改地图数据、未公开发布。此前生成的安装包未被覆盖，需重新打包才能包含新增材料；即使重新打包，地图授权缺口仍然存在。
