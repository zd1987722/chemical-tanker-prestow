import { DEMO_SHIP, windProfile } from "../hull";
import { areaUnder, gzMaxOf } from "./engine";
import { interp, S_TABLE, X1_TABLE, X2_TABLE } from "./tables";
import type { GzPoint, StabilityInput, WeatherResult } from "./types";

const G = 9.80665;
const WIND_PRESSURE = 504;

function crossing(curve: GzPoint[], level: number, after = 0, descending = false): number | null {
  for (let index = 0; index < curve.length - 1; index++) {
    const left = curve[index];
    const right = curve[index + 1];
    if (right.heel < after) continue;
    const y0 = left.gz - level;
    const y1 = right.gz - level;
    const crosses = descending ? y0 >= 0 && y1 <= 0 : y0 <= 0 && y1 >= 0;
    if (!crosses) continue;
    if (y0 === y1) return Math.max(after, left.heel);
    return left.heel + (-y0 / (y1 - y0)) * (right.heel - left.heel);
  }
  return null;
}

function leverDifferenceCurve(curve: GzPoint[], lever: number): GzPoint[] {
  const negative = curve.slice(1).reverse().map(point => ({
    heel: -point.heel,
    kn: -point.kn,
    gz: -point.gz - lever,
  }));
  const positive = curve.map(point => ({ ...point, gz: point.gz - lever }));
  return [...negative, ...positive];
}

export function weatherCriterion(
  inp: StabilityInput,
  curve: GzPoint[],
  gmCorrected: number,
  floodAngle: number | null,
): WeatherResult {
  const { breadth, depth, lbp } = DEMO_SHIP.hull;
  const profile = windProfile(inp.draftMid);
  const z = profile.zc - inp.draftMid / 2;
  const lw1 = WIND_PRESSURE * profile.area * z / (1000 * G * inp.weight);
  const lw2 = 1.5 * lw1;
  const breadthDraftRatio = breadth / inp.draftMid;
  const x1 = interp(X1_TABLE, breadthDraftRatio);
  const uprightVolume = inp.weight / inp.rho;
  const cb = uprightVolume / (lbp * breadth * inp.draftMid);
  const x2 = interp(X2_TABLE, cb);
  const kgCorrected = inp.vcg + inp.fsmTotal / inp.weight;
  const r = 0.73 + 0.6 * (kgCorrected - inp.draftMid) / inp.draftMid;
  const c = 0.373 + 0.023 * breadthDraftRatio - 0.043 * (lbp / 100);
  const rollPeriod = gmCorrected > 0
    ? 2 * c * breadth / Math.sqrt(gmCorrected)
    : Number.POSITIVE_INFINITY;
  const s = interp(S_TABLE, rollPeriod);
  const k = 1;
  const theta1 = 109 * k * x1 * x2 * Math.sqrt(Math.max(0, r * s));
  const theta0 = crossing(curve, lw1) ?? 90;
  const maximum = gzMaxOf(curve);
  const thetaC = crossing(curve, lw2, maximum.angle, true)
    ?? curve[curve.length - 1].heel;
  const theta2 = Math.min(50, floodAngle ?? Number.POSITIVE_INFINITY, thetaC);

  const difference = leverDifferenceCurve(curve, lw2);
  const negativePart = difference.map(point => ({ ...point, gz: Math.min(0, point.gz) }));
  const positivePart = difference.map(point => ({ ...point, gz: Math.max(0, point.gz) }));
  const areaA = -areaUnder(negativePart, theta0 - theta1, theta0);
  const areaB = areaUnder(positivePart, theta0, theta2);
  const deckImmersionAngle = Math.atan((depth - inp.draftMid) / (breadth / 2)) * 180 / Math.PI;
  const equilibriumPass = theta0 <= 16 && theta0 <= 0.8 * deckImmersionAngle;

  return {
    lw1,
    lw2,
    theta0,
    theta1,
    theta2,
    thetaC,
    areaA,
    areaB,
    pass: areaB >= areaA && equilibriumPass,
    rollPeriod,
    k,
    x1,
    x2,
    r,
    s,
  };
}
