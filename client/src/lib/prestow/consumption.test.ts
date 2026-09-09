import { describe, expect, it } from "vitest";
import { heatedCargoTonnes, isLadenLeg, simulateConsumables, summarizeConsumables, zoneDraftLimit } from "./consumption";
import { DEFAULT_CONSTANTS } from "./engine";
import { DEMO_STOW_SHIP as ship } from "./demo-ship";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import type { StageState, StowVoyage } from "./types";

function fixture() {
  const voyage: StowVoyage = {
    ...SAMPLE_VOYAGE,
    calls: [
      { id: "L1", seq: 0, port: "Load", berth: "", portHours: 0, distanceNm: 999 },
      { id: "D1", seq: 1, port: "Discharge", berth: "", distanceNm: 1260, portHours: 0 },
    ],
    constants: { freshWaterMt: 440 },
  };
  const stages: StageState[] = [
    { callId: "L1", tanks: { "1P": { parcelId: "meoh", weight: 8000, volume: 10000 } }, totalWeight: 8000, heelMomentTm: 0, lcgM: 0 },
    { callId: "D1", tanks: {}, totalWeight: 0, heelMomentTm: 0, lcgM: 0 },
  ];
  return { voyage, stages };
}

describe("voyage consumables", () => {
  it("summarizes actual water gains capped by tank capacity and water use with default or overridden rates", () => {
    const { voyage, stages } = fixture();
    voyage.calls[1].portHours = 24;
    for (const fwConsumptionTpd of [DEFAULT_CONSTANTS.fwConsumptionTpd, 6]) {
      if (fwConsumptionTpd === 6) voyage.constants!.fwConsumptionTpd = fwConsumptionTpd;
      const result = simulateConsumables(ship, voyage, stages);
      const summary = summarizeConsumables(result, voyage);
      expect(summary.totalNm).toBe(1260);
      expect(summary.totalDays).toBeCloseTo(result[1].legDays + 1);
      expect(summary.fuelBurnMt).toBeCloseTo(result[1].legFuelMt + result[1].portFuelMt);
      expect(summary.fwUsedMt).toBeGreaterThan(0);
      expect(summary.fwUsedMt).toBeCloseTo(fwConsumptionTpd * summary.totalDays);
      expect(summary.fwMadeMt).toBeGreaterThan(0);
      expect(summary.fwMadeMt).toBe(10);
      expect(summary.fwMadeMt).toBeLessThanOrEqual(DEFAULT_CONSTANTS.freshWaterCapacityMt - result[0].departure.freshWaterMt);
      expect(summary.minFuelMarginMt).toBe(result[1].arrival.fuelMt - result[1].reserveMt);
      expect(summary.minFwRobMt).toBe(440);
    }
  });

  it("1260 nm at 13 kn with 8% margin; ignores first leg and caps generated water", () => {
    const { voyage, stages } = fixture();
    const before = structuredClone({ voyage, stages });
    const [load, discharge] = simulateConsumables(ship, voyage, stages);
    expect(load).toMatchObject({ legNm: 0, legDays: 0, legFuelMt: 0, legFwMt: 0, etaDay: 0, etdDay: 0 });
    expect(discharge.legDays).toBeCloseTo(4.36153846, 7);
    expect(discharge.legFuelMt).toBeCloseTo(109.03846, 5);
    expect(discharge.legFwMt).toBeCloseTo(-47.976923, 5);
    expect(discharge.arrival).toEqual({ fuelMt: 1200 - discharge.legFuelMt, freshWaterMt: 450 });
    expect(discharge.etaDay).toBe(discharge.legDays);
    expect({ voyage, stages }).toEqual(before);
  });

  it("heated tonnes add 2.5 t/d for 5000 t; port heating averages arrival/departure", () => {
    const { voyage, stages } = fixture();
    stages[0].tanks = { "1P": { parcelId: "phenol", weight: 5000, volume: 5000 } };
    stages[0].totalWeight = 5000;
    voyage.calls[0].portHours = 24;
    expect(heatedCargoTonnes(voyage, stages[0])).toBe(5000);
    const result = simulateConsumables(ship, voyage, stages);
    expect(result[1].legFuelMt / result[1].legDays).toBe(27.5);
    expect(result[0].portFuelMt).toBe(4 + 2 + 1.25);
  });

  it("estimates 22 hours for 8000 t, honors explicit hours and cumulative ETA/ETD", () => {
    const { voyage, stages } = fixture();
    delete voyage.calls[0].portHours;
    const result = simulateConsumables(ship, voyage, stages);
    expect(result[0].portDays * 24).toBe(22);
    expect(result[0].portFuelMt).toBe(5.5);
    expect(result[1].etaDay).toBeCloseTo(22 / 24 + result[1].legDays, 10);
    voyage.calls[0].portHours = 18;
    expect(simulateConsumables(ship, voyage, stages)[0].portDays).toBe(0.75);
  });

  it("reports fuel shortage, zero ROB and low reserve, but reserve alone is advisory", () => {
    const { voyage, stages } = fixture();
    voyage.constants = { bunkersMt: 300, seaMarginPct: 0 };
    voyage.calls[1].distanceNm = 16 * 13 * 24;
    const result = simulateConsumables(ship, voyage, stages)[1];
    expect(result.legFuelMt).toBe(400);
    expect(result.arrival.fuelMt).toBe(0);
    expect(result.warnings).toContain("燃油不足以到港(缺 100.0 t)");
    expect(result.warnings).toContain("到港燃油 ROB 0.0 t 低于安全余量 75.0 t");
    voyage.constants.bunkersMt = 450;
    expect(simulateConsumables(ship, voyage, stages)[1].warnings).toEqual(["到港燃油 ROB 50.0 t 低于安全余量 75.0 t"]);
  });

  it("caps bunkering, takes fresh water and warns for port/sea shortages", () => {
    const { voyage, stages } = fixture();
    voyage.calls[0].bunkerMt = 1000;
    voyage.calls[0].freshWaterTakeMt = 50;
    const result = simulateConsumables(ship, voyage, stages)[0];
    expect(result.departure).toEqual({ fuelMt: 2000, freshWaterMt: 450 });
    expect(result.warnings).toContain("加油后超舱容,按舱容截断");
    voyage.calls[0].bunkerMt = 0;
    voyage.calls[0].freshWaterTakeMt = 0;
    voyage.calls[0].portHours = 24;
    voyage.constants = { bunkersMt: 1, freshWaterMt: 1, fwGeneratorSeaTpd: 0 };
    const shortages = simulateConsumables(ship, voyage, stages);
    expect(shortages[0].departure).toEqual({ fuelMt: 0, freshWaterMt: 0 });
    expect(shortages[0].warnings.join()).toMatch(/燃油不足以到港/);
    expect(shortages[0].warnings.join()).toMatch(/淡水不足/);
    expect(shortages[1].warnings.join()).toMatch(/淡水不足/);
  });

  it("uses ballast ME below 10% capacity weight and explicit leg speed", () => {
    const { voyage, stages } = fixture();
    stages[0].totalWeight = 0;
    stages[0].tanks = {};
    voyage.calls[1].speedKn = 10;
    expect(isLadenLeg(ship, stages[0])).toBe(false);
    const c = simulateConsumables(ship, voyage, stages)[1];
    expect(c.legDays).toBeCloseTo(1260 / 240 * 1.08, 10);
    expect(c.legFuelMt / c.legDays).toBe(22);
    expect(isLadenLeg(ship, { totalWeight: ship.tanks.reduce((sum, t) => sum + t.cap100, 0) * 0.8 * 0.1 })).toBe(true);
  });

  it("uses summer, winter and tropical draft limits", () => {
    expect(zoneDraftLimit(13)).toBe(13);
    expect(zoneDraftLimit(13, "summer")).toBe(13);
    expect(zoneDraftLimit(13, "winter")).toBeCloseTo(12.7291667, 6);
    expect(zoneDraftLimit(13, "tropical")).toBeCloseTo(13.2708333, 6);
  });
});
