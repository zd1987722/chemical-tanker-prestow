import { DEFAULT_CONSTANTS } from "./engine";
import type { LoadLineZone, StageConsumables, StageState, StowShip, StowVoyage } from "./types";

type CargoStage = Pick<StageState, "callId" | "tanks" | "totalWeight">;

export function summarizeConsumables(stages: StageConsumables[], voyage: StowVoyage) {
  const c = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const fuelMargins = stages.slice(1).map(stage => stage.arrival.fuelMt - stage.reserveMt);
  return {
    totalNm: stages.reduce((sum, stage) => sum + stage.legNm, 0),
    totalDays: stages.reduce((sum, stage) => sum + stage.legDays + stage.portDays, 0),
    fuelBurnMt: stages.reduce((sum, stage) => sum + stage.legFuelMt + stage.portFuelMt, 0),
    fwUsedMt: stages.reduce((sum, stage) => sum + c.fwConsumptionTpd * (stage.legDays + stage.portDays), 0),
    fwMadeMt: stages.reduce((sum, stage, index) => sum + (index > 0
      ? Math.max(0, stage.arrival.freshWaterMt - stages[index - 1].departure.freshWaterMt) : 0), 0),
    minFuelMarginMt: fuelMargins.length ? Math.min(...fuelMargins) : undefined,
    minFwRobMt: stages.length ? Math.min(...stages.flatMap(stage => [stage.arrival.freshWaterMt, stage.departure.freshWaterMt])) : undefined,
  };
}

export function zoneDraftLimit(summerDraftM: number, zone?: LoadLineZone): number {
  return summerDraftM * (zone === "winter" ? 47 / 48 : zone === "tropical" ? 49 / 48 : 1);
}

export function heatedCargoTonnes(voyage: StowVoyage, stage: CargoStage): number {
  const heated = new Set(voyage.parcels.filter(p => p.heating.enabled).map(p => p.id));
  return Object.values(stage.tanks).reduce((sum, load) => sum + (load && heated.has(load.parcelId) ? load.weight : 0), 0);
}

export function isLadenLeg(ship: StowShip, stage: Pick<StageState, "totalWeight">): boolean {
  return stage.totalWeight >= ship.tanks.reduce((sum, tank) => sum + tank.cap100, 0) * 0.8 * 0.1;
}

/** Pure arithmetic: called inside the intake solver's binary search. */
export function simulateConsumables(ship: StowShip, voyage: StowVoyage, stages: CargoStage[]): StageConsumables[] {
  const c = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);
  const stageByCall = new Map(stages.map(stage => [stage.callId, stage]));
  const out: StageConsumables[] = [];
  let previous: CargoStage | undefined;
  for (const call of calls) {
    const stage = stageByCall.get(call.id)!;
    const prev = out[out.length - 1];
    const warnings: string[] = [];
    const legNm = prev ? call.distanceNm ?? 0 : 0;
    const legDays = legNm / ((call.speedKn ?? c.serviceSpeedKn) * 24) * (1 + c.seaMarginPct / 100);
    const heatedBefore = previous ? heatedCargoTonnes(voyage, previous) : 0;
    const legFuelMt = previous ? ((isLadenLeg(ship, previous) ? c.meSeaLadenTpd : c.meSeaBallastTpd) + c.aeSeaTpd + c.heatingTpdPer1000t * heatedBefore / 1000) * legDays : 0;
    const legFwMt = legDays ? (c.fwConsumptionTpd - c.fwGeneratorSeaTpd) * legDays : 0;
    const clampRob = (value: number, capacity: number, shortage: string) => {
      if (value < 0) warnings.push(`${shortage}(缺 ${(-value).toFixed(1)} t)`);
      return Math.max(0, Math.min(value, capacity));
    };
    const arrival = prev ? {
      fuelMt: clampRob(prev.departure.fuelMt - legFuelMt, Infinity, "燃油不足以到港"),
      freshWaterMt: clampRob(prev.departure.freshWaterMt - legFwMt, c.freshWaterCapacityMt, "淡水不足"),
    } : { fuelMt: c.bunkersMt, freshWaterMt: c.freshWaterMt };
    let loaded = 0, discharged = 0;
    const tankIds = new Set([...Object.keys(previous?.tanks ?? {}), ...Object.keys(stage.tanks)]);
    for (const id of Array.from(tankIds)) {
      const before = previous?.tanks[id], after = stage.tanks[id];
      if (before?.parcelId === after?.parcelId) {
        const change = (after?.weight ?? 0) - (before?.weight ?? 0);
        loaded += Math.max(0, change);
        discharged += Math.max(0, -change);
      } else {
        loaded += after?.weight ?? 0;
        discharged += before?.weight ?? 0;
      }
    }
    const portDays = (call.portHours ?? ((loaded + discharged) / c.cargoRateTph + c.portFixedHours)) / 24;
    const portFuelMt = (c.aePortTpd + (loaded > 0 ? c.cargoOpsLoadTpd : 0) + (discharged > 0 ? c.cargoOpsDischargeTpd : 0) + c.heatingTpdPer1000t * (heatedBefore + heatedCargoTonnes(voyage, stage)) / 2000) * portDays;
    const portFwMt = c.fwConsumptionTpd * portDays;
    const bunkerMt = call.bunkerMt ?? 0, freshWaterTakeMt = call.freshWaterTakeMt ?? 0;
    const departureFuel = arrival.fuelMt - portFuelMt + bunkerMt;
    if (departureFuel > c.bunkerCapacityMt) warnings.push("加油后超舱容,按舱容截断");
    const departure = {
      fuelMt: clampRob(departureFuel, c.bunkerCapacityMt, "燃油不足以到港(港内消耗后)"),
      freshWaterMt: clampRob(arrival.freshWaterMt - portFwMt + freshWaterTakeMt, c.freshWaterCapacityMt, "淡水不足"),
    };
    const reserveMt = c.bunkerReserveDays * (c.meSeaLadenTpd + c.aeSeaTpd);
    if (prev && arrival.fuelMt < reserveMt) warnings.push(`到港燃油 ROB ${arrival.fuelMt.toFixed(1)} t 低于安全余量 ${reserveMt.toFixed(1)} t`);
    const etaDay = prev ? prev.etdDay + legDays : 0;
    out.push({ legNm, legDays, portDays, etaDay, etdDay: etaDay + portDays, legFuelMt, legFwMt, portFuelMt, portFwMt, bunkerMt, freshWaterTakeMt, arrival, departure, reserveMt, warnings });
    previous = stage;
  }
  return out;
}
