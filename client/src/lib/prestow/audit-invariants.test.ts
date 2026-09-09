/**
 * 2026-09-06 全盘审核后补的不变量回归(审核报告 docs/research/2026-09-06-full-audit,条目 E1/E3/E5/S8)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetRuntimeExceptionsForTest, setRuntimeExceptions } from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { checkPlan, planFeasible, simulateStages, solvePrestow, validateVoyage } from "./engine";
import { refineIntakePrecise } from "./intake";
import { fastStability } from "./stability-fast";
import { csvCell } from "./export/csv-util";
import type { Allocation, Parcel, PortCall, StowPlan, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

const CALLS: PortCall[] = [
  { id: "L1", seq: 0, port: "Ulsan", berth: "B3" },
  { id: "D1", seq: 1, port: "Rotterdam", berth: "Botlek 1", maxDraftM: 11.8 },
];
const parcel = (over: Partial<Parcel>): Parcel => ({
  id: "p", productId: null, name: "TEST", display: "TEST", group: 20, quantityMt: 2000, density: 0.8,
  loadCallId: "L1", dischargeCallId: "D1", heating: { enabled: false },
  boilPointC: 100, meltPointC: -50, polymerizable: false, maxAllowedTempC: null, ...over,
});
const voyageOf = (parcels: Parcel[], calls = CALLS, constants?: StowVoyage["constants"]): StowVoyage =>
  ({ shipId: DEMO_STOW_SHIP.id, voyageNo: "AUDIT", calls, parcels, constants });

describe("E3 快速稳性对左右舷镜像对称", () => {
  it("TCG ±0.5 m 得到相同判定与相同曲线", () => {
    const port = fastStability(50_000, 11.3, -0.5, 1.025);
    const starboard = fastStability(50_000, 11.3, 0.5, 1.025);
    expect(port.pass).toBe(starboard.pass);
    expect(port.curve.map(p => p.gz)).toEqual(starboard.curve.map(p => p.gz));
    // 有横向偏移时的曲线不高于无偏移曲线(取不利侧)
    const centred = fastStability(50_000, 11.3, 0, 1.025);
    port.curve.forEach((point, index) => expect(point.gz).toBeLessThanOrEqual(centred.curve[index].gz + 1e-12));
  });
});

describe("E5 输入不变量", () => {
  it("Infinity 密度 / 0 航速 / 重复 ID / 非法水密度 不能通过校验", () => {
    const ship = DEMO_STOW_SHIP;
    expect(validateVoyage(ship, voyageOf([parcel({ density: Infinity })]))).toContainEqual(expect.stringContaining("密度"));
    expect(validateVoyage(ship, voyageOf([parcel({ quantityMt: Number.NaN })]))).toContainEqual(expect.stringContaining("数量"));
    expect(validateVoyage(ship, voyageOf([parcel({})], CALLS, { serviceSpeedKn: 0 }))).toContainEqual(expect.stringContaining("serviceSpeedKn"));
    expect(validateVoyage(ship, voyageOf([parcel({ id: "a" }), parcel({ id: "a" })]))).toContainEqual(expect.stringContaining("ID 重复"));
    expect(validateVoyage(ship, voyageOf([parcel({})], [CALLS[0], { ...CALLS[1], waterDensity: 1.3 }]))).toContainEqual(expect.stringContaining("水密度"));
    expect(validateVoyage(ship, voyageOf([parcel({})], [CALLS[0], { ...CALLS[1], speedKn: 0 }]))).toContainEqual(expect.stringContaining("航速"));
    expect(validateVoyage(ship, voyageOf([parcel({ quantityMt: 0, intake: { mode: "range", minMt: 3000, maxMt: 2000 } })]))).toContainEqual(expect.stringContaining("最低吨数大于最高吨数"));
    const result = solvePrestow(ship, voyageOf([parcel({ density: Infinity })]));
    expect(result.status).toBe("invalid");
    expect(validateVoyage(ship, voyageOf([parcel({})]))).toEqual([]);
  });

  it("独立校验器发现漏票、空舱组与吨数不守恒", () => {
    const ship = DEMO_STOW_SHIP;
    const voyage = voyageOf([parcel({ id: "a" }), parcel({ id: "b" })]);
    const result = solvePrestow(ship, voyage, { limit: 20_000, maxPlans: 1 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    const plan = result.plans[0];
    expect(checkPlan(ship, voyage, plan)).toEqual([]);
    expect(checkPlan(ship, voyage, { ...plan, allocations: [] })).toEqual(expect.arrayContaining([
      expect.stringContaining("a 未分配舱位"), expect.stringContaining("b 未分配舱位"),
    ]));
    const half = plan.allocations.map((a, index) => index === 0 ? { ...a, fillRatio: a.fillRatio / 2 } : a);
    expect(checkPlan(ship, voyage, { ...plan, allocations: half })).toContainEqual(expect.stringContaining("不符"));
    const empty = plan.allocations.map((a, index) => index === 0 ? { ...a, tanks: [] } : a);
    expect(checkPlan(ship, voyage, { ...plan, allocations: empty })).toContainEqual(expect.stringContaining("舱组为空"));
  });
});

describe("E1 精算收缩不突破最低吨数,且按优先级分层", () => {
  const fixture = () => {
    const parcels = [
      parcel({ id: "fixed", density: 1, quantityMt: 3000 }),
      parcel({ id: "low", density: 0.8, quantityMt: 0, intake: { mode: "priority", priority: 2 } }),
      parcel({ id: "high", density: 0.8, quantityMt: 0, intake: { mode: "range", minMt: 1000, maxMt: 1000 } }),
    ];
    const voyage = voyageOf(parcels);
    const allocations: Allocation[] = [
      { parcelId: "fixed", tanks: ["1P"], fillRatio: 0.9 },
      { parcelId: "low", tanks: ["2P", "2S"], fillRatio: 0.8 },
      { parcelId: "high", tanks: ["3P"], fillRatio: 1000 / (DEMO_STOW_SHIP.tanks.find(t => t.id === "3P")!.cap100 * 0.8) },
    ];
    const stages = simulateStages(DEMO_STOW_SHIP, voyage, allocations, false);
    const plan: StowPlan = {
      key: "audit", allocations, stages, advisories: [],
      score: { tanksUsed: 4, unpairedTanks: 2, maxHeelMoment: 0, maxLcgShift: 0, advisoryCount: 0, minGm: 0, maxBmPct: 0 },
      consumablesOk: true, draftOk: true, stabilityOk: true, strengthOk: true, strengthChecked: false,
    };
    return { voyage, plan, stages };
  };

  it("range 票 min=max=1000 时不会被缩到 950", () => {
    const { voyage, plan, stages } = fixture();
    const total = stages[0].totalWeight;
    // 人工裕量评估器:要求总重减少 200 t 才可行
    const refined = refineIntakePrecise(DEMO_STOW_SHIP, voyage, plan, stage => (total - 200 - stage.totalWeight) / 1000);
    expect(refined.intake.high).toBeCloseTo(1000, 3);
    expect(refined.intake.low).toBeLessThan(stages[0].tanks["2P"]!.weight * 2);
    expect(refined.plan.draftOk).toBe(true);
    expect(planFeasible(refined.plan)).toBe(true);
    expect(refined.limitedBy.low).toMatch(/精算/);
    expect(refined.limitedBy.high).toBeUndefined();
  });

  it("低优先级票减到底仍超限时才动更高层;全部到底仍超限则方案标记不可行", () => {
    const { voyage, plan, stages } = fixture();
    const total = stages[0].totalWeight;
    const lowWeight = stages[0].tanks["2P"]!.weight * 2;
    // 需要减掉比 low 票总重还多 500 t:low 减到 0 后 high 也不能再减(min 1000)→ 仍超限
    const refined = refineIntakePrecise(DEMO_STOW_SHIP, voyage, plan, stage => (total - lowWeight - 500 - stage.totalWeight) / 1000);
    expect(refined.intake.low).toBeCloseTo(0, 3);
    expect(refined.intake.high).toBeCloseTo(1000, 3);
    expect(refined.plan.draftOk).toBe(false);
    expect(planFeasible(refined.plan)).toBe(false);
  });
});

describe("S8 CSV 公式注入", () => {
  it("以 = + @ 开头的文本前置单引号,负数与数字串保持原样", () => {
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("+HYPERLINK(1)")).toBe("\"'+HYPERLINK(1)\"");
    expect(csvCell("@cmd")).toBe("\"'@cmd\"");
    expect(csvCell("-3.2")).toBe("-3.2");
    expect(csvCell(-3.2)).toBe("-3.2");
    expect(csvCell("Methanol")).toBe("Methanol");
    expect(csvCell("a,b")).toBe("\"a,b\"");
  });
});
