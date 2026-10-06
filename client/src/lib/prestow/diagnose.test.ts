import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setRuntimeExceptions, resetRuntimeExceptionsForTest } from "../appendix-i-exceptions";
import { evaluateCompat } from "../uscg-verdict";
import { DEMO_STOW_SHIP as ship } from "./demo-ship";
import * as engine from "./engine";
import { diagnoseInfeasibility } from "./diagnose";
import type { Parcel, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

const parcel = (i: number, over: Partial<Parcel> = {}): Parcel => ({
  id: `p${i}`, name: `TEST${i}`, display: `货${i + 1}`, productId: null, group: 20,
  quantityMt: 9000, density: 1, loadCallId: "L", dischargeCallId: "D",
  heating: { enabled: false }, boilPointC: 100, meltPointC: null,
  polymerizable: false, maxAllowedTempC: null, ...over,
});
const voyage = (parcels: Parcel[], maxDraftM?: number): StowVoyage => ({
  shipId: ship.id, voyageNo: "diagnosis", parcels,
  calls: [{ id: "L", seq: 0, port: "装港", berth: "" }, { id: "D", seq: 1, port: "受限卸港", berth: "", maxDraftM }],
});
const solve = (v: StowVoyage, limit?: number) => {
  const r = engine.solvePrestow(ship, v, { limit });
  if (r.status === "invalid") throw new Error(r.errors.join());
  expect(r.plans).toHaveLength(0);
  expect(r.diagnosis).toBeDefined();
  return r.diagnosis!;
};

describe("four diagnosis fixtures", () => {
  it("12 × 4000 t requires 24 tanks, with only 20 available", () => {
    const d = solve(voyage(Array.from({ length: 12 }, (_, i) => parcel(i, { quantityMt: 4000 }))));
    expect(d.reasons[0]).toMatchObject({ code: "tank-demand", severity: "blocker" });
    expect(d.reasons[0].message).toMatch(/12.*24.*20/);
    expect(d.stats.tanksNeededMin).toBe(24);
    expect(new Set(d.suggestions).size).toBe(d.suggestions.length);
  });

  it("5 mutually incompatible groups need 4 tanks each; relaxed search finds a witness", () => {
    const parcels = [1, 2, 6, 10, 12].map((group, i) => parcel(i, { group }));
    for (let i = 0; i < parcels.length; i++) for (let j = i + 1; j < parcels.length; j++)
      expect(evaluateCompat(parcels[i].group, parcels[j].group)).toMatchObject({ known: true, isCompatible: false });
    const d = solve(voyage(parcels));
    expect(d.reasons[0].code).toBe("compat");
    expect(d.reasons[0].message).toMatch(/10 个不相容对,5 票货挤在 20 舱/);
    expect(d.stats).toMatchObject({ tanksNeededMin: 20, relaxedFeasible: true, conflictPairs: 10 });
  });

  it("phenol at 60 °C is thermally isolated from four low-boiling parcels", () => {
    const parcels = Array.from({ length: 5 }, (_, i) => parcel(i, i === 0
      ? { name: "PHENOL", display: "苯酚", group: 21, heating: { enabled: true, carriageTempC: 60 } }
      : { boilPointC: 65 }));
    const d = solve(voyage(parcels));
    expect(d.reasons[0].code).toBe("compat");
    expect(d.reasons.find(r => r.code === "thermal")).toMatchObject({
      severity: "likely", message: "加温货 苯酚(60 °C)因热隔离不能与 货2、货3、货4、货5 相邻",
    });
    expect(d.stats).toMatchObject({ thermalPairs: 4, relaxedFeasible: true, tanksNeededMin: 20 });
  });

  it("20 full tanks arrive at a discharge port limited to 7.0 m", () => {
    const parcels = ship.tanks.filter(t => t.side === "P").map((t, i) => parcel(i, {
      quantityMt: t.cap100 * 2 * 0.98 * 0.75, density: 0.75,
    }));
    const d = solve(voyage(parcels, 7), 5000);
    expect(d.reasons[0].code).toBe("draft");
    expect(d.reasons[0].message).toMatch(/找到 1 个.*受限卸港 到港.*7.0 m/);
    expect(d.reasons.some(r => r.code === "compat")).toBe(false);
    expect(d.stats.rejectedByDraft).toBe(1);
  });
});

describe("diagnosis boundaries", () => {
  it("over-temperature gives a named no-candidate blocker and deduplicates suggestions", () => {
    const d = solve(voyage([parcel(0, { quantityMt: 2000, heating: { enabled: true, carriageTempC: 500 } })]));
    expect(d.reasons[0]).toMatchObject({ code: "no-candidate", message: "货1 加温 500 °C 超过所有货舱许可温度", parcels: ["货1"] });
    expect(d.reasons[1].code).toBe("capacity-relaxed");
    expect(d.stats.relaxedFeasible).toBe(false);
    expect(d.suggestions).toEqual(["减少票数或合并同货分票", "降低单票吨数"]);
  });

  it("competing for the only usable tank proves a capacity combination failure", () => {
    const restricted = { ...ship, tanks: ship.tanks.map(t => ({ ...t, maxCargoTempC: t.id === "1P" ? 90 : 40 })) };
    const v = voyage([0, 1].map(i => parcel(i, { quantityMt: 2000, heating: { enabled: true, carriageTempC: 60 } })));
    const r = engine.solvePrestow(restricted, v);
    if (r.status === "invalid") throw new Error(r.errors.join());
    expect(r.diagnosis?.reasons[0]).toMatchObject({ code: "capacity-relaxed", message: expect.stringContaining("合计 4000 m³") });
    expect(r.diagnosis?.stats).toMatchObject({ relaxedFeasible: false, tanksNeededMin: 2 });
  });

  it("original budget exhaustion without conflicts is a hint, not a compatibility claim", () => {
    const d = solve(voyage([parcel(0, { quantityMt: 2000 })]), 1);
    expect(d.reasons).toEqual([{ code: "search-budget", severity: "hint", message: "枚举 1 步未找到完整分配,约束可能过紧" }]);
    expect(d.stats.relaxedFeasible).toBe(true);
  });

  it("relaxed exhaustion stays unknown and uses exactly the 300,000-step budget", () => {
    const v = voyage([parcel(0, { quantityMt: 2000 })]);
    const prepared = v.parcels.map(p => engine.prepareParcel(ship, p));
    const spy = vi.spyOn(engine, "search").mockReturnValue({ allocs: [], rejectedByDraft: 0, truncatedBy: "limit" });
    try {
      const d = diagnoseInfeasibility({ ship, voyage: v, prepared, pair: engine.buildPairOk(v.parcels), adj: engine.buildAdjacency(ship),
        groupsFor: (p, singles) => engine.candidateGroups(p, ship, singles), found: { rejectedByDraft: 0, truncatedBy: "limit" }, limit: 42 });
      expect(spy.mock.calls[0].slice(4, 6)).toEqual([300_000, 1]);
      expect(d.stats.relaxedFeasible).toBeNull();
      expect(d.reasons.map(r => r.code)).toEqual(["search-budget"]);
    } finally { spy.mockRestore(); }
  });

  it("search retains the first rejected allocation after backtracking", () => {
    const p = engine.prepareParcel(ship, parcel(0, { quantityMt: 2000 }));
    const gs = engine.candidateGroups(p, ship, 1);
    const result = engine.search([p], [gs], engine.buildPairOk([p.parcel]), engine.buildAdjacency(ship), 10000, 1, () => false, new Set());
    expect(result.rejectedByDraft).toBeGreaterThan(1);
    expect(result.firstRejected).toEqual([{ parcelId: p.parcel.id, tanks: gs[0].tanks, fillRatio: gs[0].fillRatio }]);
    expect(result.firstRejected![0].tanks).not.toBe(gs[0].tanks);
  });
});
