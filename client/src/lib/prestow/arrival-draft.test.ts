import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resetRuntimeExceptionsForTest,
  setRuntimeExceptions,
} from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import {
  checkPlan,
  simulateStages,
  solvePrestow,
  stageDraftExceeded,
  stageDraftMargin,
} from "./engine";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { SAMPLE_VOYAGES } from "./sample-voyages";
import type { Allocation, Parcel, StageState, StowResult, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

function solved(result: StowResult) {
  if (result.status === "invalid") throw new Error(result.errors.join("; "));
  expect(result.plans.length).toBeGreaterThan(0);
  return result;
}

function sample(id: string): StowVoyage {
  const entry = SAMPLE_VOYAGES.find(item => item.id === id);
  if (!entry) throw new Error(`missing sample ${id}`);
  return entry.voyage;
}

function deepest(stage: StageState["floating"]): number {
  if (!stage) return Number.NaN;
  return Math.max(stage.draftAft, stage.draftFwd);
}

describe("arrival draft and structural draft", () => {
  it("stageDraftMargin takes the smaller arrival/departure margin", () => {
    const stage = {
      arrival: { draftMargin: 0.2 },
      floating: { draftMargin: 0.4 },
    } as StageState;
    expect(stageDraftMargin(stage)).toBe(0.2);
    expect(stageDraftExceeded(stage)).toBe(false);
    expect(stageDraftExceeded({
      ...stage,
      arrival: { draftMargin: -0.01 },
    } as StageState)).toBe(true);
  });

  it("simulateStages calculates arrival before discharge and checks an unrestricted transit call", () => {
    const parcel: Parcel = {
      id: "meoh",
      productId: null,
      name: "METHANOL",
      display: "甲醇",
      group: 20,
      quantityMt: 12_000,
      density: 0.79,
      loadCallId: "L1",
      dischargeCallId: "D1",
      heating: { enabled: false },
      boilPointC: 64.7,
      meltPointC: -97.6,
      polymerizable: false,
      maxAllowedTempC: null,
    };
    const voyage: StowVoyage = {
      shipId: DEMO_STOW_SHIP.id,
      voyageNo: "ARRIVAL-UNIT",
      calls: [
        { id: "L1", seq: 0, port: "蔚山", berth: "B1" },
        { id: "T1", seq: 1, port: "过境", berth: "—" },
        { id: "D1", seq: 2, port: "张家港", berth: "B2", maxDraftM: 11, waterDensity: 1 },
      ],
      parcels: [parcel],
    };
    const allocations: Allocation[] = [{
      parcelId: parcel.id,
      tanks: ["1P", "1S", "2P", "2S", "3P", "3S"],
      fillRatio: 12_000 / (
        DEMO_STOW_SHIP.tanks
          .filter(tank => ["1P", "1S", "2P", "2S", "3P", "3S"].includes(tank.id))
          .reduce((sum, tank) => sum + tank.cap100, 0) * parcel.density
      ),
    }];
    const stages = simulateStages(DEMO_STOW_SHIP, voyage, allocations, false);
    expect(stages[1].arrival?.stabilityPass).toBeTypeOf("boolean");
    expect(stages[2].arrival?.draftMid).toBeGreaterThan(stages[2].floating!.draftMid);
    expect(stages[2].arrival?.maxDraftM).toBe(11);
    expect(stages[2].arrival?.limitSource).toBe("port");
    const strengthStages = simulateStages(DEMO_STOW_SHIP, voyage, allocations);
    // 到港强度按到港状态(到港油水 / 压载)实算,不再复制上一离港值
    expect(strengthStages[2].arrival?.strengthChecked).toBe(true);
    expect(Number.isFinite(strengthStages[2].arrival?.sfPct)).toBe(true);
    expect(strengthStages[2].arrival?.bmPct).not.toBe(strengthStages[1].floating?.bmPct);
    expect(typeof strengthStages[2].arrival?.strengthPass).toBe("boolean");
    expect(stages[2].arrival?.strengthChecked).toBe(false);
    expect(strengthStages[2].arrival?.approx).toBe(true);
  });

  it("ship structural draft applies when the port is unrestricted", () => {
    const result = solved(solvePrestow(DEMO_STOW_SHIP, {
      ...SAMPLE_VOYAGE,
      calls: SAMPLE_VOYAGE.calls.map(call => ({ ...call, maxDraftM: undefined })),
    }, { maxPlans: 1 }));
    expect(result.plans[0].stages.every(stage => stage.floating?.maxDraftM === 13)).toBe(true);
    expect(result.plans[0].stages.every(stage => stage.floating?.limitSource === "ship")).toBe(true);
  });

  it("structural draft limits a high-density variable parcel", () => {
    const voyage = sample("single-naoh-draft");
    const unrestricted: StowVoyage = {
      ...voyage,
      calls: voyage.calls.map(call => ({ ...call, maxDraftM: undefined })),
    };
    const result = solved(solvePrestow(DEMO_STOW_SHIP, unrestricted));
    const discharge = result.plans[0].stages.find(stage => stage.callId === "D1")!;
    expect(deepest(discharge.arrival)).toBeCloseTo(13, 1);
    expect(discharge.arrival?.limitSource).toBe("ship");
    expect(result.intakeSummary?.[0].limitedBy)
      .toBe("受限于 胡志明(结构吃水) 到港吃水 13.00 m(ρ 1.005)(精算)");
  }, 10_000);

  it("checkPlan rejects an arrival draft exceedance", () => {
    const unrestricted = {
      ...SAMPLE_VOYAGE,
      calls: SAMPLE_VOYAGE.calls.map(call => ({ ...call, maxDraftM: undefined })),
    };
    const result = solved(solvePrestow(DEMO_STOW_SHIP, unrestricted, { maxPlans: 1 }));
    const limited = {
      ...unrestricted,
      calls: unrestricted.calls.map(call => call.id === "D1"
        ? { ...call, maxDraftM: 10, waterDensity: 1 }
        : call),
    };
    expect(checkPlan(DEMO_STOW_SHIP, limited, result.plans[0]).join(" ")).toMatch(/到港.*吃水超限/);
  });
});

describe("sample voyage acceptance", () => {
  it("basic has Rotterdam arrival 11.93 m with 0.37 m margin after consumption", () => {
    const result = solved(solvePrestow(DEMO_STOW_SHIP, sample("basic"), { maxPlans: 1 }));
    const stage = result.plans[0].stages.find(item => item.callId === "D1")!;
    expect(deepest(stage.arrival)).toBeCloseTo(11.9345, 1);
    expect(stage.arrival?.draftMargin).toBeCloseTo(0.3655, 1);
  });

  it.each(["far-east-europe-12", "split-loading-12"])(
    "%s solves with all 20 tanks under 2 seconds",
    id => {
      const started = performance.now();
      const result = solved(solvePrestow(DEMO_STOW_SHIP, sample(id)));
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(result.plans[0].score.tanksUsed).toBe(20);
      if (id === "far-east-europe-12") {
        const antwerp = result.plans[0].stages.find(stage => stage.callId === "D1")!;
        expect(deepest(antwerp.arrival)).toBeCloseTo(12.3062, 1);
        expect(antwerp.arrival?.draftMargin).toBeCloseTo(0.1938, 1);
      }
    },
    10_000
  );

  it("single methanol fills all tanks when no port draft limit exists", () => {
    const voyage: StowVoyage = {
      ...sample("single-meoh-draft"),
      calls: sample("single-meoh-draft").calls.map(call => ({ ...call, maxDraftM: undefined })),
    };
    const result = solved(solvePrestow(DEMO_STOW_SHIP, voyage));
    const expected = DEMO_STOW_SHIP.tanks.reduce((sum, tank) => sum + tank.cap100, 0) * 0.98 * 0.79;
    expect(result.intakeSummary?.[0].quantityMt).toBeCloseTo(expected, -2);
    expect(result.intakeSummary?.[0].limitedBy).toBe("舱容(精算)");
    expect(result.plans[0].score.tanksUsed).toBe(20);
  }, 10_000);

  it.each([
    ["single-meoh-draft", "张家港", 10.5],
    ["single-naoh-draft", "胡志明", 9.5],
  ] as const)("%s is limited by %s arrival draft", (id, port, limit) => {
    const result = solved(solvePrestow(DEMO_STOW_SHIP, sample(id)));
    const discharge = result.plans[0].stages.find(stage => stage.callId === "D1")!;
    // 精算收敛后由精算到港吃水卡限,快速引擎到港吃水略低于限值(两模型差 ≤ 0.6 m)
    expect(deepest(discharge.arrival)).toBeLessThanOrEqual(limit + 0.01);
    expect(deepest(discharge.arrival)).toBeGreaterThanOrEqual(limit - 0.6);
    expect(result.intakeSummary?.[0].limitedBy).toContain(`${port} 到港`);
    for (const stage of result.plans[0].stages) {
      expect(deepest(stage.floating)).toBeLessThanOrEqual(13.05);
      if (stage.arrival) expect(deepest(stage.arrival)).toBeLessThanOrEqual(13.05);
    }
  }, 10_000);

  it("two-port benzene binds at Zhangjiagang and keeps Nanjing arrival within 9.5 m", () => {
    const result = solved(solvePrestow(DEMO_STOW_SHIP, sample("single-benzene-two-ports")));
    const zhangjiagang = result.plans[0].stages.find(stage => stage.callId === "D1")!;
    const nanjing = result.plans[0].stages.find(stage => stage.callId === "D2")!;
    expect(deepest(zhangjiagang.arrival)).toBeLessThanOrEqual(10.51);
    expect(deepest(zhangjiagang.arrival)).toBeGreaterThanOrEqual(9.9);
    expect(deepest(nanjing.arrival)).toBeLessThanOrEqual(9.55);
    expect(result.intakeSummary?.find(item => item.parcelId === "benzene-zjg")?.limitedBy)
      .toContain("张家港 到港");
  }, 10_000);
});
