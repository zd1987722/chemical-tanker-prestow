# 预配载 · 到港吃水校核 + 结构吃水 + 示例航次库 · 设计 spec

日期:2026-09-04。范围:`client/src/lib/prestow/**`、`client/src/lib/hull/tables.ts`(toStowShip)、`client/src/components/prestow/{ParcelTable,StageTimeline,PlanDetail,PlanList}.tsx`、`client/src/pages/Prestow.tsx`。装载计算 `/demo/loadcalc` 不动。

## 背景

用户要求预设「五装三卸、用满 20 舱、10 种以上货物」与「单货、卸港吃水受限求最大装载量」的示例。核查引擎发现两处缺口,示例才有意义:

1. **卸港只校核离港吃水**。`simulateStages` 每个港口的 `stage.floating` 是该港作业完成后的状态;卸港的吃水限制对「到港」才有意义(满载抵港),现在永远不会卡住。基础示例 鹿特丹 11.8 m 实际到港 12.10 m 却判通过。
2. **没有船舶结构吃水上限**。单货「尽量多」时引擎给出 72 000 t 烧碱、吃水 18 m。装载计算侧已有 `DEMO_SHIP.scantlingDraft = 13`。

另外「尽量多」候选舱组只取 kMin / kMin+1 个舱,20 舱船只用 17 舱就报「舱容受限」。

## 1. 到港浮态 `StageState.arrival`

```ts
export interface StageState { callId; tanks; totalWeight; heelMomentTm; lcgM; floating?: StageFloating; arrival?: StageFloating }
export interface StageFloating { …; maxDraftM?: number; draftMargin?: number; limitSource?: "port" | "ship" }
```

- `simulateStages`:对 seq > 0 的每个港,在执行本港装卸**之前**,用上一港离港后的舱态 + 本港水密度 / 吃水限制调用 `stageFloating` 得到 `arrival`(第一港到港为空船,不算)。仅当本港有卸货(任一 parcel.dischargeCallId === call.id)或有吃水限制时才计算,否则 `arrival` 为 undefined(省时)。
- 新增纯函数 `stageDraftMargin(stage): number | undefined` = `min(arrival?.draftMargin, floating?.draftMargin)`(两者皆无为 undefined);`stageDraftExceeded(stage)`。
- 以下全部改用 `stageDraftMargin`:`engine.ts` 的 `acceptDraft`、`evaluatedPlans` 的 `limitedStages / firstExceeded / bindingStage`、`intake.ts` 的 `exceeded` 查找(第 138–147、276、379 行附近)、`rank.ts` 的 `margins`。
- `checkPlan` 校验器同样检查到港。

## 2. 结构吃水 `StowShip.maxDraftM`

- `StowShip` 增 `maxDraftM?: number`;`toStowShip()` 填 `DEMO_SHIP.scantlingDraft`;`SAMPLE_SHIP` 填 13。
- `stageFloating` 的有效限制 = `min(call.maxDraftM ?? ∞, ship.maxDraftM ?? ∞)`;`maxDraftM` 输出有效值,`limitSource` = 取到较小值的一方(`"port"` / `"ship"`);两者皆无则 `maxDraftM` undefined。
- 时间线「限」字段:港口限制显示 `限 11.80`,结构限制显示 `限 13.00(结构)`。

## 3. 「尽量多」候选舱组

- `intake.ts` 中对变量票货调用 `candidateGroups(prepared, ship, Infinity)` 后,追加一个「全部可用成对舱」组(所有同时可用的 P/S 对,k = 2 × 对数)和「全部可用舱」组(若与前者不同),`fillRatio` 按目标体积算(超过 0.98 × cap 时按 0.98 截断,目标体积由后续 shrink/grow 决定)。去重。
- 验收:单货甲醇无吃水限制时最大装载量 = 20 舱 × 0.98 × 0.79 ≈ 41 590 t(±1%),`limitedBy` 为「舱容」。

## 4. 示例航次库

`client/src/lib/prestow/sample-voyages.ts` 已写好(6 条,含原 `SAMPLE_VOYAGE`),不要改其数据(数量已按引擎调过);只允许改 `SAMPLE_VOYAGE`(sample-voyage.ts)的 D1 鹿特丹限制 11.8 → 12.3(到港 12.10 m 才能通过)。

- `ParcelTable` 的「载入示例航次」按钮改为 `<select className="stow-sample-select">`:第一项占位「载入示例航次…」,其余为 `SAMPLE_VOYAGES` 的 `title`;`title` 属性显示 `brief`;选中后与原按钮同样逻辑(setExpanded 清空、manualRows 设为 productId 为空的票、`onChange(structuredClone(entry.voyage))`),然后 select 复位到占位。
- `Prestow.tsx` 若在 URL 带 `?sample=<id>` 首次进入且本地无草稿(calls 为空),自动载入该示例(便于演示直达)。

## 5. 界面

- `StageTimeline`:有 `arrival` 时第二行改为两行:`到港 艏 x · 艉 y` / `离港 艏 x · 艉 y · 纵倾 z`;裕量取 `stageDraftMargin`;「吃水 超限 / 卡在此站」判定同样用它。
- `PlanDetail` 精算(`preciseByCall`):同样对有 `arrival` 的港计算精算到港浮态(用上一港精算后的舱态 + 本港 ρ);`timelineStages` 合并时 `draftMargin` 取 min;吃水结论卡显示「受限港 · 到港/离港」。
- `PlanList` 的 intakeSummary 已显示 `limitedBy`;吃水受限时文案为「受限于 张家港 到港吃水 10.50 m」(intake.ts `draftReason` 已有港名,追加「到港/离港」)。

## 验收

- 基础示例(12.3 m):有方案;鹿特丹到港 12.10、裕量 0.20,时间线显示到港/离港两行。
- `far-east-europe-12`:有方案,20 舱全用,安特卫普到港 12.37(裕量 0.13,标「卡在此站」)。
- `split-loading-12`:有方案,20 舱全用。
- `single-meoh-draft`:最大装载量 ≈ 让张家港到港最大吃水 = 10.50 m(淡水)的吨数,`limitedBy` 含「张家港 到港」;不再出现 11.8 m 到港判通过。
- `single-naoh-draft`:最大装载量受胡志明 9.5 m 限制,吃水 ≤ 9.5;任何阶段吃水 ≤ 13.0。
- `single-benzene-two-ports`:张家港到港 10.50 受限;南京 6 000 t 固定票到港 ≤ 9.5。
- 单货甲醇、无任何港口限制的临时用例:最大量 ≈ 41 590 t,限于结构吃水或舱容。
- `pnpm check`、`pnpm build`、`pnpm vitest run` 全绿;engine/intake 既有测试如因语义变化需改,只改断言不改被测逻辑之外的东西;新增测试:arrival 计算、stageDraftMargin、结构吃水生效、全舱候选组。

## 6. 性能(实施后补充,2026-09-04)

实测基础示例 `solvePrestow` 19 s:搜索阶段(`includeStrength=false`)仅 1.2 ms/方案,瓶颈是 `evaluatedPlans` 对每个方案(434 个)做完整强度计算 `fastStrength` ≈ 8 ms/阶段,到港阶段又多算一次。改:

1. **到港强度复用**:`simulateStages` 计算 `arrival` 时 `includeStrength=false`,然后把上一港 `floating` 的 `sfPct / bmPct / strengthPass` 复制到 `arrival`(到港舱态与上一港离港相同,仅水密度/压载微调,强度视为同值)。
2. **强度延迟校核**:`evaluatedPlans` 先全部按 `includeStrength=false` 模拟并排序(`comparePlans` 的 strengthOk 项此时按 true 处理),再对排序后前 `STRENGTH_CHECK_TOP = 60` 个方案重新 `simulateStages(…, true)` 并重排这 60 个;其余方案 `strengthChecked = false`(`StowPlan` 新增 `strengthChecked: boolean`,stages 的 sfPct/bmPct 为 0、strengthPass 为 true)。`solveIntake` 走同一路径(其最终 plan 数很少,全部校核即可)。
3. `PlanList` 行:`strengthChecked === false` 时强度徽标显示「强度 未校核」(mute);打开 `PlanDetail` 时精算已含强度,不需额外处理。
4. 验收:基础示例默认参数 `solvePrestow` ≤ 6 s(node 环境);`far-east-europe-12` ≤ 2 s;`single-benzene-two-ports` ≤ 8 s;测试全绿。

## 7. 「尽量多」精算收敛(实施后补充,2026-09-04)

问题:`solveIntake` 用快速引擎(`stageFloating`,近似压载/无横倾修正)把到港吃水卡到 10.50 m,但 `PlanDetail` 用精算(`autoBallast`)重算同一到港态得 10.93 m(苯两卸港示例:9P/9S 装不同票、横倾需压载纠正),方案详情页显示「吃水 超限 −0.43」,与「最大装载量」结论矛盾。

改:

1. 把 `PlanDetail.tsx` 的 `calculatePreciseFloating` 抽到 `client/src/lib/prestow/precise.ts`,导出 `precisePlanStages(ship, voyage, plan): Record<callId, PreciseStage>` 与 `preciseArrivalDraft(ship, voyage, stage, call): { draftAft, draftFwd, draftMargin }`;`PlanDetail` 改为调用它(行为不变)。
2. `intake.ts` 新增 `refineIntakePrecise(ship, voyage, plan, evaluate)`:`evaluate(stage, call) => number | undefined`(精算裕量,到港/离港取小)。对当前 plan 逐阶段调用 `evaluate`,若最小裕量 < −0.005 m,则对所有变量票货的 `fillRatio` 乘以缩放系数 s 做二分(s∈[0.90,1],最多 8 次,收敛条件 |裕量| ≤ 0.01 m 且 ≥ −0.005),每次用 `planFromAllocations` 重建 plan 并重算 intake;返回 `{ plan, intake, limitedBy }`,`limitedBy` 文案末尾加「(精算)」。固定票不动。若缩到 0.90 仍超限,返回 0.90 结果并在 `StowResult.message` 追加「精算后仍超限,请人工复核」。
3. `solveIntake` 末尾(最终方案确定后)调用 `refineIntakePrecise`,`evaluate` 由 `precise.ts` 提供(intake.ts 直接 import precise.ts,不经 UI)。只对最终 1–3 个方案做,精算每阶段 ≈ 40 ms。
4. 吃水徽标容差:`StageTimeline` 与 `PlanDetail` 的「超限」判定改为裕量 < −0.01 m;「卡在此站」为 −0.01 ≤ 裕量 ≤ 0.05。
5. 验收:三个单货示例在方案详情页时间线上,受限港到港裕量 ∈ [−0.01, 0.05],徽标「吃水 卡在此站」,无「超限」;最大装载量与详情页一致(苯两卸港:张家港票约 24 000–25 500 t);`pnpm vitest run` 全绿,新增 precise 收敛测试(苯示例:精算后受限港裕量 ≥ −0.01)。

## 8. 自动配平横倾修正过冲(实施后发现,2026-09-04)

现象:六装两卸示例第 3 港(9P 甲醇 + 7S 甲苯 单舷装载)精算 `autoBallast` 压载 14 191 t、横倾仍 1.18°,吃水 10.29 m(快速引擎 8.55 m)。
根因:`lib/ballast/auto-ballast.ts` 的 `heelCorrectedCandidate` 用「半舱液位的 tcg」当杠杆计算 P/S 转移量。J 形压载舱(双层底 + 翼舱)半舱时重心在双层底(WB1 tcg ≈ ∓5.7 m),而实际增减的水在翼舱(tcg ≈ ∓14 m),杠杆差 2.5 倍 → 修正过冲到反向 −1.9°,评分更差被弃;搜索转而靠加大总压载量(Δ、GM 变大)压小横倾角,得到 14 000 t 的病态解。

改(只改 `heelCorrectedCandidate`,不改搜索框架):
1. 用精确舱心求力矩:`momentOf(compId, weight) = weight × tankFill(compId, weight / ρ).tcg`;转移量 t 用二分求解 `Σ momentOf(new) − Σ momentOf(old) = −M`(t ∈ [0, min(对舷存量, 本舷余量)],20 次二分,误差 ≤ 1 t·m);若单靠转移不够,再对本舷「加注」、对舷「排出」各做同样的二分。
2. 修正后重新 `evaluateCandidate`(现有逻辑),`ok` 则返回。
3. 测试(`auto-ballast.test.ts` 新增):构造货舱 9P 2 000 t + 7S 2 600 t 的不对称工况,`autoBallast` 结果横倾 |heel| ≤ 0.5°,总压载 ≤ 7 000 t,纵倾 ∈ [0, 0.5];既有测试全绿。
4. 验收:`split-loading-12` 精算各阶段吃水与快速引擎相差 ≤ 0.6 m,方案详情时间线无「吃水 超限」。

## 9. 自动配平压载量二分细化 + 中途装货港纵倾窗口(2026-09-04)

- 已做(Claude):`engine.ts` 增 `isIntermediateLoadingCall / stageTrimTargets / INTERMEDIATE_TRIM_WINDOW = [-1.5, 2.5]`,快速与精算引擎对「之后还有装货港」的港口放宽纵倾窗口,不再为凑 0–0.5 m 中途注上万吨压载;精算与快速在中途港已一致(≤ 0.6 m)。
- 待做:`autoBallast` 主循环 `searchAmounts` 19 个等分点(满载船约 800 t 一档),找到第一个 `ok` 的压载量即返回,导致满载出港多压 2 000–3 000 t(六装两卸示例 L6:快速 2 183 t / 12.69 m,精算 5 458 t / 13.36 m > 结构 13.0)。改:找到首个 `ok` 量 A_k 后,在 (A_{k-1}, A_k] 上按同一分配流程二分 4 次取最小可行量(评估次数受 `MAX_EXACT_EVALUATIONS` 约束,不够则跳过细化);结果 `iterations` 累计。
- 验收:`.tmp/stow-precise.ts split-loading-12` 的 L6 精算压载 ≤ 3 500 t、吃水 ≤ 13.0;`far-east-europe-12` 的 D1 离港精算压载 ≤ 8 000 t;`auto-ballast.test.ts` 既有用例全绿,新增「最小可行压载量」用例(同一工况,细化后压载 ≤ 细化前)。

## 10. 压载与吃水差控制规则(2026-09-05,调研见 docs/research/2026-09-05-ballast-trim-practice.md)

用户反馈:空船应带压载、纵倾尽量小且 ≤ 2.5 m;货舱卸空后对应压载舱应注水。现状:`EMPTY_BALLAST_MIN = 10 000 t` 拍脑袋、中途港纵倾窗口 [−1.5, 2.5] 且目标取中点、压载舱选择不看与卸空货舱的邻接关系。

### 10.1 阶段类型与目标(`lib/prestow/engine.ts` 新 `stageBallastTargets(ship, voyage, stage, call)`,替代 `stageTrimTargets`)

```ts
export interface BallastTargets { trimMin: number; trimMax: number; trimTarget: number; dmMin?: number; draftFwdMin?: number; propellerImmersed: true; gmMin: 0.3; preferredUnits?: string[] }
```
| 阶段判定 | trim 窗口 | trimTarget | dmMin / draftFwdMin |
|---|---|---|---|
| 压载态:本阶段货重 < 10% × Σcap100 × 0.8 | [0.3, 2.5] | 1.0 | 2.0 + 0.02·LBP = 5.5 / 5.5 |
| 中途装货港离港(之后还有装货) | [−0.5, 2.5] | 0.5 | — |
| 卸港离港(之后还有卸货,且货重 ≥ 10%) | [0, 2.5] | 0.5 | — |
| 其余(满载离港、各卸港到港) | 航次常数 [trimTargetMin, trimTargetMax] | 中点 | — |

`preferredUnits`:卸港离港阶段 = 与本港卸空货舱(上一阶段有货、本阶段为 null)相邻的压载舱(`ship.ballast[].adjacentCargoTanks`),按其 WB 编号去重;其他阶段为空。

### 10.2 快速引擎 `fastAutoBallast` 与精算 `autoBallast` 共同改动(`lib/ballast/auto-ballast.ts`)

- `BallastTargets` 增 `trimTarget?`、`dmMin?`、`draftFwdMin?`、`propellerZTop?`(= 螺旋桨顶 z,默认取 `DEMO_SHIP.geometry.propeller`)、`preferredUnits?`。
- 可行判定 `isTargetMet` 增:dm ≥ dmMin、draftFwd ≥ draftFwdMin、draftAft ≥ propellerZTop(全浸);`violationScore` 相应加平方项。
- 删除 `EMPTY_BALLAST_MIN` 与 `weight < 25 000` 的硬编码,最小压载量改由 dm/draftFwd/螺旋桨约束自然给出。
- 目标纵倾用 `trimTarget`(不再取窗口中点);候选评分在可行集合内先比 |trim − trimTarget|(0.1 m 一档),再比压载量(取小)。
- `preferredUnits` 非空时 `allocateForMoment` 先按 preferred 顺序分配(同 "middle" 逻辑内排序把 preferred 放最前),不够再用其余舱。
- 二分细化(§9)保留。

### 10.3 时间线与校验

- `StageFloating` 增 `ballastRule?: { dmMin?: number; dm: number; draftFwdMin?: number; trimTarget: number; trimMin: number; trimMax: number; ok: boolean; notes: string[] }`;`checkPlan` 对压载态阶段校验 dm、艏吃水、螺旋桨、纵倾窗口。
- `StageTimeline` 第三行:压载态显示「dm 5.62 ≥ 5.5 · 纵倾 1.0/≤2.5」;不满足则徽标「压载 不足」(fail)。
- `PlanDetail` 精算同样输出 `ballastRule`;`ConstantsPanel` 加两项:`ballastTrimTarget`(默认 1.0)、`ballastTrimMax`(默认 2.5),写入 `VoyageConstants`。

### 10.4 验收(基础示例与 6 条示例库)

- 每条示例最后一港(卸完)离港:dm ≥ 5.5、艏吃水 ≥ 5.5、螺旋桨 100%、纵倾 ∈ [0.3, 2.5] 且 |trim − 1.0| ≤ 0.6;压载量 ≤ 16 000 t(螺旋桨顶 z 6.9 m 全浸 + 艏吃水 5.5 m 决定 dm ≈ 6.2 m,约 15 000 t;保留这两项硬约束,不放宽)。
- 六装两卸示例 D1(安特卫普,部分卸)离港:注入的压载舱中至少 2 个属于与本港卸空货舱相邻的 WB;纵倾 ∈ [0, 2.5]。
- 中途装货港离港纵倾 |trim| 平均值比现状(2.0 m 量级)下降到 ≤ 1.0 m。
- 快速与精算各阶段吃水差 ≤ 0.6 m 不退化;`pnpm vitest run` 全绿;新增 `ballast-rules.test.ts`。
