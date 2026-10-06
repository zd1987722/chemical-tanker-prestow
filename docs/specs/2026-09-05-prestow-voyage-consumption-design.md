# 预配载 · 航程油水消耗、加油港与载重线季节区 设计(2026-09-05)

> 状态:已实施(2026-09-05),实施记录见 docs/research/2026-09-05-voyage-consumption-implementation.md。依据:`docs/research/2026-09-05-voyage-consumption-practice.md`。

## 0. 目标

预配载引擎把油水从「全航次固定重量」改为**逐港逐航段推演的消耗状态**,使:

1. 每港到港 / 离港的排水量、吃水、纵倾、GM 都反映途中燃油(主机 + 辅机 + 加温锅炉)、淡水(消耗 − 造水)的变化,以及停靠点的加油 / 加水;
2. 受限港「尽量多」的最大装载量自动计入到港前的油水消耗(大副「装到到港吃水」算法);
3. 每个停靠点可指定载重线季节区(夏 / 冬 / 热带),结构吃水上限按 ±1/48 夏季吃水调整;
4. 港序时间线显示 ETA/ETD、航段距离与航时、油水 ROB、消耗、燃油安全余量告警;
5. 邮件模板 / 解析、示例航次、CSV 导出、装载计算工况导出同步。

排除项见纪要 §5(洗舱 slop、UKC/潮汐、IBC 15.15 热膨胀、压载水置换、重天气压载)。所有数值为演示值。

## 1. 数据模型(`client/src/lib/prestow/types.ts`)

```ts
export type LoadLineZone = "summer" | "winter" | "tropical";
export interface PortCall {
  id; seq; port; berth; note?; maxDraftM?; waterDensity?;
  distanceNm?: number;      // 距上一停靠点海里;首港忽略;缺省 0(同港移泊)
  speedKn?: number;         // 本航段航速,缺省 constants.serviceSpeedKn
  portHours?: number;       // 港内停留小时;缺省按货操量估算(§3.3)
  bunkerMt?: number;        // 本港加油 t(离港前加入)
  freshWaterTakeMt?: number;// 本港加水 t
  loadLineZone?: LoadLineZone; // 缺省 summer
}
export interface VoyageConstants {
  ...现有字段(bunkersMt 语义改为「首港离港前燃油 ROB」,freshWaterMt 同理)...
  departureDate?: string;        // ISO 日期,仅用于 ETA/ETD 显示;缺省不显示日期,只显示 D+天数
  serviceSpeedKn?: number;       // 13
  seaMarginPct?: number;         // 8
  meSeaLadenTpd?: number;        // 22
  meSeaBallastTpd?: number;      // 19
  aeSeaTpd?: number;             // 3
  aePortTpd?: number;            // 4
  cargoOpsLoadTpd?: number;      // 2(装货期间附加)
  cargoOpsDischargeTpd?: number; // 6(卸货期间附加)
  heatingTpdPer1000t?: number;   // 0.5
  fwConsumptionTpd?: number;     // 4
  fwGeneratorSeaTpd?: number;    // 15
  cargoRateTph?: number;         // 500
  portFixedHours?: number;       // 6
  bunkerReserveDays?: number;    // 3
  bunkerCapacityMt?: number;     // 2000
  freshWaterCapacityMt?: number; // 450
}
export interface StageConsumables {
  legNm: number; legDays: number; portDays: number;
  etaDay: number; etdDay: number;          // 自首港离港起算的天数(首港 etaDay = 0,etdDay = portDays)
  legFuelMt: number; legFwMt: number;      // 航段消耗(淡水为净消耗,可为负 = 造水盈余)
  portFuelMt: number; portFwMt: number;    // 港内消耗
  bunkerMt: number; freshWaterTakeMt: number;
  arrival: { fuelMt: number; freshWaterMt: number };
  departure: { fuelMt: number; freshWaterMt: number };
  reserveMt: number;                       // 安全余量吨数 = bunkerReserveDays × (meSeaLaden + aeSea)
  warnings: string[];                      // 「到港燃油 ROB 低于安全余量」「燃油不足以到港(缺 N t)」「淡水不足(缺 N t)」「加油后超舱容」
}
export interface StageState { ...; consumables?: StageConsumables }
export interface StageFloating { ...; limitSource?: "port" | "ship" | "zone"; zone?: LoadLineZone }
export interface PlanScore { ...; minBunkerMarginMt?: number }   // 全航次最小(到港 ROB − reserveMt)
export interface StowPlan { ...; consumablesOk: boolean }         // 无「燃油不足以到港 / 淡水不足」即 true(低于余量只告警)
intakeSummary 项增加 consumptionCreditMt?: number                 // 见 §5
```

`DEFAULT_CONSTANTS` 补齐上述默认值。

## 2. 消耗推演(`client/src/lib/prestow/consumption.ts`,新)

```ts
export function simulateConsumables(ship: StowShip, voyage: StowVoyage, stages: Pick<StageState,"callId"|"tanks"|"totalWeight">[]): StageConsumables[];
export function zoneDraftLimit(summerDraftM: number, zone?: LoadLineZone): number; // winter: ×(1−1/48), tropical: ×(1+1/48), summer: 原值
export function heatedCargoTonnes(voyage, stage): number;   // 该阶段离港时舱内 heating.enabled 货物吨数
export function isLadenLeg(ship, stage): boolean;          // stage.totalWeight ≥ 10 % 舱容重量(沿用 §10 判定)
```

逐停靠点 i(按 seq):
- **航段**(i > 0):`legDays = distanceNm / (speedKn × 24) × (1 + seaMarginPct/100)`;`legFuel = (isLadenLeg(prev) ? meSeaLaden : meSeaBallast) + aeSea + heatingTpdPer1000t × heatedCargoTonnes(prev)/1000`,乘 legDays;`legFw = (fwConsumption − fwGeneratorSea) × legDays`(负值 = 造水盈余)。
- **到港 ROB**:`arrival.fuel = prev.departure.fuel − legFuel`;若 < 0 → warning「燃油不足以到港(缺 N t)」并置 0。`arrival.fw = clamp(prev.departure.fw − legFw, 0, freshWaterCapacity)`;若扣前 < 0 → warning「淡水不足(缺 N t)」。
- **港时**:`portHours = call.portHours ?? (装货吨 + 卸货吨) / cargoRateTph + portFixedHours`;装货吨 / 卸货吨由本阶段 tanks 与 prev tanks 差异得出(装 = 新增重量,卸 = 移除重量)。
- **港内消耗**:`portFuel = (aePort + (装货吨>0 ? cargoOpsLoad : 0) + (卸货吨>0 ? cargoOpsDischarge : 0) + heatingTpdPer1000t × 港内平均受热货/1000) × portDays`;港内受热货取到港与离港受热吨数的平均。`portFw = fwConsumption × portDays`(港内不造水)。
- **离港 ROB**:`departure.fuel = min(arrival.fuel − portFuel + bunkerMt, bunkerCapacity)`(超容 → warning「加油后超舱容,按舱容截断」;负值 → warning + 0);`departure.fw = clamp(arrival.fw − portFw + freshWaterTakeMt, 0, freshWaterCapacity)`。
- 首港:`arrival = { fuel: constants.bunkersMt, fw: constants.freshWaterMt }`,legNm/legDays/legFuel/legFw = 0,etaDay = 0。
- **余量**:`reserveMt = bunkerReserveDays × (meSeaLaden + aeSea)`;每个 i > 0 的到港若 `arrival.fuel < reserveMt` → warning「到港燃油 ROB N t 低于安全余量 M t」。
- `etaDay(i) = etdDay(i−1) + legDays`,`etdDay(i) = etaDay(i) + portDays`。

纯函数,不依赖浮态;`simulateStages` 先做货物状态,再调用它,把结果写进 `stage.consumables`。

## 3. 浮态接入

### 3.1 `engine.ts`
- `stageFloating(ship, voyage, stage, call, includeStrength, consumables?: { fuelMt; freshWaterMt })`:油水重量改用参数(缺省仍取 constants,保持旧调用兼容);LCG/VCG 仍用 `bunkersLcg/Vcg`、`freshWaterLcg/Vcg`(单点简化,纪要 §3 已说明)。
- `simulateStages`:先算全部阶段的货物状态与 `consumables`(§2),再算浮态:离港用 `stage.consumables.departure`,到港用 **本阶段** `consumables.arrival`(货物用上一阶段状态)。`needsArrival` 改为 `call.seq > 0` 恒成立(到港 GM 需校核);到港强度仍复用上一阶段离港值。
- 结构吃水上限:`shipLimit = zoneDraftLimit(ship.maxDraftM, call.loadLineZone)`;当 zone ≠ summer 且它成为限值来源时 `limitSource = "zone"`,`zone` 写入 floating。
- `checkPlan` / 方案 `stabilityOk`:到港 `stabilityPass` 也必须为真(若现有逻辑已含到港则不改)。`consumablesOk` = 所有阶段 warnings 中无「燃油不足以到港」「淡水不足」。`score.minBunkerMarginMt` = min(arrival.fuel − reserveMt)(i > 0)。排序(`rank.ts`):`consumablesOk` 为假的方案与稳性不合格同等排在最后;其余排序键不变。

### 3.2 `precise.ts`
- `fixedWeights(voyage, consumables?)`:油水重量按参数;`calculatePreciseFloating` 增加可选 `consumables` 参数并传给它。
- `precisePlanStages`:离港用 `stage.consumables.departure`,到港用 `stage.consumables.arrival`。
- `preciseArrivalDraft(ship, voyage, previousStage, call, consumables?)`:`intake.ts` 调用处从当前 `plan.stages` 找到 `call` 对应阶段的 `consumables.arrival` 传入。

### 3.3 `to-condition.ts`
`consumables(voyage)` 改为 `consumables(voyage, stage)`:用所选阶段 `consumables.departure`(缺省回落 constants),燃油先填 HFO2 再 HFO1,淡水 FW P/S 平分;规则不变。

## 4. 载重线季节区

- `zoneDraftLimit`:winter = summer × 47/48,tropical = summer × 49/48(演示船夏季结构吃水 13.0 m → 12.73 / 13.27)。
- 到港与离港各按本停靠点 zone;港口限值仍与之取小者。
- 时间线徽标:限值来源为 zone 时显示「冬季载重线 12.73」/「热带载重线 13.27」;`limitSource === "ship"` 仍显示「(结构)」。

## 5. 最大装载量的消耗计入

`solveIntake` 的 `marginAtCall` 走 `simulateStages`,消耗自动进入到港排水量,无需改搜索逻辑。新增说明字段:对每个 `intakeSummary` 项,`consumptionCreditMt` = 受限港(`limitedBy` 对应停靠点)到港时的油水 ROB 与首个装货港离港时 ROB 之差(`departure(first load call).fuel + fw − arrival(binding call).fuel − fw`,加油加水已包含在 ROB 内)。UI 文案:`受限于 张家港 到港吃水;到港前油水消耗 312 t 已计入可装量`。

## 6. UI

### 6.1 `VoyageForm.tsx`(停靠点行)
每个停靠点在「限吃水 / ρ」旁增加折叠的「航段」小行(与现有备注展开一致的样式):`距上港 nm` `航速 kn(可空)` `港时 h(可空)` `加油 t` `加水 t` `载重线区(夏/冬/热带 下拉)`。首港的距上港禁用。

### 6.2 `ConstantsPanel.tsx`
新增分组「航程消耗」:出发日期(date input)、航速、sea margin %、主机满载/压载 t/d、辅机海上/港内 t/d、装货/卸货附加 t/d、加温 t/d 每 1000 t、淡水消耗 t/d、造水 t/d、货操速率 t/h、港内固定 h、燃油余量天、燃油/淡水舱容。现有「燃油 吨」标签改为「首港燃油 ROB 吨」,「淡水 吨」改为「首港淡水 ROB 吨」。

### 6.3 `StageTimeline.tsx`
每站增加两行小字(`stow-stage-voyage`):
- 到港行:`ETA D+12.3(11-13)· 航段 1,260 nm / 4.0 d · 油耗 92 t · 到港 ROB 燃油 1,108 / 淡水 190`(有 departureDate 时括号显示月-日);
- 离港行:`ETD D+13.1 · 港内 19 h · 加油 +300 · 离港 ROB 燃油 1,392 / 淡水 176`。
warnings 以 `stow-stage-warn` 徽标显示(燃油余量橙色,燃油不足/淡水不足红色)。限值来源为 zone 的徽标见 §4。

### 6.4 `PlanDetail.tsx` 结论条
增加一行:`航程 11,940 nm · 41.5 d · 燃油消耗 1,012 t(最小到港余量 +86 t)· 淡水消耗 63 t`。`consumablesOk` 为假时结论条显示红色「油水不足」。

### 6.5 `PlanList.tsx`
方案表增加列「燃油余量」(minBunkerMarginMt,负值红色);`consumablesOk` 为假的方案默认与稳性/强度不合格一起隐藏(沿用 showRejected 开关)。

### 6.6 意向结果(`ParcelTable` 已显示 solvedIntake / intakeSummary)
按 §5 文案显示消耗计入。

## 7. 示例航次、邮件、导出

### 7.1 `sample-voyages.ts` / `sample-voyage.ts`(演示距离,海里,均标注为演示值)
- basic:L2 蔚山 7 号 2;D1 鹿特丹 10 600;D2 安特卫普 K1 90;D3 安特卫普 K4 2。
- far-east-europe-12:L2 2;L3 丽水 170;L4 大山 330;L5 宁波 500;D1 安特卫普 10 500;D2 鹿特丹 90;D3 汉堡 330。`constants.departureDate = "2026-11-01"`;L1–L4(蔚山、丽水、大山)`loadLineZone: "winter"`(北太平洋冬季季节区 10-16–04-15),L5 宁波 summer,D1–D3 winter(北大西洋冬季季节区 II 11-01–03-31)。
- split-loading-12:L2 丽水 170;L3 大山 330;L4 上海 480;L5 宁波 110;L6 高雄 470;D1 安特卫普 9 900;D2 鹿特丹 90。
- single-meoh-draft:D1 张家港 620。single-naoh-draft:D1 胡志明 2 300。single-benzene-two-ports:D1 张家港 520;D2 南京 120。
- 其余字段不填,走默认。`constants.bunkersMt` 保持 1 200(首港 ROB),far-east-europe-12 与 split-loading-12 在最后一个装港(宁波 / 高雄)`bunkerMt: 500`,示范加油港。

### 7.2 `mail-format.ts` / `mail-parse.ts`
- 港口行在现有段后追加(有值才写,顺序固定):`· 距上港 170 nm`、`· 航速 13 kn`、`· 港时 18 h`、`· 加油 500 t`、`· 加水 50 t`、`· 冬季区|热带区`(summer 不写)。
- 航次头部在「船舶:」后加 `出发日期: 2026-11-01`(有值才写);解析 `出发日期|Departure` 写入 `constants.departureDate`。解析器把上述段写回 PortCall;往返测试对 6 个预设仍需全等(含 constants.departureDate 与 bunkerMt)。
- 解析输出的 `voyage.constants` 仅在有 departureDate 时存在。

### 7.3 `export/*` CSV
方案 CSV 每阶段增加列:ETA 天、ETD 天、航段 nm、到港燃油 ROB、离港燃油 ROB、到港淡水 ROB、离港淡水 ROB、限值来源。快照按新输出更新(有意变更)。

## 8. 测试

- `consumption.test.ts`(新):
  1. 两港 1 260 nm、13 kn、sea margin 8 % → legDays 4.36;满载 ME 22 + AE 3 → legFuel 109.0;淡水净 (4−15)×4.36 = −48 → 到港淡水按舱容 450 截断。
  2. 加温:5 000 t 受热货 → +2.5 t/d。
  3. 港时估算:装 8 000 t / 500 t/h + 6 h = 22 h;`portHours` 显式值优先。
  4. 燃油不足:首港 ROB 300 t、航段需 400 t → warning 含「燃油不足以到港」且 `arrival.fuel === 0`;余量告警文案。
  5. 加油超容截断告警。
  6. `zoneDraftLimit(13, "winter") ≈ 12.729`,tropical ≈ 13.271。
- `engine.test.ts` 追加:far-east-europe-12 首个可行方案,安特卫普到港排水量 = 宁波离港排水量 − 航段燃油 − 淡水净消耗(±1 t,压载相同前提下比较「货物+油水」总和);到港 GM 小于离港 GM。
- `intake.test.ts` 追加:single-meoh-draft 在 `distanceNm = 620` 与 `distanceNm = 0` 两种设置下,最大装载量之差 ≈ 到港前油水消耗(±3 %)。
- `precise.test.ts`:precisePlanStages 到港/离港排水量差与 consumables 一致。
- `mail-format.test.ts` 往返仍全等;`export.test.ts` 快照更新;`pnpm check`、`pnpm vitest run` 全绿。

## 9. 交付顺序

2. Claude:审 diff → 重新生成 `.msg` → Playwright 冒烟(载入 far-east-europe-12,查看时间线 ETA/ROB 与冬季载重线徽标;single-meoh 意向结果显示消耗计入)→ 提交 → 部署。
