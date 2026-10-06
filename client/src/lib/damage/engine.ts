import {
  DEMO_SHIP,
  compartmentProps,
  hullProps,
  listCompartments,
  tankCapacity,
  waterlineZ,
  type Waterplane,
} from "../hull";
import type { ConditionResult } from "../loadcalc/types";
import { areaUnder, gzMaxOf, type Criterion, type GzPoint } from "../stability";
import { generateCases } from "./cases";
import type {
  DamageCase,
  DamageCaseResult,
  DamageEquilibrium,
  DamageInput,
  DamageResult,
  IntermediateDamageStage,
} from "./types";

const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-10;

type BuoyancyState = ReturnType<typeof damagedBuoyancy> & {
  awp: number;
  mtc: number;
  draftAft: number;
  draftFwd: number;
};

type WeightState = {
  weight: number;
  lcg: number;
  tcg: number;
  kg: number;
  fsmTotal: number;
};

const buoyancyCache = new Map<string, BuoyancyState>();
const definitions = new Map(listCompartments().map(definition => [definition.id, definition]));

function permeability(compId: string): number {
  const definition = definitions.get(compId);
  if (!definition) throw new Error(`Unknown compartment: ${compId}`);
  return compId === "ER" ? 0.85 : 0.95;
}

function cacheNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(7) : String(value);
}

function buoyancyState(
  wp: Waterplane,
  comps: string[],
  perm: (id: string) => number,
): BuoyancyState {
  const ids = Array.from(new Set(comps)).sort();
  const permeabilityKey = ids.map(id => `${id}:${cacheNumber(perm(id))}`).join(",");
  const key = `${permeabilityKey}|${cacheNumber(wp.draftMid)}:${cacheNumber(wp.trim)}:${cacheNumber(wp.heel)}`;
  const cached = buoyancyCache.get(key);
  if (cached) return cached;

  const hull = hullProps(wp);
  let volume = hull.volume;
  let longitudinalMoment = hull.volume * hull.lcb;
  let transverseMoment = hull.volume * hull.tcb;
  let verticalMoment = hull.volume * hull.vcb;
  for (const id of ids) {
    const mu = perm(id);
    const lost = compartmentProps(id, wp);
    const lostVolume = mu * lost.volume;
    volume -= lostVolume;
    longitudinalMoment -= lostVolume * lost.lcb;
    transverseMoment -= lostVolume * lost.tcb;
    verticalMoment -= lostVolume * lost.vcb;
  }

  const state: BuoyancyState = {
    volume,
    lcb: volume > EPSILON ? longitudinalMoment / volume : 0,
    tcb: volume > EPSILON ? transverseMoment / volume : 0,
    vcb: volume > EPSILON ? verticalMoment / volume : 0,
    awp: hull.awp,
    mtc: hull.mtc,
    draftAft: hull.draftAft,
    draftFwd: hull.draftFwd,
  };
  if (buoyancyCache.size > 50_000) buoyancyCache.clear();
  buoyancyCache.set(key, state);
  return state;
}

export function damagedBuoyancy(
  wp: Waterplane,
  comps: string[],
  perm: (id: string) => number,
): { volume: number; lcb: number; tcb: number; vcb: number } {
  const { volume, lcb, tcb, vcb } = buoyancyState(wp, comps, perm);
  return { volume, lcb, tcb, vcb };
}

function weightsAfterLoss(inp: DamageInput, comps: string[]): WeightState {
  const damaged = new Set(comps);
  const affected = inp.tanks.filter(tank => damaged.has(tank.compId));
  // A full seawater ballast tank is continuously replaced by external seawater
  // after rupture. Keeping that equal-density mass is required by the plan's
  // FPT regression; other carried liquids are removed from the weight moments.
  const lost = affected.filter(tank => !(tank.kind === "ballast"
    && tank.density !== undefined
    && Math.abs(tank.density - inp.rho) < 1e-9
    && (tank.fillPct ?? 0) >= 99.9));
  const weight = inp.weight - lost.reduce((sum, tank) => sum + tank.weight, 0);
  if (weight <= EPSILON) throw new Error("Damage removes all displacement weight");
  const longitudinalMoment = inp.weight * inp.lcg
    - lost.reduce((sum, tank) => sum + tank.weight * tank.lcg, 0);
  const transverseMoment = inp.weight * inp.tcg
    - lost.reduce((sum, tank) => sum + tank.weight * tank.tcg, 0);
  const verticalMoment = inp.weight * inp.vcg
    - lost.reduce((sum, tank) => sum + tank.weight * tank.vcg, 0);
  const knownLostFsm = affected.reduce((sum, tank) => sum + (tank.fsm ?? 0), 0);
  return {
    weight,
    lcg: longitudinalMoment / weight,
    tcg: transverseMoment / weight,
    kg: verticalMoment / weight,
    fsmTotal: Math.max(0, inp.fsmTotal - knownLostFsm),
  };
}

function findDamagedDraft(
  targetVolume: number,
  trim: number,
  heel: number,
  comps: string[],
  initialDraft?: number,
): { draftMid: number; props: BuoyancyState; afloat: boolean } {
  const maxDraft = DEMO_SHIP.hull.depth + 10;
  let draftMid = initialDraft
    ?? Math.max(0.1, Math.min(maxDraft, targetVolume / (DEMO_SHIP.hull.lbp * DEMO_SHIP.hull.breadth * 0.72)));
  let props = buoyancyState({ draftMid, trim, heel }, comps, permeability);

  for (let iteration = 0; iteration < 10; iteration++) {
    const error = targetVolume - props.volume;
    if (Math.abs(error) / Math.max(targetVolume, 1) < 1e-7) {
      return { draftMid, props, afloat: true };
    }
    if (!Number.isFinite(props.awp) || props.awp <= EPSILON) break;
    const correction = Math.max(-3, Math.min(3, error / props.awp));
    draftMid = Math.max(0, Math.min(maxDraft, draftMid + correction));
    props = buoyancyState({ draftMid, trim, heel }, comps, permeability);
  }

  let low = 0;
  let high = maxDraft;
  const highProps = buoyancyState({ draftMid: high, trim, heel }, comps, permeability);
  if (highProps.volume < targetVolume) return { draftMid: high, props: highProps, afloat: false };
  for (let iteration = 0; iteration < 32; iteration++) {
    const mid = (low + high) / 2;
    const current = buoyancyState({ draftMid: mid, trim, heel }, comps, permeability);
    if (current.volume < targetVolume) low = mid;
    else high = mid;
  }
  draftMid = (low + high) / 2;
  props = buoyancyState({ draftMid, trim, heel }, comps, permeability);
  return { draftMid, props, afloat: true };
}

function gzAt(
  angle: number,
  trim: number,
  targetVolume: number,
  comps: string[],
  weight: WeightState,
  initialDraft?: number,
): { gz: number; kn: number; draftMid: number; props: BuoyancyState; afloat: boolean } {
  const draft = findDamagedDraft(targetVolume, trim, angle, comps, initialDraft);
  const radians = angle * DEG_TO_RAD;
  const kn = draft.props.tcb * Math.cos(radians) + draft.props.vcb * Math.sin(radians);
  const correctedKg = weight.kg + weight.fsmTotal / weight.weight;
  const gz = kn - correctedKg * Math.sin(radians) - weight.tcg * Math.cos(radians);
  return { gz, kn, draftMid: draft.draftMid, props: draft.props, afloat: draft.afloat };
}

function solveForWeight(weight: WeightState, comps: string[], rho: number): DamageEquilibrium {
  const targetVolume = weight.weight / rho;
  let trim = 0;
  let draft = findDamagedDraft(targetVolume, trim, 0, comps);

  for (let iteration = 0; iteration < 30 && draft.afloat; iteration++) {
    const mtc = draft.props.mtc * rho / 1.025;
    if (!Number.isFinite(mtc) || mtc <= EPSILON) break;
    const dTrim = Math.max(-3, Math.min(3, ((draft.props.lcb - weight.lcg) * weight.weight) / (100 * mtc)));
    trim += dTrim;
    draft = findDamagedDraft(targetVolume, trim, 0, comps, draft.draftMid);
    if (Math.abs(dTrim) < 0.001) break;
  }

  if (!draft.afloat) {
    return {
      draftMid: draft.draftMid,
      draftAft: draft.props.draftAft,
      draftFwd: draft.props.draftFwd,
      trim,
      heel: 60,
      capsized: true,
      weight: weight.weight,
      kg: weight.kg,
      tcg: weight.tcg,
    };
  }

  const upright = gzAt(0, trim, targetVolume, comps, weight, draft.draftMid);
  if (Math.abs(upright.gz) < 1e-6) {
    return {
      draftMid: upright.draftMid,
      draftAft: upright.props.draftAft,
      draftFwd: upright.props.draftFwd,
      trim,
      heel: 0,
      capsized: false,
      weight: weight.weight,
      kg: weight.kg,
      tcg: weight.tcg,
    };
  }

  const direction = upright.gz < 0 ? 1 : -1;
  let previousAngle = 0;
  let previous = upright;
  let bracket: { low: number; high: number; lowGz: number; highGz: number } | null = null;
  for (let magnitude = 2; magnitude <= 60; magnitude += 2) {
    const angle = direction * magnitude;
    const current = gzAt(angle, trim, targetVolume, comps, weight, previous.draftMid);
    if (!current.afloat) break;
    if (previous.gz * current.gz <= 0) {
      bracket = angle > previousAngle
        ? { low: previousAngle, high: angle, lowGz: previous.gz, highGz: current.gz }
        : { low: angle, high: previousAngle, lowGz: current.gz, highGz: previous.gz };
      break;
    }
    previousAngle = angle;
    previous = current;
  }

  if (!bracket) {
    return {
      draftMid: previous.draftMid,
      draftAft: previous.props.draftAft,
      draftFwd: previous.props.draftFwd,
      trim,
      heel: 60,
      capsized: true,
      weight: weight.weight,
      kg: weight.kg,
      tcg: weight.tcg,
    };
  }

  let root = previous;
  for (let iteration = 0; iteration < 18; iteration++) {
    const angle = (bracket.low + bracket.high) / 2;
    root = gzAt(angle, trim, targetVolume, comps, weight, root.draftMid);
    if (Math.abs(root.gz) < 1e-7) {
      bracket.low = angle;
      bracket.high = angle;
      break;
    }
    if (bracket.lowGz * root.gz <= 0) {
      bracket.high = angle;
      bracket.highGz = root.gz;
    } else {
      bracket.low = angle;
      bracket.lowGz = root.gz;
    }
  }
  const heel = (bracket.low + bracket.high) / 2;
  root = gzAt(heel, trim, targetVolume, comps, weight, root.draftMid);
  return {
    draftMid: root.draftMid,
    draftAft: root.props.draftAft,
    draftFwd: root.props.draftFwd,
    trim,
    heel,
    capsized: !root.afloat,
    weight: weight.weight,
    kg: weight.kg,
    tcg: weight.tcg,
  };
}

export function solveDamagedEquilibrium(inp: DamageInput, comps: string[]): DamageEquilibrium {
  const weight = weightsAfterLoss(inp, comps);
  return solveForWeight(weight, comps, inp.rho);
}

function equilibriumWeight(inp: DamageInput, comps: string[], eq: DamageEquilibrium): WeightState {
  const weight = weightsAfterLoss(inp, comps);
  return { ...weight, weight: eq.weight, kg: eq.kg, tcg: eq.tcg };
}

export function residualGz(
  inp: DamageInput,
  comps: string[],
  eq: DamageEquilibrium,
): GzPoint[] {
  if (eq.capsized) return [];
  const weight = equilibriumWeight(inp, comps, eq);
  const targetVolume = eq.weight / inp.rho;
  const curve: GzPoint[] = [];
  let draftMid = eq.draftMid;
  for (let offset = 0; offset <= 60; offset += 2) {
    const heel = eq.heel + offset;
    const state = gzAt(heel, eq.trim, targetVolume, comps, weight, draftMid);
    if (!state.afloat) break;
    draftMid = state.draftMid;
    curve.push({ heel, kn: state.kn, gz: state.gz });
  }
  return curve;
}

function ordinateAt(curve: GzPoint[], angle: number): number {
  if (curve.length === 0) return Number.NaN;
  if (angle <= curve[0].heel) return curve[0].gz;
  if (angle >= curve[curve.length - 1].heel) return curve[curve.length - 1].gz;
  const upperIndex = curve.findIndex(point => point.heel >= angle);
  const upper = curve[upperIndex];
  if (upper.heel === angle) return upper.gz;
  const lower = curve[upperIndex - 1];
  const fraction = (angle - lower.heel) / (upper.heel - lower.heel);
  return lower.gz + fraction * (upper.gz - lower.gz);
}

function positiveRangeEnd(curve: GzPoint[], equilibriumHeel: number): number {
  if (curve.length < 2) return equilibriumHeel;
  let sawPositive = false;
  for (let index = 1; index < curve.length; index++) {
    const point = curve[index];
    if (point.gz > 0) {
      sawPositive = true;
      continue;
    }
    if (!sawPositive) return equilibriumHeel;
    const previous = curve[index - 1];
    const fraction = previous.gz / (previous.gz - point.gz);
    return previous.heel + fraction * (point.heel - previous.heel);
  }
  return curve[curve.length - 1].heel;
}

function downfloodingAngle(eq: DamageEquilibrium): number | null {
  const candidates = DEMO_SHIP.openings
    .filter(opening => opening.y > 0)
    .map(opening => {
      const upright = waterlineZ({ draftMid: eq.draftMid, trim: eq.trim, heel: 0 }, opening.x, 0);
      return Math.atan((opening.z - upright) / opening.y) / DEG_TO_RAD;
    })
    .filter(angle => Number.isFinite(angle));
  return candidates.length === 0 ? null : Math.max(0, Math.min(...candidates));
}

function criterion(
  id: string,
  name: string,
  required: string,
  value: number,
  limit: number,
  pass: boolean,
  unit: string,
): Criterion {
  return { id, name, required, actual: `${value.toFixed(3)}${unit}`, value, limit, pass };
}

function intermediateStages(inp: DamageInput, comps: string[]): IntermediateDamageStage[] {
  return [25, 50, 75].map(pct => {
    const floodItems = comps.map(compId => {
      const capacity = tankCapacity(compId);
      const weight = capacity.capacity100 * permeability(compId) * inp.rho * pct / 100;
      return { weight, lcg: capacity.lcg, tcg: capacity.tcg, vcg: capacity.vcg };
    });
    const addedWeight = floodItems.reduce((sum, item) => sum + item.weight, 0);
    const totalWeight = inp.weight + addedWeight;
    const stageWeight: WeightState = {
      weight: totalWeight,
      lcg: (inp.weight * inp.lcg + floodItems.reduce((sum, item) => sum + item.weight * item.lcg, 0)) / totalWeight,
      tcg: (inp.weight * inp.tcg + floodItems.reduce((sum, item) => sum + item.weight * item.tcg, 0)) / totalWeight,
      kg: (inp.weight * inp.vcg + floodItems.reduce((sum, item) => sum + item.weight * item.vcg, 0)) / totalWeight,
      fsmTotal: inp.fsmTotal,
    };
    const equilibrium = solveForWeight(stageWeight, [], inp.rho);
    const stageInput: DamageInput = {
      ...inp,
      weight: totalWeight,
      lcg: stageWeight.lcg,
      tcg: stageWeight.tcg,
      vcg: stageWeight.kg,
      tanks: [],
    };
    const curve = residualGz(stageInput, [], equilibrium);
    const end = positiveRangeEnd(curve, equilibrium.heel);
    const positive = curve
      .filter(point => point.heel > equilibrium.heel && point.heel <= end)
      .every(point => point.gz >= -1e-6);
    return {
      pct,
      heel: equilibrium.heel,
      ok: !equilibrium.capsized && Math.abs(equilibrium.heel) <= 30 && positive,
      approximate: true as const,
    };
  });
}

export function evaluateCase(
  inp: DamageInput,
  damageCase: DamageCase,
  opts: { intermediate?: boolean } = {},
): DamageCaseResult {
  const equilibrium = solveDamagedEquilibrium(inp, damageCase.compartments);
  const gzCurve = residualGz(inp, damageCase.compartments, equilibrium);
  const floodAngle = equilibrium.capsized ? null : downfloodingAngle(equilibrium);
  const zeroAngle = positiveRangeEnd(gzCurve, equilibrium.heel);
  const upperAngle = Math.min(zeroAngle, floodAngle ?? Number.POSITIVE_INFINITY, 50);
  const range = equilibrium.capsized ? 0 : Math.max(0, upperAngle - equilibrium.heel);
  const rangeEnd = equilibrium.heel + range;
  const rangeCurve = gzCurve.filter(point => point.heel >= equilibrium.heel && point.heel <= rangeEnd);
  if (rangeCurve.length > 0 && rangeCurve[rangeCurve.length - 1].heel < rangeEnd) {
    rangeCurve.push({ heel: rangeEnd, kn: Number.NaN, gz: ordinateAt(gzCurve, rangeEnd) });
  }
  const gzMax = rangeCurve.length > 0 ? gzMaxOf(rangeCurve).gzMax : 0;
  const area = range > 0 ? areaUnder(gzCurve, equilibrium.heel, rangeEnd) : 0;
  const gm = gzCurve.length >= 2
    ? (gzCurve[1].gz - gzCurve[0].gz) / ((gzCurve[1].heel - gzCurve[0].heel) * DEG_TO_RAD)
    : Number.NEGATIVE_INFINITY;
  const deckEdgeDry = !equilibrium.capsized && waterlineZ(
    { draftMid: equilibrium.draftMid, trim: equilibrium.trim, heel: equilibrium.heel },
    DEMO_SHIP.hull.lbp / 2,
    DEMO_SHIP.hull.breadth / 2,
  ) < DEMO_SHIP.hull.depth;
  const heelLimit = deckEdgeDry ? 30 : 25;
  const openingClearance = equilibrium.capsized
    ? Number.NEGATIVE_INFINITY
    : Math.min(...DEMO_SHIP.openings
      .filter(opening => opening.y >= 0)
      .map(opening => opening.z - waterlineZ(equilibrium, opening.x, opening.y)));
  const criteria: Criterion[] = [
    criterion("damage-heel", "平衡横倾", `≤ ${heelLimit}°`, Math.abs(equilibrium.heel), heelLimit, !equilibrium.capsized && Math.abs(equilibrium.heel) <= heelLimit, "°"),
    criterion("damage-opening", "开口余隙", "> 0 m", openingClearance, 0, openingClearance > 0, " m"),
    criterion("damage-range", "残余稳性范围", "≥ 20°", range, 20, range >= 20, "°"),
    criterion("damage-gz", "范围内最大 GZ", "≥ 0.10 m", gzMax, 0.1, gzMax >= 0.1, " m"),
    criterion("damage-area", "范围内 GZ 面积", "≥ 0.0175 m·rad", area, 0.0175, area >= 0.0175, " m·rad"),
    criterion("damage-gm", "受损后 GM", "≥ 0.05 m", gm, 0.05, gm >= 0.05, " m"),
  ];
  return {
    case: damageCase,
    equilibrium,
    gzCurve,
    range,
    gzMax,
    area,
    gm,
    floodAngle,
    criteria,
    pass: criteria.every(item => item.pass),
    intermediate: opts.intermediate ? intermediateStages(inp, damageCase.compartments) : [],
  };
}

export function computeDamage(
  inp: DamageInput,
  cases: DamageCase[] = generateCases(),
  onProgress?: (i: number, n: number) => void,
): DamageResult {
  const results = cases.map((damageCase, index) => {
    const result = evaluateCase(inp, damageCase);
    onProgress?.(index + 1, cases.length);
    return result;
  });
  const failures = results.filter(result => !result.pass);
  const candidates = failures.length > 0 ? failures : results;
  const worst = candidates.reduce<DamageCaseResult | undefined>((current, result) => (
    !current || result.range < current.range ? result : current
  ), undefined);
  return { cases: results, worst: worst?.case.id ?? "", pass: failures.length === 0 };
}

export function damageInputFromCondition(result: ConditionResult): DamageInput {
  return {
    weight: result.groups.total.weight,
    lcg: result.groups.total.lcg,
    tcg: result.groups.total.tcg,
    vcg: result.groups.total.vcg,
    fsmTotal: result.fsmTotal,
    rho: result.floating.waterDensity,
    tanks: result.tanks.map(tank => ({
      compId: tank.compId,
      kind: tank.kind,
      density: tank.density,
      fillPct: tank.fillPct,
      weight: tank.weight,
      lcg: tank.lcg,
      tcg: tank.tcg,
      vcg: tank.vcg,
      fsm: tank.fsm,
    })),
  };
}
