import { tankAtLevel, tankCapacity, tankFill } from "../hull";
import { computeCondition, levelFromWeight } from "../loadcalc/engine";
import type {
  ConditionResult,
  FixedWeight,
  LoadingCondition,
  TankLoad,
} from "../loadcalc/types";
import { DEMO_SHIP } from "../hull/ship-demo";
import { fastFloating } from "../prestow/hydro-fast";
import { strengthFromCondition } from "../strength";
import type { StrengthResult } from "../strength";

export interface BallastTargets {
  trimMin: number;
  trimMax: number;
  trimTarget?: number;
  dmMin?: number;
  draftFwdMin?: number;
  propellerZTop?: number;
  preferredUnits?: string[];
  gmMin: number;
  maxHeel: number;
  bmPctMax: number;
  sfPctMax: number;
}

export const DEFAULT_TARGETS: BallastTargets = {
  trimMin: 0,
  trimMax: 0.5,
  gmMin: 0.3,
  maxHeel: 0.5,
  bmPctMax: 95,
  sfPctMax: 95,
};

export interface AutoBallastInput {
  cargo: TankLoad[];
  fuel: TankLoad[];
  constants: FixedWeight[];
  rho: number;
  targets?: Partial<BallastTargets>;
  allowedTanks?: string[];
}

export interface AutoBallastResult {
  ballast: TankLoad[];
  condition: ConditionResult;
  strength: StrengthResult;
  gmCorrected: number;
  achieved: {
    trim: number;
    draftMid: number;
    draftAft: number;
    draftFwd: number;
    heel: number;
    gm: number;
    bmPct: number;
    sfPct: number;
  };
  ok: boolean;
  iterations: number;
  notes: string[];
}

interface UnitDefinition {
  id: string;
  compIds: readonly string[];
  order: number;
}

interface BallastUnit extends UnitDefinition {
  capacity: number;
  lcg: number;
  vcg: number;
}

interface TankPoint {
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
}

interface EvaluatedCandidate extends AutoBallastResult {
  unitWeights: number[];
  score: number;
}

type DistributionMode = "ends" | "middle" | "lowVcg";

export const FWD = ["FPT", "WB1P", "WB1S", "WB2P", "WB2S"] as const;
export const AFT = ["APT", "WB5P", "WB5S", "WB4P", "WB4S"] as const;
export const MID = ["WB3P", "WB3S"] as const;

const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  { id: "FPT", compIds: ["FPT"], order: 0 },
  { id: "WB1", compIds: ["WB1P", "WB1S"], order: 1 },
  { id: "WB2", compIds: ["WB2P", "WB2S"], order: 2 },
  { id: "WB3", compIds: ["WB3P", "WB3S"], order: 3 },
  { id: "WB4", compIds: ["WB4P", "WB4S"], order: 4 },
  { id: "WB5", compIds: ["WB5P", "WB5S"], order: 5 },
  { id: "APT", compIds: ["APT"], order: 6 },
];

const MAX_EXACT_EVALUATIONS = 40;
const SEARCH_POINTS = 19;
const REFINEMENT_STEPS = 4;
const MAX_EVALUATIONS_PER_AMOUNT = 5;
const MAX_SOLVER_TRIM = 5;
const EPSILON = 1e-7;
const TRIM_SCORE_STEP = 0.1;
const DEFAULT_PROPELLER_Z_TOP =
  DEMO_SHIP.geometry.propeller.z + DEMO_SHIP.geometry.propeller.diameter / 2;

const fastTankCache = new Map<
  string,
  {
    capacityVolume: number;
    half: Omit<TankPoint, "weight">;
    full: Omit<TankPoint, "weight">;
  }
>();

function targetsWithDefaults(
  targets?: Partial<BallastTargets>
): BallastTargets {
  const result = { ...DEFAULT_TARGETS, ...targets };
  if (
    result.propellerZTop == null &&
    (targets?.dmMin != null || targets?.draftFwdMin != null)
  ) result.propellerZTop = DEFAULT_PROPELLER_Z_TOP;
  return result;
}

function targetTrim(targets: BallastTargets): number {
  return targets.trimTarget ?? (targets.trimMin + targets.trimMax) / 2;
}

function exactTankPoint(
  compId: string,
  fraction: number,
  rho: number
): TankPoint {
  if (fraction <= 0) return { weight: 0, lcg: 0, tcg: 0, vcg: 0 };
  const capacity = tankCapacity(compId).capacity100;
  const state = tankFill(compId, capacity * Math.min(1, fraction));
  return {
    weight: state.volume * rho,
    lcg: state.lcg,
    tcg: state.tcg,
    vcg: state.vcg,
  };
}

function fastTankGeometry(compId: string): {
  capacityVolume: number;
  half: Omit<TankPoint, "weight">;
  full: Omit<TankPoint, "weight">;
} {
  const cached = fastTankCache.get(compId);
  if (cached) return cached;
  const capacityVolume = tankCapacity(compId).capacity100;
  const halfState = tankFill(compId, capacityVolume * 0.5);
  const fullState = tankFill(compId, capacityVolume);
  const result = {
    capacityVolume,
    half: { lcg: halfState.lcg, tcg: halfState.tcg, vcg: halfState.vcg },
    full: { lcg: fullState.lcg, tcg: fullState.tcg, vcg: fullState.vcg },
  };
  fastTankCache.set(compId, result);
  return result;
}

function fastTankPoint(
  compId: string,
  fraction: number,
  rho: number
): TankPoint {
  if (fraction <= 0) return { weight: 0, lcg: 0, tcg: 0, vcg: 0 };
  const geometry = fastTankGeometry(compId);
  const bounded = Math.min(1, fraction);
  const blend = bounded <= 0.5 ? 0 : (bounded - 0.5) / 0.5;
  const interpolate = (key: "lcg" | "tcg" | "vcg") =>
    geometry.half[key] + blend * (geometry.full[key] - geometry.half[key]);
  return {
    weight: geometry.capacityVolume * bounded * rho,
    lcg: interpolate("lcg"),
    tcg: interpolate("tcg"),
    vcg: interpolate("vcg"),
  };
}

function availableUnits(rho: number, allowedTanks?: string[]): BallastUnit[] {
  const allowed = allowedTanks ? new Set(allowedTanks) : undefined;
  return UNIT_DEFINITIONS.filter(unit =>
    unit.compIds.every(compId => allowed?.has(compId) ?? true)
  ).map(unit => {
    const full = unit.compIds.map(compId => exactTankPoint(compId, 1, rho));
    const capacity = full.reduce((sum, point) => sum + point.weight, 0);
    return {
      ...unit,
      capacity,
      lcg:
        full.reduce((sum, point) => sum + point.weight * point.lcg, 0) /
        capacity,
      vcg:
        full.reduce((sum, point) => sum + point.weight * point.vcg, 0) /
        capacity,
    };
  });
}

function unitPoints(
  units: BallastUnit[],
  weights: number[],
  rho: number,
  fast: boolean
): TankPoint[] {
  return units.map((unit, index) => {
    const fraction = unit.capacity > 0 ? weights[index] / unit.capacity : 0;
    const tanks = unit.compIds.map(compId =>
      fast
        ? fastTankPoint(compId, fraction, rho)
        : exactTankPoint(compId, fraction, rho)
    );
    const weight = tanks.reduce((sum, point) => sum + point.weight, 0);
    if (weight <= EPSILON) return { weight: 0, lcg: 0, tcg: 0, vcg: 0 };
    return {
      weight,
      lcg:
        tanks.reduce((sum, point) => sum + point.weight * point.lcg, 0) /
        weight,
      tcg:
        tanks.reduce((sum, point) => sum + point.weight * point.tcg, 0) /
        weight,
      vcg:
        tanks.reduce((sum, point) => sum + point.weight * point.vcg, 0) /
        weight,
    };
  });
}

function vectorMoment(
  units: BallastUnit[],
  weights: number[],
  rho: number,
  fast: boolean
): number {
  return unitPoints(units, weights, rho, fast).reduce(
    (sum, point) => sum + point.weight * point.lcg,
    0
  );
}

function greedyWeights(
  units: BallastUnit[],
  total: number,
  orderedIndexes: number[]
): number[] {
  const result = units.map(() => 0);
  let remaining = Math.min(
    total,
    units.reduce((sum, unit) => sum + unit.capacity, 0)
  );
  for (const index of orderedIndexes) {
    const amount = Math.min(units[index].capacity, remaining);
    result[index] = amount;
    remaining -= amount;
    if (remaining <= EPSILON) break;
  }
  return result;
}

function mixWeights(from: number[], to: number[], fraction: number): number[] {
  return from.map((weight, index) => weight + fraction * (to[index] - weight));
}

function allocateForMoment(
  units: BallastUnit[],
  total: number,
  targetMoment: number,
  rho: number,
  mode: DistributionMode,
  fast: boolean,
  preferredUnits: string[] = [],
): number[] {
  if (total <= EPSILON || units.length === 0) return units.map(() => 0);
  const indexes = units.map((_, index) => index);
  const forward = greedyWeights(
    units,
    total,
    [...indexes].sort(
      (a, b) => units[b].lcg - units[a].lcg || units[a].order - units[b].order
    )
  );
  const aft = greedyWeights(
    units,
    total,
    [...indexes].sort(
      (a, b) => units[a].lcg - units[b].lcg || units[a].order - units[b].order
    )
  );

  let base: number[];
  if (mode === "ends") {
    base = aft;
  } else {
    const targetLcg = targetMoment / total;
    const ordered = [...indexes].sort((a, b) => {
      if (mode === "middle" && preferredUnits.length) {
        const rank = preferredUnitRank(units[a], preferredUnits) -
          preferredUnitRank(units[b], preferredUnits);
        if (rank !== 0) return rank;
      }
      const aValue =
        mode === "lowVcg" ? units[a].vcg : Math.abs(units[a].lcg - targetLcg);
      const bValue =
        mode === "lowVcg" ? units[b].vcg : Math.abs(units[b].lcg - targetLcg);
      return aValue - bValue || units[a].order - units[b].order;
    });
    base = greedyWeights(units, total, ordered);
  }

  const baseMoment = vectorMoment(units, base, rho, fast);
  const forwardMoment = vectorMoment(units, forward, rho, fast);
  const aftMoment = vectorMoment(units, aft, rho, fast);
  if (targetMoment >= forwardMoment) return forward;
  if (targetMoment <= aftMoment) return aft;

  const endpoint = targetMoment >= baseMoment ? forward : aft;
  const endpointMoment = targetMoment >= baseMoment ? forwardMoment : aftMoment;
  if (Math.abs(endpointMoment - baseMoment) <= EPSILON) return base;

  let low = 0;
  let high = 1;
  let best = base;
  let bestError = Math.abs(baseMoment - targetMoment);
  const increasing = endpointMoment > baseMoment;
  for (let iteration = 0; iteration < 24; iteration++) {
    const fraction = (low + high) / 2;
    const candidate = mixWeights(base, endpoint, fraction);
    const moment = vectorMoment(units, candidate, rho, fast);
    const error = Math.abs(moment - targetMoment);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
    if (moment < targetMoment === increasing) low = fraction;
    else high = fraction;
  }
  return best;
}

function preferredUnitRank(
  unit: Pick<BallastUnit, "id" | "compIds">,
  preferredUnits: string[],
): number {
  for (let index = 0; index < preferredUnits.length; index++) {
    const preferred = preferredUnits[index];
    if (unit.id === preferred || unit.compIds.includes(preferred)) return index;
  }
  return preferredUnits.length;
}

function exactBallastLoads(
  units: BallastUnit[],
  weights: number[],
  rho: number
): TankLoad[] {
  return units.flatMap((unit, index) => {
    if (weights[index] <= EPSILON) return [];
    const fraction = Math.min(1, weights[index] / unit.capacity);
    return unit.compIds.map(compId => {
      const weight = tankCapacity(compId).capacity100 * rho * fraction;
      return {
        compId,
        density: rho,
        level: levelFromWeight(compId, weight, rho),
      };
    });
  });
}

function loadingCondition(
  input: AutoBallastInput,
  ballast: TankLoad[]
): LoadingCondition {
  return {
    id: "auto-ballast",
    name: "自动配平",
    waterDensity: input.rho,
    tanks: [...input.cargo, ...input.fuel, ...ballast],
    constants: input.constants,
    createdAt: "",
    updatedAt: "",
  };
}

function maxPercentage(
  strength: StrengthResult,
  key: "bmPct" | "sfPct"
): number {
  return strength.points.reduce(
    (maximum, point) => Math.max(maximum, point[key]),
    0
  );
}

function isTargetMet(
  achieved: AutoBallastResult["achieved"],
  targets: BallastTargets
): boolean {
  return (
    targets.trimMin <= targets.trimMax &&
    targets.trimMin >= -MAX_SOLVER_TRIM &&
    targets.trimMax <= MAX_SOLVER_TRIM &&
    achieved.trim >= targets.trimMin &&
    achieved.trim <= targets.trimMax &&
    (targets.dmMin == null || achieved.draftMid >= targets.dmMin) &&
    (targets.draftFwdMin == null || achieved.draftFwd >= targets.draftFwdMin) &&
    (targets.propellerZTop == null || achieved.draftAft >= targets.propellerZTop) &&
    Math.abs(achieved.heel) <= targets.maxHeel &&
    achieved.gm >= targets.gmMin &&
    achieved.bmPct <= targets.bmPctMax &&
    achieved.sfPct <= targets.sfPctMax
  );
}

function isTargetMetExceptHeel(
  achieved: AutoBallastResult["achieved"],
  targets: BallastTargets
): boolean {
  return (
    targets.trimMin <= targets.trimMax &&
    targets.trimMin >= -MAX_SOLVER_TRIM &&
    targets.trimMax <= MAX_SOLVER_TRIM &&
    achieved.trim >= targets.trimMin &&
    achieved.trim <= targets.trimMax &&
    (targets.dmMin == null || achieved.draftMid >= targets.dmMin) &&
    (targets.draftFwdMin == null || achieved.draftFwd >= targets.draftFwdMin) &&
    (targets.propellerZTop == null || achieved.draftAft >= targets.propellerZTop) &&
    achieved.gm >= targets.gmMin &&
    achieved.bmPct <= targets.bmPctMax &&
    achieved.sfPct <= targets.sfPctMax
  );
}

function isTargetMetExceptTrim(
  achieved: AutoBallastResult["achieved"],
  targets: BallastTargets
): boolean {
  return (
    targets.trimMin <= targets.trimMax &&
    targets.trimMin >= -MAX_SOLVER_TRIM &&
    targets.trimMax <= MAX_SOLVER_TRIM &&
    (targets.dmMin == null || achieved.draftMid >= targets.dmMin) &&
    (targets.draftFwdMin == null || achieved.draftFwd >= targets.draftFwdMin) &&
    (targets.propellerZTop == null || achieved.draftAft >= targets.propellerZTop) &&
    Math.abs(achieved.heel) <= targets.maxHeel &&
    achieved.gm >= targets.gmMin &&
    achieved.bmPct <= targets.bmPctMax &&
    achieved.sfPct <= targets.sfPctMax
  );
}

function violationScore(
  achieved: AutoBallastResult["achieved"],
  targets: BallastTargets
): number {
  const trimError =
    achieved.trim < targets.trimMin
      ? targets.trimMin - achieved.trim
      : Math.max(0, achieved.trim - targets.trimMax);
  const heelError = Math.max(0, Math.abs(achieved.heel) - targets.maxHeel);
  const gmError = Math.max(0, targets.gmMin - achieved.gm);
  const dmError = Math.max(0, (targets.dmMin ?? achieved.draftMid) - achieved.draftMid);
  const draftFwdError = Math.max(
    0,
    (targets.draftFwdMin ?? achieved.draftFwd) - achieved.draftFwd,
  );
  const propellerError = Math.max(
    0,
    (targets.propellerZTop ?? achieved.draftAft) - achieved.draftAft,
  );
  const bmError = Math.max(0, achieved.bmPct - targets.bmPctMax) / 10;
  const sfError = Math.max(0, achieved.sfPct - targets.sfPctMax) / 10;
  return (
    trimError ** 2 + heelError ** 2 + gmError ** 2 + dmError ** 2 +
    draftFwdError ** 2 + propellerError ** 2 + bmError ** 2 + sfError ** 2
  );
}

function evaluateCandidate(
  input: AutoBallastInput,
  targets: BallastTargets,
  units: BallastUnit[],
  unitWeights: number[],
  iterations: number
): EvaluatedCandidate {
  const ballast = exactBallastLoads(units, unitWeights, input.rho);
  const condition = computeCondition(loadingCondition(input, ballast));
  const strength = strengthFromCondition(condition, "sea");
  const achieved = {
    trim: condition.floating.trim,
    draftMid: condition.floating.draftMid,
    draftAft: condition.floating.draftAft,
    draftFwd: condition.floating.draftFwd,
    heel: condition.floating.heel,
    gm: condition.floating.gmCorrected,
    bmPct: maxPercentage(strength, "bmPct"),
    sfPct: maxPercentage(strength, "sfPct"),
  };
  return {
    ballast,
    condition,
    strength,
    gmCorrected: achieved.gm,
    achieved,
    ok: isTargetMet(achieved, targets),
    iterations,
    notes: [],
    unitWeights,
    score: violationScore(achieved, targets),
  };
}

function heelCorrectedCandidate(
  input: AutoBallastInput,
  targets: BallastTargets,
  units: BallastUnit[],
  candidate: EvaluatedCandidate,
  iterations: number
): EvaluatedCandidate {
  if (Math.abs(candidate.achieved.heel) <= targets.maxHeel) return candidate;
  const weights = new Map(
    candidate.ballast.map(load => [
      load.compId,
      tankAtLevel(load.compId, load.level).volume * load.density,
    ])
  );
  let transverseMoment =
    candidate.condition.groups.total.weight *
    candidate.condition.groups.total.tcg;
  const momentOf = (compId: string, weight: number): number =>
    weight > EPSILON ? weight * tankFill(compId, weight / input.rho).tcg : 0;
  const correctionAmount = (
    maximum: number,
    momentDelta: (amount: number) => number
  ): number => {
    if (maximum <= EPSILON) return 0;
    const initialMoment = transverseMoment;
    const maximumMoment = initialMoment + momentDelta(maximum);
    if (initialMoment * maximumMoment > 0) return maximum;

    let low = 0;
    let high = maximum;
    let best = maximum;
    let bestError = Math.abs(maximumMoment);
    for (let iteration = 0; iteration < 20; iteration++) {
      const amount = (low + high) / 2;
      const correctedMoment = initialMoment + momentDelta(amount);
      const error = Math.abs(correctedMoment);
      if (error < bestError) {
        best = amount;
        bestError = error;
      }
      if (error <= 1) return amount;
      if (initialMoment * correctedMoment > 0) low = amount;
      else high = amount;
    }
    return best;
  };
  const pairs = units
    .filter(unit => unit.compIds.length === 2)
    .sort((a, b) => {
      const preferredUnits = targets.preferredUnits ?? [];
      return preferredUnitRank(a, preferredUnits) -
        preferredUnitRank(b, preferredUnits) ||
        a.vcg - b.vcg ||
        a.order - b.order;
    });

  for (const unit of pairs) {
    if (Math.abs(transverseMoment) <= 1) break;
    const portId = unit.compIds.find(compId => compId.endsWith("P"));
    const starboardId = unit.compIds.find(compId => compId.endsWith("S"));
    if (!portId || !starboardId) continue;
    const desiredId = transverseMoment > 0 ? portId : starboardId;
    const oppositeId = transverseMoment > 0 ? starboardId : portId;
    const desiredCapacity = tankCapacity(desiredId).capacity100 * input.rho;
    const oppositeCapacity = tankCapacity(oppositeId).capacity100 * input.rho;
    let desiredWeight = weights.get(desiredId) ?? 0;
    let oppositeWeight = weights.get(oppositeId) ?? 0;
    const transferMoment = (amount: number) =>
      momentOf(desiredId, desiredWeight + amount) +
      momentOf(oppositeId, oppositeWeight - amount) -
      momentOf(desiredId, desiredWeight) -
      momentOf(oppositeId, oppositeWeight);
    const transfer = correctionAmount(
      Math.min(oppositeWeight, desiredCapacity - desiredWeight),
      transferMoment
    );
    transverseMoment += transferMoment(transfer);
    desiredWeight += transfer;
    oppositeWeight -= transfer;

    const sourceIds = Array.from(weights.keys())
      .filter(
        compId =>
          compId !== desiredId &&
          compId !== oppositeId &&
          (weights.get(compId) ?? 0) > EPSILON
      )
      .sort((a, b) => {
        const desiredLcg = tankFill(
          desiredId,
          tankCapacity(desiredId).capacity100 * 0.5
        ).lcg;
        const distance = (compId: string) =>
          Math.abs(
            tankFill(compId, tankCapacity(compId).capacity100 * 0.5).lcg -
              desiredLcg
          );
        return distance(a) - distance(b);
      });
    for (const sourceId of sourceIds) {
      if (Math.abs(transverseMoment) <= 1) break;
      const sourceWeight = weights.get(sourceId) ?? 0;
      const desiredMoment = momentOf(desiredId, desiredWeight);
      const sourceMoment = momentOf(sourceId, sourceWeight);
      const replacementMoment = (amount: number) =>
        momentOf(desiredId, desiredWeight + amount) +
        momentOf(sourceId, sourceWeight - amount) -
        desiredMoment -
        sourceMoment;
      const replacement = correctionAmount(
        Math.min(sourceWeight, desiredCapacity - desiredWeight),
        replacementMoment
      );
      transverseMoment += replacementMoment(replacement);
      desiredWeight += replacement;
      weights.set(sourceId, sourceWeight - replacement);
    }

    if (Math.abs(transverseMoment) > 1) {
      const desiredMoment = momentOf(desiredId, desiredWeight);
      const additionMoment = (amount: number) =>
        momentOf(desiredId, desiredWeight + amount) - desiredMoment;
      const addition = correctionAmount(
        desiredCapacity - desiredWeight,
        additionMoment
      );
      transverseMoment += additionMoment(addition);
      desiredWeight += addition;
    }
    if (Math.abs(transverseMoment) > 1) {
      const oppositeMoment = momentOf(oppositeId, oppositeWeight);
      const removalMoment = (amount: number) =>
        momentOf(oppositeId, oppositeWeight - amount) - oppositeMoment;
      const removal = correctionAmount(oppositeWeight, removalMoment);
      transverseMoment += removalMoment(removal);
      oppositeWeight -= removal;
    }
    weights.set(desiredId, desiredWeight);
    weights.set(oppositeId, oppositeWeight);
  }

  const correctedUnits = units.flatMap(unit =>
    unit.compIds.map(compId => {
      const full = exactTankPoint(compId, 1, input.rho);
      return {
        id: compId,
        compIds: [compId],
        order: unit.order,
        capacity: full.weight,
        lcg: full.lcg,
        vcg: full.vcg,
      };
    })
  );
  return evaluateCandidate(
    input,
    targets,
    correctedUnits,
    correctedUnits.map(unit => weights.get(unit.id) ?? 0),
    iterations
  );
}

function targetTotalMoment(
  weight: number,
  rho: number,
  targetTrim: number
): number {
  const hydro = fastFloating(weight, 0, rho);
  const targetLcg = hydro.lcb - (targetTrim * 100 * hydro.mtc) / weight;
  return targetLcg * weight;
}

function searchAmounts(minimum: number, maximum: number): number[] {
  if (maximum <= EPSILON) return [];
  const from = Math.min(minimum, maximum);
  if (Math.abs(maximum - from) <= EPSILON) return [maximum];
  return Array.from(
    { length: SEARCH_POINTS },
    (_, index) => from + (index * (maximum - from)) / (SEARCH_POINTS - 1)
  );
}

function notesForResult(
  result: AutoBallastResult,
  targets: BallastTargets,
  hasUnits: boolean
): string[] {
  const notes: string[] = [];
  if (!hasUnits) notes.push("没有可用的压载舱。");
  if (
    targets.trimMin > targets.trimMax ||
    targets.trimMin < -MAX_SOLVER_TRIM ||
    targets.trimMax > MAX_SOLVER_TRIM
  ) {
    notes.push(`纵倾目标超出求解范围 ±${MAX_SOLVER_TRIM.toFixed(1)} m。`);
  }
  if (
    result.achieved.trim < targets.trimMin ||
    result.achieved.trim > targets.trimMax
  ) {
    notes.push(
      `纵倾 ${result.achieved.trim.toFixed(2)} m 未进入 ${targets.trimMin.toFixed(2)}–${targets.trimMax.toFixed(2)} m。`
    );
  }
  if (Math.abs(result.achieved.heel) > targets.maxHeel) {
    notes.push(
      `横倾 ${result.achieved.heel.toFixed(2)}° 超过 ${targets.maxHeel.toFixed(2)}°。`
    );
  }
  if (result.achieved.gm < targets.gmMin) {
    notes.push(
      `GM ${result.achieved.gm.toFixed(2)} m 低于 ${targets.gmMin.toFixed(2)} m。`
    );
  }
  if (targets.dmMin != null && result.achieved.draftMid < targets.dmMin) {
    notes.push(
      `dm ${result.achieved.draftMid.toFixed(2)} m 低于 ${targets.dmMin.toFixed(2)} m。`
    );
  }
  if (
    targets.draftFwdMin != null &&
    result.achieved.draftFwd < targets.draftFwdMin
  ) {
    notes.push(
      `艏吃水 ${result.achieved.draftFwd.toFixed(2)} m 低于 ${targets.draftFwdMin.toFixed(2)} m。`
    );
  }
  if (
    targets.propellerZTop != null &&
    result.achieved.draftAft < targets.propellerZTop
  ) {
    notes.push("螺旋桨未全浸。");
  }
  if (result.achieved.bmPct > targets.bmPctMax) {
    notes.push(
      `BM 利用率 ${result.achieved.bmPct.toFixed(1)}% 超过 ${targets.bmPctMax.toFixed(1)}%。`
    );
  }
  if (result.achieved.sfPct > targets.sfPctMax) {
    notes.push(
      `SF 利用率 ${result.achieved.sfPct.toFixed(1)}% 超过 ${targets.sfPctMax.toFixed(1)}%。`
    );
  }
  return notes;
}

export function autoBallast(input: AutoBallastInput): AutoBallastResult {
  const targets = targetsWithDefaults(input.targets);
  const units = availableUnits(input.rho, input.allowedTanks);
  const zeroWeights = units.map(() => 0);
  let evaluations = 1;
  const base = evaluateCandidate(
    input,
    targets,
    units,
    zeroWeights,
    evaluations
  );
  let best = base;
  let bestFeasible = base.ok ? base : undefined;
  if (base.ok && input.targets?.trimTarget == null) return base;

  const maximumBallast = units.reduce((sum, unit) => sum + unit.capacity, 0);
  const baseWeight = base.condition.groups.total.weight;
  const baseMoment = baseWeight * base.condition.groups.total.lcg;
  const desiredTrim = targetTrim(targets);
  const initialMode: DistributionMode =
    base.achieved.gm < targets.gmMin
      ? "lowVcg"
      : base.strength.maxBm.kind === "sagging"
        ? "ends"
        : "middle";

  const evaluateBallastWeight = (
    ballastWeight: number
  ): EvaluatedCandidate | undefined => {
    if (ballastWeight <= EPSILON || evaluations >= MAX_EXACT_EVALUATIONS - 1)
      return undefined;
    const totalWeight = baseWeight + ballastWeight;
    const desiredBallastMoment =
      targetTotalMoment(totalWeight, input.rho, desiredTrim) - baseMoment;
    let unitWeights = allocateForMoment(
      units,
      ballastWeight,
      desiredBallastMoment,
      input.rho,
      initialMode,
      false,
      targets.preferredUnits,
    );
    let candidate = evaluateCandidate(
      input,
      targets,
      units,
      unitWeights,
      ++evaluations
    );

    const actualBallastMoment = vectorMoment(
      units,
      unitWeights,
      input.rho,
      false
    );
    const correctedMoment =
      actualBallastMoment +
      (candidate.achieved.trim - desiredTrim) *
        100 *
        candidate.condition.floating.mtc;
    const correctionMode: DistributionMode =
      candidate.achieved.gm < targets.gmMin
        ? "lowVcg"
        : candidate.strength.maxBm.kind === "sagging"
          ? "ends"
          : initialMode;
    const correctedWeights = allocateForMoment(
      units,
      ballastWeight,
      correctedMoment,
      input.rho,
      correctionMode,
      false,
      targets.preferredUnits,
    );
    if (
      evaluations < MAX_EXACT_EVALUATIONS &&
      correctedWeights.some(
        (weight, index) => Math.abs(weight - unitWeights[index]) > 0.01
      )
    ) {
      unitWeights = correctedWeights;
      candidate = evaluateCandidate(
        input,
        targets,
        units,
        unitWeights,
        ++evaluations
      );
    }

    if (
      !candidate.ok &&
      isTargetMetExceptHeel(candidate.achieved, targets) &&
      evaluations < MAX_EXACT_EVALUATIONS
    ) {
      const corrected = heelCorrectedCandidate(
        input,
        targets,
        units,
        candidate,
        ++evaluations
      );
      if (
        isTargetMetExceptTrim(corrected.achieved, targets) &&
        evaluations < MAX_EXACT_EVALUATIONS - 1
      ) {
        const heelAdjustedMoment =
          actualBallastMoment +
          (corrected.achieved.trim - desiredTrim) *
            100 *
            corrected.condition.floating.mtc;
        const heelAdjustedWeights = allocateForMoment(
          units,
          ballastWeight,
          heelAdjustedMoment,
          input.rho,
          correctionMode,
          false,
          targets.preferredUnits,
        );
        const heelAdjustedCandidate = evaluateCandidate(
          input,
          targets,
          units,
          heelAdjustedWeights,
          ++evaluations
        );
        const heelReadjusted = heelCorrectedCandidate(
          input,
          targets,
          units,
          heelAdjustedCandidate,
          ++evaluations
        );
        if (
          heelReadjusted.ok &&
          (!corrected.ok ||
            Math.abs(heelReadjusted.achieved.trim - desiredTrim) <
              Math.abs(corrected.achieved.trim - desiredTrim))
        ) return heelReadjusted;
        if (corrected.ok) return corrected;
        if (heelReadjusted.score < candidate.score) {
          candidate = heelReadjusted;
        }
      }
      if (corrected.ok) return corrected;
      if (corrected.score < candidate.score) candidate = corrected;
    }
    return candidate;
  };

  const ballastWeightOf = (candidate: EvaluatedCandidate): number =>
    candidate.unitWeights.reduce((sum, weight) => sum + weight, 0);
  const trimBandOf = (candidate: EvaluatedCandidate): number =>
    Math.floor(
      (Math.abs(candidate.achieved.trim - desiredTrim) + EPSILON) /
        TRIM_SCORE_STEP,
    );
  const betterFeasible = (
    candidate: EvaluatedCandidate,
    current: EvaluatedCandidate | undefined,
  ): boolean => {
    if (!current) return true;
    const bandDelta = trimBandOf(candidate) - trimBandOf(current);
    if (bandDelta !== 0) return bandDelta < 0;
    const weightDelta = ballastWeightOf(candidate) - ballastWeightOf(current);
    if (Math.abs(weightDelta) > EPSILON) return weightDelta < 0;
    return Math.abs(candidate.achieved.trim - desiredTrim) <
      Math.abs(current.achieved.trim - desiredTrim);
  };

  const amounts = searchAmounts(0, maximumBallast);
  let refinedFirstFeasible = false;
  for (let index = 0; index < amounts.length; index++) {
    const ballastWeight = amounts[index];
    const candidate = evaluateBallastWeight(ballastWeight);
    if (!candidate) continue;
    if (candidate.score < best.score - EPSILON) best = candidate;
    if (candidate.ok) {
      if (betterFeasible(candidate, bestFeasible)) bestFeasible = candidate;
      let refined = candidate;
      if (
        !refinedFirstFeasible &&
        index > 0 &&
        evaluations + REFINEMENT_STEPS * MAX_EVALUATIONS_PER_AMOUNT <=
          MAX_EXACT_EVALUATIONS
      ) {
        refinedFirstFeasible = true;
        let low = amounts[index - 1];
        let high = ballastWeight;
        for (let step = 0; step < REFINEMENT_STEPS; step++) {
          const midpoint = (low + high) / 2;
          const midpointCandidate = evaluateBallastWeight(midpoint);
          if (!midpointCandidate) break;
          if (midpointCandidate.ok) {
            high = midpoint;
            refined = midpointCandidate;
          } else {
            low = midpoint;
          }
        }
      }
      if (betterFeasible(refined, bestFeasible)) bestFeasible = refined;
      if (input.targets?.trimTarget == null) {
        refined.iterations = evaluations;
        return refined;
      }
    }
  }

  if (bestFeasible) {
    bestFeasible.iterations = evaluations;
    return bestFeasible;
  }

  if (
    Math.abs(best.achieved.heel) > targets.maxHeel &&
    evaluations < MAX_EXACT_EVALUATIONS
  ) {
    const corrected = heelCorrectedCandidate(
      input,
      targets,
      units,
      best,
      ++evaluations
    );
    if (corrected.ok || corrected.score < best.score) best = corrected;
  }
  best.iterations = evaluations;
  best.notes = notesForResult(best, targets, units.length > 0);
  return best;
}

export function fastAutoBallast(
  weight: number,
  lcg: number,
  vcgKg: number,
  rho: number,
  targetOverrides?: Partial<BallastTargets>
): {
  ballast: { compId: string; weight: number; lcg: number; vcg: number }[];
  trim: number;
  draftAft: number;
  draftFwd: number;
  gmCorrected: number;
} {
  const targets = targetsWithDefaults(targetOverrides);
  const units = availableUnits(rho);
  const maximumBallast = units.reduce((sum, unit) => sum + unit.capacity, 0);
  const desiredTrim = targetTrim(targets);
  const baseMoment = weight * lcg;
  const baseVerticalMoment = weight * vcgKg;
  let bestWeights = units.map(() => 0);
  let bestFloating = fastFloating(weight, lcg, rho);
  let bestGm = bestFloating.kmT - vcgKg;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestFeasible = false;
  let bestTrimBand = Number.POSITIVE_INFINITY;
  let bestBallastWeight = Number.POSITIVE_INFINITY;

  for (const ballastWeight of searchAmounts(0, maximumBallast)) {
    const totalWeight = weight + ballastWeight;
    const desiredBallastMoment =
      targetTotalMoment(totalWeight, rho, desiredTrim) - baseMoment;
    const mode: DistributionMode = bestGm < targets.gmMin ? "lowVcg" : "middle";
    const unitWeights = allocateForMoment(
      units,
      ballastWeight,
      desiredBallastMoment,
      rho,
      mode,
      true,
      targets.preferredUnits,
    );
    const points = unitPoints(units, unitWeights, rho, true);
    const ballastMoment = points.reduce(
      (sum, point) => sum + point.weight * point.lcg,
      0
    );
    const verticalMoment = points.reduce(
      (sum, point) => sum + point.weight * point.vcg,
      0
    );
    const floating = fastFloating(
      totalWeight,
      (baseMoment + ballastMoment) / totalWeight,
      rho
    );
    const gmCorrected =
      floating.kmT - (baseVerticalMoment + verticalMoment) / totalWeight;
    const trimError =
      floating.trim < targets.trimMin
        ? targets.trimMin - floating.trim
        : Math.max(0, floating.trim - targets.trimMax);
    const gmError = Math.max(0, targets.gmMin - gmCorrected);
    const dmError = Math.max(
      0,
      (targets.dmMin ?? floating.draftMid) - floating.draftMid,
    );
    const draftFwdError = Math.max(
      0,
      (targets.draftFwdMin ?? floating.draftFwd) - floating.draftFwd,
    );
    const propellerError = Math.max(
      0,
      (targets.propellerZTop ?? floating.draftAft) - floating.draftAft,
    );
    const score = trimError ** 2 + gmError ** 2 + dmError ** 2 +
      draftFwdError ** 2 + propellerError ** 2;
    const feasible = score <= EPSILON;
    const trimBand = Math.floor(
      (Math.abs(floating.trim - desiredTrim) + EPSILON) / TRIM_SCORE_STEP,
    );
    const better = feasible
      ? !bestFeasible || trimBand < bestTrimBand ||
        (trimBand === bestTrimBand && ballastWeight < bestBallastWeight - EPSILON)
      : !bestFeasible && score < bestScore - EPSILON;
    if (better) {
      bestScore = score;
      bestFeasible = feasible;
      bestTrimBand = trimBand;
      bestBallastWeight = ballastWeight;
      bestWeights = unitWeights;
      bestFloating = floating;
      bestGm = gmCorrected;
    }
    if (feasible && trimBand === 0) break;
  }

  const ballast = units.flatMap((unit, index) => {
    if (bestWeights[index] <= EPSILON) return [];
    const fraction = bestWeights[index] / unit.capacity;
    return unit.compIds.map(compId => {
      const point = fastTankPoint(compId, fraction, rho);
      return { compId, weight: point.weight, lcg: point.lcg, vcg: point.vcg };
    });
  });
  return {
    ballast,
    trim: bestFloating.trim,
    draftAft: bestFloating.draftAft,
    draftFwd: bestFloating.draftFwd,
    gmCorrected: bestGm,
  };
}
