import { describe, expect, it } from "vitest";
import { computeCondition } from "../loadcalc/engine";
import { exportConditionJson, importConditionJson } from "../loadcalc/io";
import { parseConditions, serializeConditions } from "../loadcalc/storage";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { simulateStages } from "./engine";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { allocationHistory, planStageViews } from "./stage-view";
import { stageViewToCondition } from "./to-condition";
import type { Allocation, StowPlan, StowVoyage } from "./types";

const voyage: StowVoyage = {
  shipId: DEMO_STOW_SHIP.id, voyageNo: "REUSE",
  calls: [
    { id: "load", seq: 0, port: "装港", berth: "A" },
    { id: "swap", seq: 1, port: "换货港", berth: "B", bunkerMt: 20, maxDraftM: 10.5, waterDensity: 1 },
    { id: "finish", seq: 2, port: "卸港", berth: "C" },
  ],
  parcels: [
    { ...SAMPLE_VOYAGE.parcels[0], id: "old", display: "旧票", loadCallId: "load", dischargeCallId: "swap" },
    { ...SAMPLE_VOYAGE.parcels[0], id: "new", display: "新票", loadCallId: "swap", dischargeCallId: "finish" },
  ],
};
const allocations: Allocation[] = [
  { parcelId: "new", tanks: ["1P"], fillRatio: 0.4 },
  { parcelId: "old", tanks: ["1P"], fillRatio: 0.6 },
];
const stages = simulateStages(DEMO_STOW_SHIP, voyage, allocations, false);
const plan: StowPlan = {
  key: "reuse", allocations, stages, advisories: [], consumablesOk: true, stabilityOk: true, strengthOk: true, strengthChecked: false,
  score: { tanksUsed: 1, unpairedTanks: 1, maxHeelMoment: 0, maxLcgShift: 0, advisoryCount: 0, minGm: 0, maxBmPct: 0 },
};

describe("统一离港展示与承接", () => {
  it("未精算的来源明确，到港重载和离港卸空各保留自己的数据", () => {
    const view = planStageViews(plan, {}).finish;
    expect(view).toMatchObject({ planKey: "reuse", callId: "finish", phase: "departure", calculationSource: "estimate" });
    expect(view.stage.arrival!.displacement).toBeGreaterThan(0);
    expect(view.stage.totalWeight).toBe(0);
    expect(view.stage.tanks["1P"]).toBeNull();
    expect(view.stage.emptiedCargoTanks).toContain("1P");
    expect(view.precise).toBeUndefined();
  });

  it("精算压载供舱图和装载计算共同使用，保留方案初筛判定", () => {
    const original = plan.stages[1].floating!;
    const calculated = { ...original, draftMargin: 0.123, draftFwd: 7.12, gmCorrected: 1.23, ballastTanks: [{ id: "WB1P", pct: 17, weight: 123 }], ok: true, notes: [] };
    const view = planStageViews(plan, { swap: { floating: calculated } }).swap;
    expect(view.calculationSource).toBe("precise");
    expect(view.stage.floating).toMatchObject({ draftMargin: 0.123, draftFwd: 7.12, gmCorrected: 1.23, approx: false, strengthChecked: false });
    expect(view.stage.floating!.ballastTanks).toBe(calculated.ballastTanks);
    expect(plan.stages[1].floating).toBe(original);
    expect(original.draftFwd).not.toBe(7.12);
    const condition = stageViewToCondition(DEMO_STOW_SHIP, voyage, view, "换货港离港");
    expect(condition.note).toContain("离港 / 作业后 · 精算");
    const computed = computeCondition(condition);
    expect(computed.tanks.find(tank => tank.compId === "WB1P")!.fillPct).toBeCloseTo(17, 3);
    expect(computed.tanks.filter(tank => /^HFO/.test(tank.compId)).reduce((sum, tank) => sum + tank.weight, 0)).toBeCloseTo(view.stage.consumables!.departure.fuelMt, 3);
    expect(computed.tanks.find(tank => tank.compId === "1P")!.weight).toBeCloseTo(view.stage.tanks["1P"]!.weight, 3);
    expect(condition.tanks.filter(tank => tank.compId === "1P")).toHaveLength(1);
    expect(condition.tanks.find(tank => tank.compId === "1P")!.cargoName).toBe("新票");
  });

  it("离港卸空送到装载计算不带入到港货物", () => {
    const condition = stageViewToCondition(DEMO_STOW_SHIP, voyage, planStageViews(plan, {}).finish, "卸空");
    expect(condition.tanks.some(tank => tank.compId === "1P")).toBe(false);
    expect(condition.note).toContain("估算");
  });

  it("港口、泊位、港限和水密度随工况保存及导入导出", () => {
    const condition = stageViewToCondition(DEMO_STOW_SHIP, voyage, planStageViews(plan, {}).swap, "换货港离港");
    expect(condition.port).toEqual({ name: "换货港 · B", maxDraft: 10.5, density: 1 });
    expect(parseConditions(serializeConditions([condition]))[0].port).toEqual(condition.port);
    expect(importConditionJson(exportConditionJson(condition)).port).toEqual(condition.port);
  });

  it("导入拒绝损坏的港口快照，旧工况不带快照仍兼容", () => {
    const condition = stageViewToCondition(DEMO_STOW_SHIP, voyage, planStageViews(plan, {}).swap, "换货港离港");
    expect(() => importConditionJson(JSON.stringify({ ...condition, port: { name: "坏港", density: 0 } }))).toThrow();
    expect(importConditionJson(JSON.stringify({ ...condition, port: undefined })).port).toBeUndefined();
  });

  it("同港卸旧装新保留新票；数组顺序不影响复用的判断", () => {
    expect(stages[0].tanks["1P"]!.parcelId).toBe("old");
    expect(stages[1].tanks["1P"]!.parcelId).toBe("new");
    const history = allocationHistory(allocations, voyage);
    expect(history.conflict).toBe(false);
    expect(history.ordered.map(allocation => allocation.parcelId)).toEqual(["old", "new"]);
  });

  it("占用港序真正重叠时标冲突，单票不误报", () => {
    const overlapping = structuredClone(voyage);
    overlapping.parcels[0].dischargeCallId = "finish";
    expect(allocationHistory(allocations, overlapping).conflict).toBe(true);
    expect(allocationHistory(allocations.slice(0, 1), overlapping).conflict).toBe(false);
  });
});
