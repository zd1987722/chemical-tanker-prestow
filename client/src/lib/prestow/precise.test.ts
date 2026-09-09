import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resetRuntimeExceptionsForTest,
  setRuntimeExceptions,
} from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { simulateStages } from "./engine";
import { refineIntakePrecise, solveIntake } from "./intake";
import { precisePlanStages } from "./precise";
import { findSampleVoyage } from "./sample-voyages";
import type { Allocation, Parcel, StowPlan, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

describe("precise intake refinement", () => {
  it("只缩放变量票 fillRatio 并按舱容重算 intake", () => {
    const calls = [
      { id: "L1", seq: 0, port: "Load", berth: "1" },
      { id: "D1", seq: 1, port: "Discharge", berth: "1" },
    ];
    const parcel = (
      id: string,
      density: number,
      intake?: Parcel["intake"]
    ): Parcel => ({
      id,
      productId: null,
      name: id,
      display: id,
      group: 20,
      quantityMt: intake ? 0 : 1,
      density,
      loadCallId: "L1",
      dischargeCallId: "D1",
      heating: { enabled: false },
      boilPointC: 100,
      meltPointC: -50,
      polymerizable: false,
      maxAllowedTempC: null,
      intake,
    });
    const voyage: StowVoyage = {
      shipId: DEMO_STOW_SHIP.id,
      voyageNo: "REFINE",
      calls,
      parcels: [
        parcel("fixed", 1),
        parcel("variable", 0.8, { mode: "priority", priority: 1 }),
      ],
    };
    const allocations: Allocation[] = [
      { parcelId: "fixed", tanks: ["1P"], fillRatio: 0.4 },
      { parcelId: "variable", tanks: ["2P", "2S"], fillRatio: 0.8 },
    ];
    const stages = simulateStages(DEMO_STOW_SHIP, voyage, allocations, false);
    const plan: StowPlan = {
      key: "refine",
      allocations,
      stages,
      advisories: [],
      score: {
        tanksUsed: 3,
        unpairedTanks: 1,
        maxHeelMoment: 0,
        maxLcgShift: 0,
        advisoryCount: 0,
        minGm: 0,
        maxBmPct: 0,
      },
      consumablesOk: true,
      draftOk: true,
      stabilityOk: true,
      strengthOk: true,
      strengthChecked: false,
    };
    const fixedWeight = stages[0].tanks["1P"]!.weight;
    const variableWeight = stages[0].totalWeight - fixedWeight;
    const targetWeight = fixedWeight + variableWeight * 0.95;
    const refined = refineIntakePrecise(
      DEMO_STOW_SHIP,
      voyage,
      plan,
      stage => (targetWeight - stage.totalWeight) / 1000
    );
    const fixed = refined.plan.allocations.find(
      allocation => allocation.parcelId === "fixed"
    )!;
    const variable = refined.plan.allocations.find(
      allocation => allocation.parcelId === "variable"
    )!;
    const expectedIntake = variable.tanks.reduce(
      (sum, tankId) =>
        sum +
        DEMO_STOW_SHIP.tanks.find(tank => tank.id === tankId)!.cap100 *
          variable.fillRatio *
          0.8,
      0
    );

    expect(fixed).toEqual(allocations[0]);
    expect(variable.tanks).toEqual(allocations[1].tanks);
    expect(variable.fillRatio).toBeCloseTo(0.8 * 0.95, 10);
    expect(refined.intake.variable).toBeCloseTo(expectedIntake, 10);
  });

  it("收敛苯两卸港示例且固定票保持 6,000 t", () => {
    const voyage = findSampleVoyage("single-benzene-two-ports")!.voyage;
    const result = solveIntake(DEMO_STOW_SHIP, voyage);
    if (result.status === "invalid") throw new Error(result.errors.join());

    const plan = result.plans[0];
    const precise = precisePlanStages(DEMO_STOW_SHIP, voyage, plan);
    const bindingMargin = precise.D1.arrival?.draftMargin;
    const variable = result.intakeSummary!.find(
      item => item.parcelId === "benzene-zjg"
    )!;
    const fixedParcel = voyage.parcels.find(
      parcel => parcel.id === "benzene-njg"
    )!;
    const fixedAllocation = plan.allocations.find(
      allocation => allocation.parcelId === fixedParcel.id
    )!;
    const fixedQuantity = fixedAllocation.tanks.reduce(
      (sum, tankId) =>
        sum +
        DEMO_STOW_SHIP.tanks.find(tank => tank.id === tankId)!.cap100 *
          fixedAllocation.fillRatio *
          fixedParcel.density,
      0
    );

    expect(bindingMargin).toBeGreaterThanOrEqual(-0.01);
    expect(bindingMargin).toBeLessThanOrEqual(0.05);
    expect(variable.quantityMt).toBeGreaterThan(22_000);
    expect(variable.quantityMt).toBeLessThan(26_000);
    expect(variable.limitedBy).toMatch(/张家港 到港.*\(精算\)$/);
    expect(fixedQuantity).toBeCloseTo(6_000, 6);
    expect(result.message).not.toContain("精算后仍超限");
  });
});


it("precise arrival/departure displacement follows each stage ROB", () => {
  const voyage = findSampleVoyage("single-meoh-draft")!.voyage;
  const result = solveIntake(DEMO_STOW_SHIP, voyage);
  if (result.status === "invalid") throw new Error(result.errors.join());
  const plan = result.plans[0];
  const precise = precisePlanStages(DEMO_STOW_SHIP, voyage, plan);
  const departure = precise.L1.floating!, arrival = precise.D1.arrival!;
  const start = plan.stages[0].consumables!.departure, end = plan.stages[1].consumables!.arrival;
  expect((departure.displacement - departure.ballastMt) - (arrival.displacement - arrival.ballastMt))
    .toBeCloseTo(start.fuelMt + start.freshWaterMt - end.fuelMt - end.freshWaterMt, 5);
  const endDeparture = precise.D1.floating!, c = plan.stages[1].consumables!;
  expect((arrival.displacement - arrival.ballastMt) - (endDeparture.displacement - endDeparture.ballastMt))
    .toBeCloseTo(plan.stages[0].totalWeight + c.portFuelMt + c.portFwMt, 5);
});
