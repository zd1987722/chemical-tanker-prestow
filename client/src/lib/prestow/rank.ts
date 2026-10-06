import type { PlanScore, StowPlan, StowShip } from "./types";
import { planFeasible, stageDraftMargin } from "./engine";

export function scorePlan(plan: StowPlan, _ship: StowShip): PlanScore {
  const used = new Set(plan.allocations.flatMap(a => a.tanks));
  let unpaired = 0;
  for (const t of Array.from(used)) {
    const mate = t.endsWith("P") ? t.slice(0, -1) + "S" : t.slice(0, -1) + "P";
    if (!used.has(mate)) unpaired++;
  }
  let heel = 0, shift = 0;
  for (const s of plan.stages) {
    if (s.totalWeight <= 0) continue;
    heel = Math.max(heel, Math.abs(s.heelMomentTm));
    shift = Math.max(shift, Math.abs(s.lcgM - _ship.refLcg));
  }
  const margins = plan.stages
    .map(stageDraftMargin)
    .filter((margin): margin is number => margin != null);
  const gmValues = plan.stages
    .flatMap(stage => [stage.floating?.gmCorrected, stage.arrival?.gmCorrected])
    .filter((gm): gm is number => gm != null);
  const bmValues = plan.stages
    .flatMap(stage => [stage.floating?.bmPct, stage.arrival?.bmPct])
    .filter((bm): bm is number => bm != null);
  const bunkerMargins = plan.stages.slice(1).flatMap(stage => stage.consumables
    ? [stage.consumables.arrival.fuelMt - stage.consumables.reserveMt] : []);
  return {
    minBunkerMarginMt: bunkerMargins.length ? Math.min(...bunkerMargins) : undefined,
    tanksUsed: used.size,
    unpairedTanks: unpaired,
    maxHeelMoment: heel,
    maxLcgShift: shift,
    advisoryCount: plan.advisories.length,
    minDraftMargin: margins.length ? Math.min(...margins) : Infinity,
    minGm: gmValues.length ? Math.min(...gmValues) : Infinity,
    maxBmPct: bmValues.length ? Math.max(...bmValues) : 0,
  };
}

export function comparePlans(a: StowPlan, b: StowPlan): number {
  const A = a.score, B = b.score;
  const draftBucket = (margin: number | undefined) => Number.isFinite(margin) ? Math.round(margin! / 0.1) : 0;
  return (
    Number(!planFeasible(a)) - Number(!planFeasible(b)) ||
    A.tanksUsed - B.tanksUsed ||
    A.unpairedTanks - B.unpairedTanks ||
    Math.round(A.maxHeelMoment / 100) - Math.round(B.maxHeelMoment / 100) ||
    Math.round(A.maxLcgShift / 0.5) - Math.round(B.maxLcgShift / 0.5) ||
    A.advisoryCount - B.advisoryCount ||
    draftBucket(B.minDraftMargin) - draftBucket(A.minDraftMargin) ||
    a.key.localeCompare(b.key)
  );
}
