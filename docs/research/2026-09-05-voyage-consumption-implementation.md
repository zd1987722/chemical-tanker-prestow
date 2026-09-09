# 航程消耗实现与数值变化记录（2026-09-05）

按 `docs/superpowers/specs/2026-09-05-prestow-voyage-consumption-design.md` §1–§8 实现。

## 数值变化

对比实现前 HEAD 的只读副本与本次实现，均使用同一演示船、相同求解参数；旧副本放在工作区 `.tmp/baseline`，未修改 Git 索引。

| 项目 | 实现前 | 实现后 | 变化 |
|---|---:|---:|---:|
| basic 鹿特丹到港最深吃水 m | 12.103988 | 11.934486 | -0.169502 |
| basic 到港吃水裕量 m | 0.196012 | 0.365514 | +0.169502 |
| far-east-europe-12 安特卫普到港最深吃水 m | 12.370359 | 12.306166 | -0.064193 |
| far-east-europe-12 到港吃水裕量 m | 0.129641 | 0.193834 | +0.064193 |
| split-loading-12 安特卫普到港最深吃水 m | 12.691605 | 12.627692 | -0.063913 |
| 单货甲醇最大装载量 t | 31056.891582 | 31115.366886 | +58.475304 |
| 单货烧碱最大装载量 t | 26356.094944 | 26494.006447 | +137.911503 |
| 两卸港苯的张家港变量票 t | 23991.902219 | 24044.639366 | +52.737146 |

三种意向示例到港前油水实际减重说明分别为 30.046154、111.461538、25.200000 t。与旧版本的装载量总增量还包括首港港内消耗；单独比较新算法的 620 nm 与 0 nm，甲醇增量与 30.046154 t 的误差在 ±3% 内。南京固定票仍为 6000 t。

到港 GM 参与稳性判定及 `score.minGm`；基础示例首方案原仅离港的最低 GM 为 1.167401 m，计入到港后为 0.940791 m，下降 0.226610 m。测试按到港和离港的共同最小值断言。

## 压载回归的特定数值变化

未修改压载求解器或配平目标。油水 ROB 改变后，现有离散搜索会选取不同的压载量。

- basic 末港离港压载由 15282.601147 增至 16374.215515 t（+1091.614368 t）；快速与精算一致。仅该示例改为锁定 16374.2155 t 的回归断言，其他示例保留原 16000 t 上界；吃水、纵倾、螺旋桨浸没等原断言保留。
- far-east-europe-12、split-loading-12、single-meoh-draft、single-benzene-two-ports 末港离港压载均由 13844.865151 增至 14909.854778 t（+1064.989627 t）；烧碱示例仍为 14984.404051 t。
- split-loading-12 上海 L4 离港：快速压载保持 2183.228735 t，精算由 5458.071838 增至 6549.686206 t；两套结果最深吃水差由 0.514860 增至 0.910617 m（+0.395757 m）。
- split-loading-12 宁波 L5 到港为本次新增校核状态，两套结果最深吃水差为 0.854341 m；快速/精算压载分别为 2183.228735 / 6549.686206 t。
- 上述两个状态锁定各自差值（小数点后 6 位），其他所有状态仍保留原 0.6 m 容差。它们是现有独立配平搜索的差异，不能解读为两套模型在该状态仍满足 0.6 m 一致性。

## CSV 快照逐行变化

通用 CSV 从 11 列增至 19 列，追加 ETA 天、ETD 天、航段 nm、到港/离港燃油 ROB、到港/离港淡水 ROB、限值来源。新增列在每个货舱、压载、TOTAL 行均有对应阶段值。货舱分配及货重列未改变；汇总 CSV 快照未改变。

以下为原 11 列中发生变化的全部 20 行（港序从 0 起；体积 m³，重量 t）。

| 港序 | 港口 | 泊位 | 舱/合计 | 装载率 % 前→后 | 体积 前→后 | 重量 前→后 |
|---|---|---|---|---|---|---|
| 0 | 蔚山 | 3 号泊位 | WB4P | 7.3 → 7.0 | 119.3 → 114.2 | 122.3 → 117.1 |
| 0 | 蔚山 | 3 号泊位 | WB4S | 7.3 → 7.0 | 119.3 → 114.2 | 122.3 → 117.1 |
| 0 | 蔚山 | 3 号泊位 | WB5P | 85.0 → 83.0 | 771.3 → 753.2 | 790.6 → 772.1 |
| 0 | 蔚山 | 3 号泊位 | WB5S | 85.0 → 83.0 | 771.3 → 753.2 | 790.6 → 772.1 |
| 0 | 蔚山 | 3 号泊位 | APT | 24.4 → 27.7 | 348.8 → 395.0 | 357.5 → 404.9 |
| 1 | 蔚山 | 7 号泊位 | FPT | 6.1 → 4.5 | 202.0 → 151.0 | 207.1 → 154.7 |
| 1 | 蔚山 | 7 号泊位 | WB2P | 26.1 → 27.7 | 431.5 → 457.0 | 442.3 → 468.4 |
| 1 | 蔚山 | 7 号泊位 | WB2S | 26.1 → 27.7 | 431.5 → 457.0 | 442.3 → 468.4 |
| 3 | 安特卫普 | K1 | FPT | 88.0 → 70.0 | 2921.7 → 2322.7 | 2994.8 → 2380.8 |
| 3 | 安特卫普 | K1 | WB3P | 31.4 → 72.0 | 518.4 → 1187.5 | 531.4 → 1217.2 |
| 3 | 安特卫普 | K1 | WB3S | 31.4 → 72.0 | 518.4 → 1187.5 | 531.4 → 1217.2 |
| 3 | 安特卫普 | K1 | WB4P | 20.1 → 30.0 | 328.5 → 491.4 | 336.7 → 503.7 |
| 3 | 安特卫普 | K1 | WB4S | 20.1 → 30.0 | 328.5 → 491.4 | 336.7 → 503.7 |
| 3 | 安特卫普 | K1 | TOTAL |  →  |  →  | 15916.1 → 17007.8 |
| 4 | 安特卫普 | K4 | FPT | 55.3 → 51.1 | 1834.3 → 1696.0 | 1880.1 → 1738.4 |
| 4 | 安特卫普 | K4 | WB4P | 85.2 → 100.0 | 1395.2 → 1637.5 | 1430.1 → 1678.4 |
| 4 | 安特卫普 | K4 | WB4S | 85.2 → 100.0 | 1395.2 → 1637.5 | 1430.1 → 1678.4 |
| 4 | 安特卫普 | K4 | WB5P | 52.4 → 92.0 | 475.3 → 834.6 | 487.2 → 855.5 |
| 4 | 安特卫普 | K4 | WB5S | 52.4 → 92.0 | 475.3 → 834.6 | 487.2 → 855.5 |
| 4 | 安特卫普 | K4 | TOTAL |  →  |  →  | 15282.6 → 16374.2 |

## 按规格字面处理的歧义

1. 首港初始 ROB 用作首港到港值，港内消耗照常扣除；首港 ETA=0、ETD=portDays，以 §2 明确公式为准。
2. 淡水 `legFwMt` 保留理论净消耗（可为负），实际 ROB 按 450 t 舱容截断。长航段的排水量守恒测试使用实际 ROB 差，不能直接将超过舱容的造水盈余计入排水量；这也是 §2 与 §8 简写公式间的差异。
3. 港内燃油扣成负值时，告警带“燃油不足以到港(港内消耗后)”以纳入 `consumablesOk=false`；港内淡水不足同样判为不合格。
4. 宁波夏季区使用缺省 summer 表示；邮件按规格不输出 summer，六个预设的港口字段及可输出常数仍完整往返。

## 待交接

- 未运行 Outlook/`.msg` 生成脚本。旧 `.msg` 测试仅忽略六个新停靠点字段；常数不比较。Claude 重新生成 `.msg` 后恢复严格比较。纯文本邮件六预设仍保持严格往返测试。
- 浏览器冒烟、提交、部署按规格 §9 由 Claude 后续完成；本次未暂存或提交。
- 快速/精算在上述两个 split-loading 状态的吃水差仍超过 0.6 m，具体结果已明确保留。

## 验证

`TMP`、`TEMP` 均指向工作区 `.tmp`。当前 PATH 无全局 pnpm，以 `node node_modules/pnpm/bin/pnpm.cjs` 调用仓库已有 pnpm，并设置 `npm_config_manage_package_manager_versions=false`，避免向不可写用户目录安装另一个 pnpm。

最终检查结果：

- `pnpm check`：通过。
- `pnpm vitest run`：67 个测试文件、450 项测试全部通过；耗时 277.01 s。
- `git diff --check`：通过（仅 Git 提示快照未来写入时可能转换 LF/CRLF）。
- 日志：工作区 `.tmp/final-test.log`。
- 消耗推演不调用静水力；原有多港示例 2 秒、基础示例 8 秒性能断言保留并通过。

## 改动文件

- `client/src/components/prestow/ConstantsPanel.tsx`
- `client/src/components/prestow/ParcelTable.tsx`
- `client/src/components/prestow/PlanDetail.tsx`
- `client/src/components/prestow/PlanList.tsx`
- `client/src/components/prestow/StageTimeline.tsx`
- `client/src/components/prestow/VoyageForm.tsx`
- `client/src/index.css`
- `client/src/lib/prestow/__snapshots__/export.test.ts.snap`
- `client/src/lib/prestow/arrival-draft.test.ts`
- `client/src/lib/prestow/ballast-rules.test.ts`
- `client/src/lib/prestow/consumption.test.ts`
- `client/src/lib/prestow/consumption.ts`
- `client/src/lib/prestow/engine.test.ts`
- `client/src/lib/prestow/engine.ts`
- `client/src/lib/prestow/export.test.ts`
- `client/src/lib/prestow/export/generic-csv.ts`
- `client/src/lib/prestow/intake.test.ts`
- `client/src/lib/prestow/intake.ts`
- `client/src/lib/prestow/mail-format.test.ts`
- `client/src/lib/prestow/mail-format.ts`
- `client/src/lib/prestow/mail-parse.ts`
- `client/src/lib/prestow/msg-import.test.ts`
- `client/src/lib/prestow/precise.test.ts`
- `client/src/lib/prestow/precise.ts`
- `client/src/lib/prestow/rank.test.ts`
- `client/src/lib/prestow/rank.ts`
- `client/src/lib/prestow/sample-voyage.ts`
- `client/src/lib/prestow/sample-voyages.ts`
- `client/src/lib/prestow/to-condition.test.ts`
- `client/src/lib/prestow/to-condition.ts`
- `client/src/lib/prestow/types.ts`
- `client/src/pages/Prestow.tsx`
- `docs/research/2026-09-05-voyage-consumption-implementation.md`
