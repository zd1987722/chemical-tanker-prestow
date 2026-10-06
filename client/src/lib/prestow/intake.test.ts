import { findSampleVoyage } from "./sample-voyages";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resetRuntimeExceptionsForTest,
  setRuntimeExceptions,
} from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { solvePrestow, stageDraftMargin } from "./engine";
import { initialTargets, solveIntake } from "./intake";
import type { Parcel, PortCall, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

const CALLS: PortCall[] = [
  { id: "L1", seq: 0, port: "Ulsan", berth: "B3" },
  { id: "L2", seq: 1, port: "Ulsan", berth: "B7" },
  { id: "D1", seq: 2, port: "Rotterdam", berth: "Botlek 1" },
  { id: "D2", seq: 3, port: "Antwerp", berth: "K1" },
];

let sequence = 0;
const mkParcel = (over: Partial<Parcel>): Parcel => ({
  id: `p${++sequence}`,
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
const mkVoyage = (
  parcels: Parcel[],
  calls: PortCall[] = CALLS
): StowVoyage => ({
  shipId: DEMO_STOW_SHIP.id,
  voyageNo: "T1",
  calls,
  parcels,
});
const flex = (over: Partial<Parcel>, intake: Parcel["intake"]) =>
  mkParcel({ ...over, quantityMt: 0, intake });
const summary = (result: ReturnType<typeof solveIntake>) => {
  if (result.status === "invalid") throw new Error(result.errors.join());
  return Object.fromEntries(
    result.intakeSummary!.map(item => [item.parcelId, item.quantityMt])
  );
};

describe("solveIntake", () => {
  const ship = DEMO_STOW_SHIP;

  it("受限港 4 m:意向零方案附吃水诊断,输入错误仍为 invalid", () => {
    const voyage = mkVoyage([flex({ id: "a", display: "甲醇", density: 0.79 }, { mode: "range", minMt: 3000, maxMt: 5000 })],
      CALLS.map(c => c.id === "D1" ? { ...c, maxDraftM: 4 } : c));
    const result = solveIntake(ship, voyage);
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.plans).toHaveLength(0);
    expect(result.diagnosis?.reasons[0]).toMatchObject({ code: "draft", message: expect.stringContaining("Rotterdam") });
    expect(result.diagnosis?.reasons[0].message).toContain("4.0 m");
    expect(solveIntake(ship, { ...voyage, parcels: voyage.parcels.map(p => ({ ...p, density: -1 })) }).status).toBe("invalid");
  });

  it("未设 maxMt 的尽量多意向按全舱上限诊断,不误报无候选", () => {
    const voyage = structuredClone(findSampleVoyage("single-meoh-draft")!.voyage);
    voyage.calls[1].maxDraftM = 4;
    const result = solveIntake(ship, voyage);
    if (result.status === "invalid") throw new Error(result.errors.join());
    expect(result.plans).toHaveLength(0);
    expect(result.diagnosis?.reasons.map(reason => reason.code)).toEqual(["draft"]);
    expect(result.diagnosis?.reasons[0].message).toMatch(/张家港 到港.*4.0 m/);
    expect(result.diagnosis?.stats).toMatchObject({ tanksNeededMin: 20, relaxedFeasible: true });
  });

  it("priority:甲醇优先 → 甲醇吨数 ≥ 乙二醇;总吨 > 30,000", () => {
    const voyage = mkVoyage([
      flex(
        { id: "a", display: "甲醇", group: 20, density: 0.79 },
        { mode: "priority", priority: 1 }
      ),
      flex(
        { id: "b", display: "MEG", group: 20, density: 1.11 },
        { mode: "priority", priority: 2 }
      ),
    ]);
    const result = solveIntake(ship, voyage);
    const quantities = summary(result);
    expect(quantities.a).toBeGreaterThanOrEqual(quantities.b);
    expect(quantities.a + quantities.b).toBeGreaterThan(30000);
    expect(result.status).not.toBe("invalid");
    if (result.status !== "invalid")
      expect(result.plans[0].intake).toEqual(quantities);
  });

  it("ratio 2:1 → 吨数比 1.8–2.2", () => {
    const voyage = mkVoyage([
      flex(
        { id: "a", display: "甲醇", density: 0.79 },
        { mode: "ratio", ratio: 2 }
      ),
      flex(
        { id: "b", display: "MEG", density: 1.11 },
        { mode: "ratio", ratio: 1 }
      ),
    ]);
    const quantities = summary(solveIntake(ship, voyage));
    expect(quantities.a / quantities.b).toBeGreaterThanOrEqual(1.8);
    expect(quantities.a / quantities.b).toBeLessThanOrEqual(2.2);
    expect(quantities.a + quantities.b).toBeGreaterThan(30000);
  });

  it("range:maxMt 5000 → 不超 5000;minMt 3000 → 不低于 3000", () => {
    const voyage = mkVoyage([
      flex(
        { id: "capped", density: 0.9 },
        { mode: "range", minMt: 1000, maxMt: 5000 }
      ),
      flex(
        { id: "floored", density: 1.0 },
        { mode: "range", minMt: 3000, maxMt: 7000 }
      ),
    ]);
    const quantities = summary(solveIntake(ship, voyage));
    expect(quantities.capped).toBeLessThanOrEqual(5000);
    expect(quantities.capped).toBeGreaterThanOrEqual(1000);
    expect(quantities.floored).toBeGreaterThanOrEqual(3000);
    expect(quantities.floored).toBeLessThanOrEqual(7000);
  });

  it("L2 离港吃水 11.0 m 时总吨小于不限时,且 limitedBy 含港名", () => {
    const parcels = [
      flex(
        { id: "a", display: "甲醇", density: 0.79 },
        { mode: "ratio", ratio: 2 }
      ),
      flex(
        { id: "b", display: "MEG", density: 1.11 },
        { mode: "ratio", ratio: 1 }
      ),
    ];
    const unlimited = solveIntake(ship, mkVoyage(parcels));
    const limitedCalls = CALLS.map(call =>
      call.id === "L2" ? { ...call, maxDraftM: 11, waterDensity: 1 } : call
    );
    const limited = solveIntake(ship, mkVoyage(parcels, limitedCalls));
    const unlimitedQuantities = summary(unlimited);
    const limitedQuantities = summary(limited);
    const unlimitedTotal = Object.values(unlimitedQuantities).reduce(
      (sum, quantity) => sum + quantity,
      0
    );
    const limitedTotal = Object.values(limitedQuantities).reduce(
      (sum, quantity) => sum + quantity,
      0
    );
    expect(limitedTotal).toBeLessThan(unlimitedTotal);
    if (limited.status === "invalid") throw new Error(limited.errors.join());
    expect(
      limited.intakeSummary!.some(item => item.limitedBy.includes("Ulsan"))
    ).toBe(true);
    expect(
      limited.plans[0].stages.every(
        stage => (stageDraftMargin(stage) ?? 0) >= -1e-6
      )
    ).toBe(true);
  });

  it("确定性:两次结果一致", () => {
    const voyage = mkVoyage([
      flex(
        { id: "a", density: 0.9 },
        { mode: "range", minMt: 3000, maxMt: 5000 }
      ),
    ]);
    expect(solveIntake(ship, voyage)).toEqual(solveIntake(ship, voyage));
  });

  it("solvePrestow 在校验 quantityMt 前转调意向求解", () => {
    const voyage = mkVoyage([
      flex(
        { id: "a", density: 0.9 },
        { mode: "range", minMt: 3000, maxMt: 5000 }
      ),
    ]);
    const result = solvePrestow(ship, voyage);
    expect(result.status).not.toBe("invalid");
    if (result.status !== "invalid")
      expect(result.intakeSummary?.[0].quantityMt).toBeGreaterThanOrEqual(3000);
  });

  it("initialTargets:ratio 按吨数 2:1,range 取 maxMt", () => {
    const ratioVoyage = mkVoyage([
      flex({ id: "a", density: 1 }, { mode: "ratio", ratio: 2 }),
      flex({ id: "b", density: 1 }, { mode: "ratio", ratio: 1 }),
    ]);
    const ratioTargets = initialTargets(ship, ratioVoyage);
    expect(ratioTargets.a / ratioTargets.b).toBeCloseTo(2, 8);
    const rangeTargets = initialTargets(
      ship,
      mkVoyage([
        flex(
          { id: "c", density: 1 },
          { mode: "range", minMt: 3000, maxMt: 5000 }
        ),
      ])
    );
    expect(rangeTargets.c).toBe(5000);
  });
});


it("620 nm methanol intake credits actual oil/water consumption within 3%", () => {
  const voyage = findSampleVoyage("single-meoh-draft")!.voyage;
  const distance = solveIntake(DEMO_STOW_SHIP, voyage);
  const zero = solveIntake(DEMO_STOW_SHIP, { ...voyage, calls: voyage.calls.map(call => ({ ...call, distanceNm: 0 })) });
  if (distance.status === "invalid" || zero.status === "invalid") throw new Error("intake invalid");
  const stages = distance.plans[0].stages;
  const departure = stages[0].consumables!.departure, arrival = stages[1].consumables!.arrival;
  const credit = departure.fuelMt + departure.freshWaterMt - arrival.fuelMt - arrival.freshWaterMt;
  const delta = distance.intakeSummary![0].quantityMt - zero.intakeSummary![0].quantityMt;
  expect(distance.intakeSummary![0].consumptionCreditMt).toBeCloseTo(credit, 8);
  expect(Math.abs(delta - credit)).toBeLessThan(Math.abs(credit) * 0.03);
}, 15000);
