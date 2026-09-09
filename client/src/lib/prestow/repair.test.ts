import { describe, expect, it } from "vitest";
import { setRuntimeExceptions } from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { solvePrestow } from "./engine";
import { applyRepairChanges, proposeRepairs } from "./repair";
import type { Parcel, StowVoyage } from "./types";

setRuntimeExceptions([], []);

function parcel(id: string, name: string, display: string, group: number, quantityMt: number, density: number, extra: Partial<Parcel> = {}): Parcel {
  return {
    id, productId: null, name, display, group, quantityMt, density,
    loadCallId: "L1", dischargeCallId: "D1", heating: { enabled: false },
    boilPointC: 100, meltPointC: -50, polymerizable: false, maxAllowedTempC: null, ...extra,
  };
}

function voyageWith(parcels: Parcel[], maxDraftM?: number): StowVoyage {
  return {
    shipId: DEMO_STOW_SHIP.id, voyageNo: "REPAIR-TEST",
    calls: [
      { id: "L1", seq: 0, port: "蔚山", berth: "3 号泊位" },
      { id: "D1", seq: 1, port: "鹿特丹", berth: "Botlek", ...(maxDraftM ? { maxDraftM, waterDensity: 1.0 } : {}) },
    ],
    parcels,
  };
}

// 12 票各 3 000 t 甲醇类(族 20,互相相容):每票需 2 舱 → 24 舱 > 20 舱
const alcohols = ["METHANOL", "ETHANOL", "ISOPROPYL ALCOHOL", "N-BUTYL ALCOHOL", "ETHYLENE GLYCOL", "PROPYLENE GLYCOL", "N-PROPYL ALCOHOL", "SEC-BUTYL ALCOHOL", "ISOBUTYL ALCOHOL", "HEXYLENE GLYCOL", "DIETHYLENE GLYCOL", "TRIETHYLENE GLYCOL"];
const tankDemandVoyage = voyageWith(alcohols.map((name, i) => parcel(`p${i}`, name, `${name} #${i}`, 20, 3000, 0.8)));

describe("proposeRepairs", () => {
  it("舱位缺口:给出复核可行的减量方案,应用后引擎能生成方案", () => {
    const base = solvePrestow(DEMO_STOW_SHIP, tankDemandVoyage);
    expect(base.status).not.toBe("invalid");
    if (base.status === "invalid") return;
    expect(base.plans.length).toBe(0);
    expect(base.diagnosis?.reasons[0]?.code).toBe("tank-demand");

    const report = proposeRepairs(DEMO_STOW_SHIP, tankDemandVoyage, base.diagnosis, { deadlineMs: 20000 });
    expect(report.proposals.length).toBeGreaterThan(0);
    const best = report.proposals[0];
    expect(best.removedMt).toBeGreaterThan(0);
    expect(best.changes.every(c => c.toMt < c.fromMt)).toBe(true);
    // 方案按代价升序
    for (let i = 1; i < report.proposals.length; i++) expect(report.proposals[i].cost).toBeGreaterThanOrEqual(report.proposals[i - 1].cost);
    // 应用后真实求解可行,且其它票不变
    const applied = solvePrestow(DEMO_STOW_SHIP, best.voyage, { limit: 500_000, maxPlans: 1 });
    expect(applied.status).not.toBe("invalid");
    if (applied.status !== "invalid") expect(applied.plans.length).toBeGreaterThan(0);
    const touched = new Set(best.changes.map(c => c.parcelId));
    for (const p of tankDemandVoyage.parcels) {
      const after = best.voyage.parcels.find(x => x.id === p.id);
      if (!touched.has(p.id)) expect(after?.quantityMt).toBe(p.quantityMt);
    }
  });

  it("吃水超限:用意向求解给出按到港吃水的减量方案", () => {
    // 两票大宗货装满,卸港限吃水 9.0 m
    const voyage = voyageWith([
      parcel("a", "METHANOL", "甲醇 Methanol", 20, 20000, 0.79),
      parcel("b", "ETHANOL", "乙醇 Ethanol", 20, 18000, 0.79),
    ], 9.0);
    const base = solvePrestow(DEMO_STOW_SHIP, voyage);
    expect(base.status).not.toBe("invalid");
    if (base.status === "invalid") return;
    expect(base.plans.length).toBe(0);
    const report = proposeRepairs(DEMO_STOW_SHIP, voyage, base.diagnosis, { deadlineMs: 60000 });
    const draftFix = report.proposals.find(p => p.origin === "draft");
    expect(draftFix).toBeDefined();
    expect(draftFix!.changes[0].toMt).toBeLessThan(draftFix!.changes[0].fromMt);
    expect(draftFix!.changes[0].note).toContain("上限");
  }, 120000);

  it("含意向票的航次不生成建议,并给出说明", () => {
    const voyage = voyageWith([parcel("a", "METHANOL", "甲醇", 20, 0, 0.79, { intake: { mode: "priority", priority: 1 } })]);
    const report = proposeRepairs(DEMO_STOW_SHIP, voyage);
    expect(report.proposals).toEqual([]);
    expect(report.note).toContain("意向");
  });

  it("applyRepairChanges:减量改吨数并固定意向,删除移除该票", () => {
    const voyage = voyageWith([parcel("a", "METHANOL", "甲醇", 20, 5000, 0.79), parcel("b", "ETHANOL", "乙醇", 20, 4000, 0.79)]);
    const next = applyRepairChanges(voyage, [
      { parcelId: "a", display: "甲醇", kind: "reduce", fromMt: 5000, toMt: 4200 },
      { parcelId: "b", display: "乙醇", kind: "drop", fromMt: 4000, toMt: 0 },
    ]);
    expect(next.parcels.map(p => [p.id, p.quantityMt])).toEqual([["a", 4200]]);
    expect(next.parcels[0].intake).toEqual({ mode: "fixed" });
    expect(voyage.parcels.length).toBe(2);
  });
});
