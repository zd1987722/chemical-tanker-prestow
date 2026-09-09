import { findDraftForVolume, hullProps } from "../hull";
import type { ConditionResult } from "../loadcalc/types";
import { generalCriteria } from "./criteria";
import { areaUnder, downfloodingAngle, gzCurve, gzMaxOf } from "./engine";
import type { StabilityInput, StabilityOptions, StabilityResult } from "./types";
import { weatherCriterion } from "./weather";

const allowableCache = new Map<string, number>();

export function computeStability(
  inp: StabilityInput,
  opts: StabilityOptions = {},
): StabilityResult {
  const kgCorrected = inp.vcg + inp.fsmTotal / inp.weight;
  const upright = hullProps({ draftMid: inp.draftMid, trim: inp.trim, heel: 0 }, inp.rho);
  const gm0 = upright.kmT - inp.vcg;
  const gmCorrected = upright.kmT - kgCorrected;
  const curve = gzCurve(inp);
  const maximum = gzMaxOf(curve);
  const floodAngle = downfloodingAngle(inp.draftMid, inp.trim);
  const areaUpper = Math.min(40, floodAngle ?? 40);
  const criteria = generalCriteria(curve, gmCorrected, floodAngle);
  const weather = weatherCriterion(inp, curve, gmCorrected, floodAngle);
  const permittedKg = opts.allowableKg ? allowableKg(inp) : null;

  return {
    kg: inp.vcg,
    kgCorrected,
    gm0,
    gmCorrected,
    kmT: upright.kmT,
    curve,
    gzMax: maximum.gzMax,
    gzMaxAngle: maximum.angle,
    downfloodingAngle: floodAngle,
    area0to30: areaUnder(curve, 0, 30),
    area0to40: areaUnder(curve, 0, areaUpper),
    area30to40: areaUnder(curve, 30, areaUpper),
    criteria,
    weather,
    allowableKg: permittedKg,
    kgMargin: permittedKg === null ? null : permittedKg - kgCorrected,
    pass: criteria.every(item => item.pass) && weather.pass,
  };
}

export function allowableKg(inp: StabilityInput): number {
  const key = `${Math.round(inp.weight / 100) * 100}:${Math.round(inp.trim * 10) / 10}`;
  const cached = allowableCache.get(key);
  if (cached !== undefined) return cached;

  const correction = inp.fsmTotal / inp.weight;
  let lower = 0;
  let upper = 20;
  for (let iteration = 0; iteration < 12; iteration++) {
    const candidate = (lower + upper) / 2;
    const result = computeStability({ ...inp, vcg: candidate - correction });
    if (result.pass) lower = candidate;
    else upper = candidate;
  }
  allowableCache.set(key, lower);
  return lower;
}

export function gmLimitCurve(
  displacements: number[],
  trim = 0,
): { disp: number; allowableKg: number; gmLimit: number; kmT: number }[] {
  return displacements.map(disp => {
    const rho = 1.025;
    const draftMid = findDraftForVolume(disp / rho, trim, 0);
    const kmT = hullProps({ draftMid, trim, heel: 0 }, rho).kmT;
    const input: StabilityInput = {
      weight: disp,
      lcg: 0,
      tcg: 0,
      vcg: 0,
      fsmTotal: 0,
      rho,
      trim,
      draftMid,
    };
    const permittedKg = allowableKg(input);
    return { disp, allowableKg: permittedKg, gmLimit: kmT - permittedKg, kmT };
  });
}

export function stabilityFromCondition(
  result: ConditionResult,
  opts: StabilityOptions = {},
): StabilityResult {
  const total = result.groups.total;
  return computeStability({
    weight: total.weight,
    lcg: total.lcg,
    tcg: total.tcg,
    vcg: total.vcg,
    fsmTotal: result.fsmTotal,
    rho: result.floating.waterDensity,
    trim: result.floating.trim,
    draftMid: result.floating.draftMid,
  }, opts);
}

export * from "./criteria";
export * from "./engine";
export * from "./tables";
export * from "./types";
export * from "./weather";
