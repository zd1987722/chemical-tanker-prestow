> **公开演示版 · 虚构船 · 演示 · 未认证**
> 本仓库为「海运化学品安全信息系统」的开源演示版本,含**多票货预配载**模块(枚举舱位组合、相容性/隔离校验、逐港吃水/稳性/强度推演、单货最大装载量)。
> 线上 Demo: https://psn.tankersafe.cn/demo/stow (无需注册)。所有船舶参数、港口限制、货票均为合成演示数据,不代表任何实船与港口公告,**不得用于实际作业**;最终装载以船上装载仪为准。
> 教学文章:公众号「驾船看世界」《8 港 12 货怎么配:从一封租家邮件到一版配载方案》。

# 多票货预配载

## 本仓库范围

本仓仅含多票货预配载模块的引擎、界面、测试、演示邮件与设计文档。主平台的物质查询、独立相容性查询、港口限制、装载计算等模块不在本仓；预配载所需的通用计算库随模块提供。

相容性判定包含 46 CFR 150 Figure 1 矩阵与 Appendix I 例外静态快照（`shared/appendix-i-exceptions.json`，导出日期见文件）。主站以数据库为准；后台维护例外后，需在主站仓库重新运行 `pnpm export:appendix-i` 并重新导出公开仓。AI 解析邮件在公开版中停用，规则解析可用。货名可以手工填写，分组与物性需自行核对填写。本应用不依赖服务器、数据库或 AI 服务。

## 快速开始

使用支持 Vite 7 的 Node.js（20.19+ 或 22.12+）及 pnpm：

```sh
pnpm install
pnpm dev
```

打开 http://localhost:5173/?sample=far-east-europe-12 。`?sample=` 在未保存航次时自动载入；已有草稿时可从标题栏选择示例。

```sh
pnpm check
pnpm test
pnpm build
pnpm preview
```

演示邮件可在页面「导入租家邮件」面板底部下载，也位于 `client/public/demo-mails/`。`pnpm gen:demo-mails` 生成正文与主题，`scripts/gen-demo-mails.ps1` 使用本机 Outlook 生成邮件，`scripts/scrub-demo-mails.py` 清洗邮件身份信息（需 Python 与 `olefile`）。

## 功能与引擎

引擎枚举舱位组合，进行相容性与隔离校验，再逐港计算到港、离港吃水、稳性、强度与压载规则，最后排序。支持多港分装、分卸、加温货、固定数量及单货最大装载量。最大装载量求解以到港吃水为约束，计入沿途油水消耗。

航程设置包含燃油、淡水 ROB、航行与在港消耗，以及载重线季节区。快速估算用于组合筛选和排序；静水力精算以合成船体数据复核指定状态，两者的结果均仅用于演示。

| 示例 ID | 航次与重点 |
| --- | --- |
| `basic` | 蔚山两泊位装、鹿特丹与安特卫普卸，6 票，含加温与分卸 |
| `far-east-europe-12` | 远东五个装货停靠点至欧洲三个卸货停靠点，12 种货物、20 舱满舱 |
| `split-loading-12` | 六港装、两港卸，甲醇三港分装，乙二醇与正己烷分票 |
| `single-meoh-draft` | 甲醇至张家港，淡水吃水 10.5 m，求最大装载量 |
| `single-naoh-draft` | 50% 烧碱至胡志明，吃水 9.5 m，重量受限 |
| `single-benzene-two-ports` | 苯至张家港 10.5 m 与南京 9.5 m，两卸港分别受限 |

## 目录结构

`client/src/lib/prestow/`：

| 文件 | 用途 |
| --- | --- |
| `types.ts` | 船舶、航次、货票、方案及结果类型 |
| `engine.ts` | 枚举组合、校验并求解预配载方案 |
| `intake.ts` | 求最大装载量与约束港口 |
| `consumption.ts` | 逐航段与在港油水消耗、ROB 推演 |
| `hydro-fast.ts` | 快速吃水与静水力估算 |
| `stability-fast.ts` | 快速稳性检查 |
| `strength-fast.ts` | 快速纵向强度检查 |
| `precise.ts` | 指定装载状态的精算复核 |
| `to-condition.ts` | 将方案和阶段转换为装载工况 |
| `rank.ts` | 方案排序 |
| `demo-ship.ts` | 将合成船适配为预配载船模 |
| `sample-ship.ts` | 测试与示例用船型 |
| `sample-voyage.ts` | 基础示例航次 |
| `sample-voyages.ts` | 六套示例航次与检索入口 |
| `sample-scenario.ts` | 可载入的示例邮件文本 |
| `product-catalog.ts` | 演示货物名称、分组及物性 |
| `mail-format.ts` | 格式化标准配载申请邮件 |
| `mail-parse.ts` | 按规则解析申请邮件 |
| `msg-import.ts` | 读取 Outlook .msg 邮件正文 |
| `download.ts` | 浏览器下载辅助 |
| `export/index.ts` | 导出 API 入口 |
| `export/generic-csv.ts` | 详细方案 CSV 导出 |
| `export/summary-csv.ts` | 方案摘要 CSV 导出 |
| `export/csv-util.ts` | CSV 字段转义与格式化 |
| `*.test.ts`、`__snapshots__/` | 引擎、邮件、导出及回归测试数据 |

`client/src/lib/hull/`、`loadcalc/`、`stability/`、`strength/`、`ballast/` 是合成船及通用计算库；`damage/`、`checks/` 提供相关校验；`shared/` 保存共享矩阵数据。`client/src/components/prestow/` 是预配载界面，`client/src/pages/Prestow.tsx` 组织页面，`client/src/main.tsx` 提供公开演示壳。`scripts/` 为演示邮件生成与清洗工具。

## 数据声明

船舶为虚构 MR 型油化船，静水力数据由参数化船体积分生成。港口吃水均为演示值；货物物性取自公开 MSDS / IBC 资料，用于教学示例，不构成实际货物认证数据。演示邮件署名为虚构公司。

## 文档索引

- [压载与纵倾实践](docs/research/2026-09-05-ballast-trim-practice.md)
- [航程油水消耗实践](docs/research/2026-09-05-voyage-consumption-practice.md)
- [航程油水消耗实现](docs/research/2026-09-05-voyage-consumption-implementation.md)
- [到港吃水与示例设计](docs/specs/2026-09-04-prestow-arrival-draft-samples-design.md)
- [邮件导入设计](docs/specs/2026-09-05-prestow-mail-import-design.md)
- [航程消耗设计](docs/specs/2026-09-05-prestow-voyage-consumption-design.md)
- [阶段卡片布局设计](docs/specs/2026-09-05-stage-card-layout-design.md)

## 许可与反馈

采用 [MIT 许可证](LICENSE)。反馈请提交 [GitHub Issues](https://github.com/zd1987722/chemical-tanker-prestow/issues)。
