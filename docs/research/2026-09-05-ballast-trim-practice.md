# 压载与吃水差控制 · 调研纪要(2026-09-05)

目的:为预配载 / 装载计算 Demo 的自动压载逻辑定规则——空船(压载航次)、装货中途、卸货过程中的吃水与纵倾控制。

## 1. 规则性依据

### MARPOL Annex I 第 18 条(专用压载舱 SBT 条件)
适用:≥ 20 000 DWT 原油船、≥ 30 000 DWT 成品油船;油品/化学品兼装船按 Annex I 管理。要求「在航次任何阶段的任何压载状态」,仅靠轻船 + 专用压载即满足:
- 舯部型吃水 **dm ≥ 2.0 + 0.02 L**(m);
- 艏艉吃水由 dm 与**尾倾 ≤ 0.015 L** 决定;
- 艉吃水在任何情况下 ≥ 螺旋桨**全浸**所需。

对 L = 175 m 的演示船:dm ≥ 5.5 m,尾倾 ≤ 2.625 m。用户经验值「尽量小、不超过 2.5 m」与之一致(取 2.5 作为硬上限)。

### 其他常用经验值
- 压载航次设计纵倾:多数船 0.5–1.2 m 尾倾,手感好、螺旋桨与舵效好;过大尾倾增加首部砰击与阻力。
- 首吃水下限(防砰击):行业经验 0.02 L + 2(演示船已有 `minForwardDraft = 5.5 m`,与 dm 规则同量级)。
- 重天气压载:在轻压载基础上再加深(演示不做)。

## 2. 作业实践(卸货 / 装货过程)

- **卸货同时压载**:大副的卸货计划里把压载注入序列与卸货顺序绑定,目标是全过程吃水、纵倾、剪力弯矩、稳性都在装载仪允许范围内;卸货期间保持**轻微尾倾**。
- **注入哪些舱**:通常是**与刚卸空货舱相邻的翼压载舱 / 双层底**——补偿局部浮力损失,控制剪力弯矩和纵倾,顺带保持吃水以便靠泊、避免首部出水。
- **阀门顺序**:先压载后开货舱(保持自由液面修正、避免瞬时负 GM),先压后卸。
- **装货过程相反**:随货物装入按序排出压载,离港时压载舱基本排空(只留调纵倾/横倾所需)。
- 若终端给的序列导致稳性或应力超限,应即时提出修改。

## 3. 落地到引擎的规则(见 spec §10)

| 阶段 | 纵倾窗口 (m, 尾倾为正) | 目标 | 其他硬约束 |
|---|---|---|---|
| 空船 / 压载航段(货重 < 10% 舱容重量) | [0.3, 2.5] | 1.0 | dm ≥ 5.5;艏吃水 ≥ 5.5;螺旋桨全浸;GM ≥ 0.3 |
| 中途装货港离港 | [−0.5, 2.5] | 0.5 | 螺旋桨全浸;GM ≥ 0.3 |
| 满载离港 / 卸港到港 | [0, 0.5](可由航次常数改) | 0.25 | 港口 / 结构吃水 |
| 卸港离港(部分卸) | [0, 2.5] | 0.5 | dm ≥ 5.5 若货重 < 10%;优先注入与刚卸空货舱相邻的翼压载舱 |

优化顺序:先满足硬约束 → 纵倾尽量接近目标 → 压载量尽量少。

## 来源
- MARPOL Annex I Reg. 18(imorules.com 条文):https://imorules.com/MARPOL_ANNI_REG4.A.18.html
- MarineGyaan · SBT 规定摘要:https://marinegyaan.com/what-is-regulations-for-segregated-ballast-tanks-on-ship-as-per-marpol/
- UK MSN 1643 / MARPOL 1:https://assets.publishing.service.gov.uk/media/5a7b911be5274a7318b8f808/msn1643.pdf
- Knowledge of Sea · Discharging cargo(卸货同时压载、尾倾):https://knowledgeofsea.com/discharging-cargo/
- Britannia P&I · Ballast tank operation practice:https://britanniapandi.com/2023/07/ballast-operation-and-maintenance-practice/
- Marine Public · Trim your ship right(设计纵倾 0.5–1.2 m):https://www.marinepublic.com/blogs/training/714907-trim-your-ship-right-boost-performance-safety-efficiency
- ScienceDirect · Forward draft & slamming:https://www.sciencedirect.com/topics/engineering/forward-draft
- ABS · Ballast water exchange procedures(压载航次约束):https://ww2.eagle.org/content/dam/eagle/rules-and-guides/current/other/18_ballastwaterexchangeprocedures/pub18_ballastwater_op.pdf
