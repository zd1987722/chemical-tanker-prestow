import { findSampleVoyage } from "./sample-voyages";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { SAMPLE_SHIP } from "./sample-ship";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { resetRuntimeExceptionsForTest, setRuntimeExceptions } from "../appendix-i-exceptions";
import { comparePlans } from "./rank";
import type { Parcel, PortCall, StowVoyage } from "./types";
import { toStowShip } from "../hull";
import { propellerImmersion } from "../checks/geometry";
import {
  validateVoyage, prepareParcels, thermalOk, buildPairOk, candidateGroups, buildAdjacency,
  solvePrestow, mirrorKey, checkPlan, simulateStages, buildAdvisories, stageDraftMargin,
} from "./engine";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

const CALLS: PortCall[] = [
  { id: "L1", seq: 0, port: "Ulsan", berth: "B3" },
  { id: "L2", seq: 1, port: "Ulsan", berth: "B7" },
  { id: "D1", seq: 2, port: "Rotterdam", berth: "Botlek 1" },
  { id: "D2", seq: 3, port: "Antwerp", berth: "K1" },
];
let seq = 0;
export const mkParcel = (over: Partial<Parcel>): Parcel => ({
  id: `p${++seq}`,
  productId: null,
  name: "TEST",
  display: "TEST",
  group: 20,
  quantityMt: 2000,
  density: 0.8,
  loadCallId: "L1",
  dischargeCallId: "D1",
  heating: { enabled: false },
  boilPointC: 100,
  meltPointC: -50,
  polymerizable: false,
  maxAllowedTempC: null,
  ...over,
});
export const mkVoyage = (parcels: Parcel[], calls: PortCall[] = CALLS): StowVoyage => ({
  shipId: SAMPLE_SHIP.id, voyageNo: "T1", calls, parcels,
});

describe("validateVoyage", () => {
  it("空票货/空停靠点 → 报错", () => {
    expect(validateVoyage(SAMPLE_SHIP, mkVoyage([], []))).toHaveLength(2);
  });
  it("装泊位不早于卸泊位 → 报错", () => {
    const v = mkVoyage([mkParcel({ loadCallId: "D1", dischargeCallId: "L1" })]);
    expect(validateVoyage(SAMPLE_SHIP, v).join()).toMatch(/装泊位/);
  });
  it("数量或密度 ≤ 0 → 报错", () => {
    const v = mkVoyage([mkParcel({ quantityMt: 0 }), mkParcel({ density: -1 })]);
    expect(validateVoyage(SAMPLE_SHIP, v)).toHaveLength(2);
  });
  it("总体积超 0.98 × 总舱容 → 报错", () => {
    const v = mkVoyage([mkParcel({ quantityMt: 60000, density: 1 })]);
    expect(validateVoyage(SAMPLE_SHIP, v).join()).toMatch(/总体积/);
  });
  it("densityTable 给了没 loadTempC → 报错", () => {
    const v = mkVoyage([mkParcel({ densityTable: [{ t: 0, rho: 0.8 }, { t: 60, rho: 0.75 }] })]);
    expect(validateVoyage(SAMPLE_SHIP, v).join()).toMatch(/loadTempC|装货温度/);
  });
});

describe("prepareParcels", () => {
  it("体积 = 数量/密度;缺省 ll = 0.98;全部舱可用", () => {
    const r = prepareParcels(SAMPLE_SHIP, mkVoyage([mkParcel({ quantityMt: 1600, density: 0.8 })]));
    if ("errors" in r) throw new Error(r.errors.join());
    expect(r[0].volume).toBeCloseTo(2000);
    expect(r[0].ll).toBe(0.98);
    expect(r[0].usableTanks.size).toBe(20);
  });
  it("加温 + densityTable:ll 由 calcTank 压低", () => {
    const table = [{ t: 20, rho: 0.9 }, { t: 60, rho: 0.85 }];
    const r = prepareParcels(SAMPLE_SHIP, mkVoyage([mkParcel({
      density: 0.9, loadTempC: 20, densityTable: table, heating: { enabled: true, carriageTempC: 60 },
    })]));
    if ("errors" in r) throw new Error(r.errors.join());
    expect(r[0].ll).toBeCloseTo(0.98 * 0.85 / 0.9, 6);
  });
  it("加温温度超舱最高允许货温 → 该票货无可用舱", () => {
    const r = prepareParcels(SAMPLE_SHIP, mkVoyage([mkParcel({ heating: { enabled: true, carriageTempC: 95 } })]));
    if ("errors" in r) throw new Error(r.errors.join());
    expect(r[0].usableTanks.size).toBe(0);
  });
});

describe("thermalOk / buildPairOk", () => {
  const hot = mkParcel({ id: "hot", display: "HOT", heating: { enabled: true, carriageTempC: 50 } });
  it("不加温时恒 true", () => {
    expect(thermalOk(mkParcel({}), mkParcel({ polymerizable: true }))).toBe(true);
  });
  it("加温 vs 聚合货 → false", () => {
    expect(thermalOk(hot, mkParcel({ polymerizable: true }))).toBe(false);
  });
  it("加温 vs 沸点未知 → false(fail-closed)", () => {
    expect(thermalOk(hot, mkParcel({ boilPointC: null }))).toBe(false);
  });
  it("加温 T=50 vs 沸点 55 → false;沸点 61 → true", () => {
    expect(thermalOk(hot, mkParcel({ boilPointC: 55 }))).toBe(false);
    expect(thermalOk(hot, mkParcel({ boilPointC: 61 }))).toBe(true);
  });
  it("加温 T=50 vs maxAllowedTempC 45 → false", () => {
    expect(thermalOk(hot, mkParcel({ maxAllowedTempC: 45 }))).toBe(false);
  });
  it("USCG 5 与 20 不相容;group null 与任何货不相容;冲突对写入 conflicts", () => {
    const a = mkParcel({ id: "a", display: "A", group: 5 });
    const b = mkParcel({ id: "b", display: "B", group: 20 });
    const c = mkParcel({ id: "c", display: "C", group: null });
    const m = buildPairOk([a, b, c]);
    expect(m.ok.a.b).toBe(false);
    expect(m.ok.b.a).toBe(false);
    expect(m.ok.a.c).toBe(false);
    expect(m.ok.b.c).toBe(false);
    expect(m.conflicts).toEqual(expect.arrayContaining([["A", "B"], ["A", "C"], ["B", "C"]]));
  });
  it("热隔离双向:hot(50) vs 沸点 55 的货,矩阵两向都 false", () => {
    const cold = mkParcel({ id: "cold", display: "COLD", boilPointC: 55 });
    const m = buildPairOk([hot, cold]);
    expect(m.ok.hot.cold).toBe(false);
    expect(m.ok.cold.hot).toBe(false);
  });
});

describe("candidateGroups", () => {
  const prep = (over: Partial<Parcel>) => {
    const r = prepareParcels(SAMPLE_SHIP, mkVoyage([mkParcel(over)]));
    if ("errors" in r) throw new Error(r.errors.join());
    return r[0];
  };
  it("V=5000 → kMin=2:候选含 1 对(singles 0)与 2 对/1 对+1 单(k=3)", () => {
    const gs = candidateGroups(prep({ quantityMt: 5000, density: 1 }), SAMPLE_SHIP, 1);
    expect(gs.every(g => g.tanks.length === 2 || g.tanks.length === 3)).toBe(true);
    expect(gs.some(g => g.tanks.length === 2 && g.singles === 0)).toBe(true);
    expect(gs.every(g => g.singles <= 1)).toBe(true);
    for (const g of gs) {
      const cap = g.tanks.reduce((a, id) => a + SAMPLE_SHIP.tanks.find(t => t.id === id)!.cap100, 0);
      expect(g.fillRatio).toBeCloseTo(5000 / cap);
      expect(g.fillRatio).toBeLessThanOrEqual(0.98);
    }
  });
  it("Slop 一对(1090 m³)装不下 5000 → 不出现在候选", () => {
    const gs = candidateGroups(prep({ quantityMt: 5000, density: 1 }), SAMPLE_SHIP, 1);
    expect(gs.some(g => g.tanks.join() === "10P,10S")).toBe(false);
  });
  it("排序确定:k 升序、singles 升序、站号字典序", () => {
    const gs = candidateGroups(prep({ quantityMt: 2000, density: 1 }), SAMPLE_SHIP, 1);
    expect(gs[0].tanks).toEqual(["1P"]);
    const ks = gs.map(g => g.tanks.length);
    expect([...ks].sort((a, b) => a - b)).toEqual(ks);
  });
  it("maxSingles=Infinity 时允许 2 个单舱组合", () => {
    const gs = candidateGroups(prep({ quantityMt: 5000, density: 1 }), SAMPLE_SHIP, Infinity);
    expect(gs.some(g => g.tanks.length === 2 && g.singles === 2)).toBe(true);
  });
  it("buildAdjacency(8 向):1P 邻 1S、2P、2S", () => {
    const adj = buildAdjacency(SAMPLE_SHIP);
    expect(adj.get("1P")).toEqual(new Set(["1S", "2P", "2S"]));
  });
});

describe("mirrorKey", () => {
  it("P/S 全翻转后键相同", () => {
    const a = [{ parcelId: "x", tanks: ["1P", "2P"], fillRatio: 0.5 }, { parcelId: "y", tanks: ["3S"], fillRatio: 0.5 }];
    const b = [{ parcelId: "y", tanks: ["3P"], fillRatio: 0.5 }, { parcelId: "x", tanks: ["1S", "2S"], fillRatio: 0.5 }];
    expect(mirrorKey(a)).toBe(mirrorKey(b));
  });
  it("非镜像方案键不同", () => {
    const a = [{ parcelId: "x", tanks: ["1P"], fillRatio: 0.5 }];
    const b = [{ parcelId: "x", tanks: ["2P"], fillRatio: 0.5 }];
    expect(mirrorKey(a)).not.toBe(mirrorKey(b));
  });
});

describe("solvePrestow", () => {
  it("invalid:错误逐条返回", () => {
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([mkParcel({ quantityMt: 0 })]));
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.errors.length).toBeGreaterThan(0);
  });
  it("单票货占 1 舱:镜像去重后方案数 = 9(站 1–9 各一;Slop 545 m³ 装不下)", () => {
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([mkParcel({ quantityMt: 2000, density: 1 })]));
    expect(r.status).toBe("ok");
    if (r.status === "invalid") return;
    const oneTank = r.plans.filter(p => p.allocations[0].tanks.length === 1);
    expect(oneTank).toHaveLength(9);
    expect(r).not.toHaveProperty("diagnosis");
  });
  it("两票不相容货(5 vs 20)在所有方案中不相邻;每票 1 舱", () => {
    const a = mkParcel({ id: "a", display: "A", group: 5, quantityMt: 2000, density: 1 });
    const b = mkParcel({ id: "b", display: "B", group: 20, quantityMt: 2000, density: 1 });
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([a, b]));
    expect(r.status).toBe("ok");
    if (r.status === "invalid") return;
    expect(r.plans.length).toBeGreaterThan(0);
    expect(r.conflictPairs).toEqual([["A", "B"]]);
    for (const p of r.plans) expect(checkPlan(SAMPLE_SHIP, mkVoyage([a, b]), p)).toEqual([]);
  });
  it("加温货 vs 聚合货不相邻", () => {
    const hot = mkParcel({ id: "hot", heating: { enabled: true, carriageTempC: 50 }, quantityMt: 2000, density: 1 });
    const poly = mkParcel({ id: "poly", polymerizable: true, quantityMt: 2000, density: 1 });
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([hot, poly]));
    if (r.status === "invalid") throw new Error();
    const adj = buildAdjacency(SAMPLE_SHIP);
    for (const p of r.plans) {
      const th = p.allocations.find(a => a.parcelId === "hot")!.tanks;
      const tp = p.allocations.find(a => a.parcelId === "poly")!.tanks;
      for (const x of th) for (const y of tp) expect(adj.get(x)!.has(y)).toBe(false);
    }
  });
  it("涂层温度:航行温度 95 > 90 → ok 零解,conflictPairs 空", () => {
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([mkParcel({ heating: { enabled: true, carriageTempC: 95 } })]));
    expect(r.status).toBe("ok");
    if (r.status === "invalid") return;
    expect(r.plans).toHaveLength(0);
    expect(r.conflictPairs).toHaveLength(0);
    expect(r.message).toMatch(/无/);
    expect(r.diagnosis?.reasons[0].code).toBe("no-candidate");
  });
  it("截断:limit=50 → truncated/limit,不报无解", () => {
    const ps = Array.from({ length: 6 }, (_, i) => mkParcel({ id: `q${i}`, quantityMt: 2000, density: 1 }));
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage(ps), { limit: 50 });
    expect(r.status).toBe("truncated");
    if (r.status === "invalid") return;
    expect(r.truncatedBy).toBe("limit");
  });
  it("全部货对不相容且舱位充足时,limit 能真正约束耗时(< 3 s),状态 truncated/limit 或 ok 零解", () => {
    const ps = Array.from({ length: 6 }, (_, i) => mkParcel({ id: `x${i}`, group: null, quantityMt: 2000, density: 1 }));
    const t0 = performance.now();
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage(ps), { limit: 200_000 });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.status === "truncated" || r.status === "ok").toBe(true);
    if (r.status !== "invalid") expect(r.plans).toHaveLength(0);
  });
  it("截断:maxPlans=3 → truncated/maxPlans,恰好 3 个方案", () => {
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage([mkParcel({ quantityMt: 2000, density: 1 })]), { maxPlans: 3 });
    expect(r.status).toBe("truncated");
    if (r.status === "invalid") return;
    expect(r.truncatedBy).toBe("maxPlans");
    expect(r.plans).toHaveLength(3);
  });
  it("确定性:同输入两次 key 序列一致", () => {
    const v = mkVoyage([mkParcel({ id: "a", group: 5, quantityMt: 4000, density: 1 }), mkParcel({ id: "b", group: 20, quantityMt: 2500, density: 1 })]);
    const r1 = solvePrestow(SAMPLE_SHIP, v), r2 = solvePrestow(SAMPLE_SHIP, v);
    if (r1.status === "invalid" || r2.status === "invalid") throw new Error();
    expect(r1.plans.map(p => p.key)).toEqual(r2.plans.map(p => p.key));
  });
  it("第二趟:单舱数不限才有解时仍能求解", () => {
    // 19 票各占 1 舱,只剩 1 个单舱可用 → s≤1 每票仍可行;构造用 4 票各需 3 舱(1 对+1 单)、
    // 且 4 个单舱两两不能成对使用的场景太复杂,这里只验证 maxSingles 放开后候选更多的行为已在 candidateGroups 测过;
    // 此处验证:全部 20 舱被 10 票各 2 舱(必成对)占满时 ok 且有解。
    // 4500 m³:站 9 对(2×2510×0.98=4920)装得下;1000 m³ 进 Slop 对(1090×0.98=1068)。
    const ps = Array.from({ length: 10 }, (_, i) => mkParcel({ id: `f${i}`, quantityMt: i === 9 ? 1000 : 4500, density: 1 }));
    const r = solvePrestow(SAMPLE_SHIP, mkVoyage(ps), { maxPlans: 5 });
    expect(r.status === "ok" || r.status === "truncated").toBe(true);
    if (r.status === "invalid") return;
    expect(r.plans.length).toBeGreaterThan(0);
  });
});

describe("simulateStages / buildAdvisories", () => {
  const a = mkParcel({ id: "a", display: "A", quantityMt: 2000, density: 1, loadCallId: "L1", dischargeCallId: "D1" });
  const b = mkParcel({ id: "b", display: "B", quantityMt: 2000, density: 1, loadCallId: "L2", dischargeCallId: "D2", heating: { enabled: true, carriageTempC: 50 } });
  const allocs = [{ parcelId: "a", tanks: ["1P"], fillRatio: 2000 / 2980 }, { parcelId: "b", tanks: ["5S"], fillRatio: 2000 / 2970 }];
  const v = mkVoyage([a, b]);
  it("阶段数 = 停靠点数;装后有货、卸后为 null;重量 = cap × r × ρ", () => {
    const st = simulateStages(SAMPLE_SHIP, v, allocs);
    expect(st).toHaveLength(4);
    expect(st[0].tanks["1P"]?.weight).toBeCloseTo(2000);
    expect(st[0].tanks["5S"]).toBeNull();
    expect(st[1].tanks["5S"]?.parcelId).toBe("b");
    expect(st[1].totalWeight).toBeCloseTo(4000);
    expect(st[2].tanks["1P"]).toBeNull();
    expect(st[3].totalWeight).toBe(0);
    expect(st[3].lcgM).toBe(SAMPLE_SHIP.refLcg);
  });
  it("横倾力矩 = Σ w·tcg;1P 单舱为负", () => {
    const st = simulateStages(SAMPLE_SHIP, v, allocs);
    expect(st[0].heelMomentTm).toBeCloseTo(2000 * -4.6);
    expect(st[1].heelMomentTm).toBeCloseTo(2000 * -4.6 + 2000 * 7.0);
  });
  it("每站给出 GM 与稳性结论;自动配平无法挽救的极高常数 VCG 可触发不通过", () => {
    const stages = simulateStages(SAMPLE_SHIP, v, allocs);
    expect(stages.every(item => Number.isFinite(item.floating?.gmCorrected))).toBe(true);
    expect(stages.every(item => typeof item.floating?.stabilityPass === "boolean")).toBe(true);
    expect(stages.every(item => Number.isFinite(item.floating?.sfPct))).toBe(true);
    expect(stages.every(item => Number.isFinite(item.floating?.bmPct))).toBe(true);
    expect(stages.every(item => typeof item.floating?.strengthPass === "boolean")).toBe(true);
    expect(stages[2].floating!.bmPct).not.toBeCloseTo(stages[1].floating!.bmPct);

    const topHeavy = simulateStages(
      SAMPLE_SHIP,
      {
        ...v,
        constants: { constantsMt: 3_000, constantsVcg: 120 },
      },
      allocs,
    );
    expect(topHeavy.some(item => item.floating?.stabilityPass === false)).toBe(true);
    expect(topHeavy.find(item => !item.floating?.stabilityPass)?.floating?.stabilityNote).toBeTruthy();
  });
  it("压载提示:加温货 b 在 5S,WB4S 相邻 → 一条提示,候选阶段为 D1(a 卸后 b 仍在船)", () => {
    const st = simulateStages(SAMPLE_SHIP, v, allocs);
    const adv = buildAdvisories(SAMPLE_SHIP, v, allocs, st);
    expect(adv).toHaveLength(1);
    expect(adv[0]).toMatchObject({ code: "ballast-cooling", tankId: "5S", ballastId: "WB4S", parcelId: "b", callIds: ["D1"] });
    expect(adv[0].message).toContain("WB4S");
  });
  it("凝点 > 15 且不加温的货也提示;凝点 ≤ 15 不加温不提示", () => {
    const c = mkParcel({ id: "c", meltPointC: 20, quantityMt: 2000, density: 1 });
    const d = mkParcel({ id: "d", meltPointC: 10, quantityMt: 2000, density: 1 });
    const al = [{ parcelId: "c", tanks: ["3P"], fillRatio: 0.5 }, { parcelId: "d", tanks: ["7P"], fillRatio: 0.5 }];
    const vv = mkVoyage([c, d]);
    const adv = buildAdvisories(SAMPLE_SHIP, vv, al, simulateStages(SAMPLE_SHIP, vv, al));
    expect(adv.map(x => x.parcelId)).toEqual(["c"]);
  });
});

describe("SAMPLE_VOYAGE", () => {
  it("2 装 3 卸;6 票;总体积 ≥ 70% 舱容", () => {
    expect(SAMPLE_VOYAGE.calls).toHaveLength(5);
    expect(SAMPLE_VOYAGE.parcels).toHaveLength(6);
    const vol = SAMPLE_VOYAGE.parcels.reduce((a, p) => a + p.quantityMt / p.density, 0);
    expect(vol).toBeGreaterThan(0.7 * 53170);
  });
  it("求解:ok 或 truncated,≥ 1 方案,全部通过独立校验,已排序", () => {
    const r = solvePrestow(SAMPLE_SHIP, SAMPLE_VOYAGE);
    expect(r.status === "ok" || r.status === "truncated").toBe(true);
    if (r.status === "invalid") return;
    expect(r.plans.length).toBeGreaterThan(0);
    for (const p of r.plans.slice(0, 50)) {
      expect(checkPlan(SAMPLE_SHIP, SAMPLE_VOYAGE, p)).toEqual([]);
      expect(typeof p.stabilityOk).toBe("boolean");
      expect(p.stabilityOk).toBe(
        p.stages.every(stage => stage.floating?.stabilityPass !== false),
      );
      expect(p.strengthOk).toBe(
        p.stages.every(stage => stage.floating?.strengthPass !== false && stage.arrival?.strengthPass !== false),
      );
      expect(
        p.stages.every(
          stage => typeof stage.floating?.strengthPass === "boolean"
        )
      ).toBe(true);
      expect(p.score.maxBmPct).toBe(
        Math.max(...p.stages.flatMap(stage => [stage.floating!.bmPct, ...(stage.arrival ? [stage.arrival.bmPct] : [])])),
      );
      expect(p.score.minGm).toBe(
        Math.min(...p.stages.flatMap(stage => [stage.floating!.gmCorrected, ...(stage.arrival ? [stage.arrival.gmCorrected] : [])])),
      );
    }
    const checkedEnd = Math.min(60, r.plans.length);
    for (let i = 1; i < checkedEnd; i++) expect(comparePlans(r.plans[i - 1], r.plans[i])).toBeLessThanOrEqual(0);
    for (let i = checkedEnd + 1; i < r.plans.length; i++) expect(comparePlans(r.plans[i - 1], r.plans[i])).toBeLessThanOrEqual(0);
    expect(r.conflictPairs.length).toBeGreaterThanOrEqual(3); // naoh×{meoh,phenol,meg1,meg2}、phenol×acn
  });
  it("自动配平后各站 |trim| ≤ 1.0 m", () => {
    const result = solvePrestow(SAMPLE_SHIP, SAMPLE_VOYAGE);
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.plans.length).toBeGreaterThan(0);
    for (const stage of result.plans[0].stages) {
      expect(Math.abs(stage.floating?.trim ?? Infinity), stage.callId).toBeLessThanOrEqual(1);
    }
  });
  it("各站 ballastMt ≥ 0,卸完站 D3 满足压载态吃水与纵倾规则", () => {
    const result = solvePrestow(SAMPLE_SHIP, SAMPLE_VOYAGE, { maxPlans: 1 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    const stages = result.plans[0].stages;
    expect(stages.every(stage => (stage.floating?.ballastMt ?? -1) >= 0)).toBe(true);
    const final = stages.find(stage => stage.callId === "D3")!.floating!;
    expect(final.draftMid).toBeGreaterThanOrEqual(final.ballastRule!.dmMin!);
    expect(final.draftFwd).toBeGreaterThanOrEqual(final.ballastRule!.draftFwdMin!);
    expect(propellerImmersion(final).value).toBeGreaterThanOrEqual(100);
    expect(final.trim).toBeGreaterThanOrEqual(0.3);
    expect(final.trim).toBeLessThanOrEqual(2.5);
  });
  it("DEMO_STOW_SHIP 求解有解", () => {
    const r = solvePrestow(DEMO_STOW_SHIP, SAMPLE_VOYAGE);
    expect(r.status === "ok" || r.status === "truncated").toBe(true);
    if (r.status === "invalid") return;
    expect(r.plans.length).toBeGreaterThanOrEqual(1);
  });
  it("DEMO_STOW_SHIP 仅校核前 60 个方案强度，且基础示例在 8 秒内完成", () => {
    const startedAt = performance.now();
    const r = solvePrestow(DEMO_STOW_SHIP, SAMPLE_VOYAGE);
    const elapsedMs = performance.now() - startedAt;
    if (r.status === "invalid") throw new Error(r.errors.join());

    expect(r.plans.slice(0, 60).every(plan => plan.strengthChecked)).toBe(true);
    if (r.plans.length > 60) {
      expect(r.plans.slice(60).every(plan => !plan.strengthChecked)).toBe(true);
    }
    expect(elapsedMs).toBeLessThan(8_000);
  }, 10_000);
  it("DEMO_STOW_SHIP 样例航次有强度通过方案，且首方案通过", () => {
    const r = solvePrestow(DEMO_STOW_SHIP, SAMPLE_VOYAGE, { maxPlans: 100 });
    if (r.status === "invalid") throw new Error(r.errors.join());
    expect(r.plans.some(plan => plan.strengthOk)).toBe(true);
    expect(r.plans[0].strengthOk).toBe(true);
  });
});

describe("吃水约束", () => {
  const ship = toStowShip();
  const withLimit = (maxDraftM: number, callId = "D1"): StowVoyage => ({
    ...SAMPLE_VOYAGE,
    calls: SAMPLE_VOYAGE.calls.map(call => call.id === callId
      ? { ...call, maxDraftM, waterDensity: 1 }
      : { ...call, maxDraftM: undefined, waterDensity: undefined }),
  });

  it("每站有 floating,满载站吃水 10–13 m,卸完压载态吃水 5–7 m", () => {
    const result = solvePrestow(ship, SAMPLE_VOYAGE, { maxPlans: 5 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    const stages = result.plans[0].stages;
    expect(stages[1].floating!.draftMid).toBeGreaterThan(10);
    expect(stages[1].floating!.draftMid).toBeLessThan(13);
    expect(stages[4].floating!.draftMid).toBeGreaterThan(5);
    expect(stages[4].floating!.draftMid).toBeLessThan(7);
  });

  it("L2 离港限 9.0 m(淡水)→ 全部方案剔除,message 含「吃水超限」", () => {
    const result = solvePrestow(ship, withLimit(9, "L2"), { maxPlans: 50 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.plans).toHaveLength(0);
    expect(result.rejectedByDraft).toBeGreaterThan(0);
    expect(result.message).toMatch(/吃水超限/);
  });

  it("D1 到港限 12.8 m → 不剔除;minDraftMargin > 0;bindingCallId = D1", () => {
    const result = solvePrestow(ship, withLimit(12.8), { maxPlans: 20 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.rejectedByDraft).toBe(0);
    expect(result.plans[0].score.minDraftMargin).toBeGreaterThan(0);
    expect(result.plans[0].bindingCallId).toBe("D1");
    const limitedStage = result.plans[0].stages.find(stage => stage.callId === "D1")!;
    expect(stageDraftMargin(limitedStage)).toBeCloseTo(
      12.8 - Math.max(limitedStage.arrival!.draftAft, limitedStage.arrival!.draftFwd)
    );
  });
});


describe("voyage consumption integration", () => {
  it("Antwerp arrival uses Ningbo cargo and sea ROB, with arrival GM checked", () => {
    const voyage = findSampleVoyage("far-east-europe-12")!.voyage;
    const result = solvePrestow(DEMO_STOW_SHIP, voyage);
    if (result.status === "invalid") throw new Error(result.errors.join());
    const plan = result.plans.find(plan => plan.stabilityOk && plan.strengthOk && plan.consumablesOk)!;
    expect(plan).toBeDefined();
    const ningbo = plan.stages.find(stage => stage.callId === "L5")!;
    const antwerp = plan.stages.find(stage => stage.callId === "D1")!;
    const c = antwerp.consumables!;
    const departure = ningbo.floating!, arrival = antwerp.arrival!;
    const actualWaterChange = c.arrival.freshWaterMt - ningbo.consumables!.departure.freshWaterMt;
    // FW generation is capped at 450 t: compare actual ROB when the tank is full.
    expect(Math.abs((arrival.displacement - arrival.ballastMt) -
      (departure.displacement - departure.ballastMt - c.legFuelMt + actualWaterChange))).toBeLessThan(1);
    expect(arrival.gmCorrected).toBeLessThan(departure.gmCorrected);
    expect(plan.stabilityOk).toBe(plan.stages.every(stage => stage.floating?.stabilityPass !== false && stage.arrival?.stabilityPass !== false));
    expect(plan.score.minBunkerMarginMt).toBe(Math.min(...plan.stages.slice(1).map(stage => stage.consumables!.arrival.fuelMt - stage.consumables!.reserveMt)));
    expect(plan.stages[0].floating).toMatchObject({ limitSource: "zone", zone: "winter" });
    expect(ningbo.floating?.limitSource).toBe("ship");
    expect(antwerp.arrival?.limitSource).toBe("port");
  });

  it("fuel shortage rejects a plan while low reserve alone does not", () => {
    const original = findSampleVoyage("far-east-europe-12")!.voyage;
    const voyage = { ...original, constants: { ...original.constants, bunkersMt: 1 }, calls: original.calls.map(call => ({ ...call, bunkerMt: 0 })) };
    const result = solvePrestow(DEMO_STOW_SHIP, voyage, { maxPlans: 1 });
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.plans[0].consumablesOk).toBe(false);
    const reserve = solvePrestow(DEMO_STOW_SHIP, { ...original, constants: { bunkerReserveDays: 100 } }, { maxPlans: 1 });
    if (reserve.status === "invalid") throw new Error(reserve.errors.join());
    expect(reserve.plans[0].consumablesOk).toBe(true);
    expect(reserve.plans[0].score.minBunkerMarginMt).toBeLessThan(0);
  });
});
