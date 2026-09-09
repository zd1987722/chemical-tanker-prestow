import { DEMO_SHIP, findDraftForVolume, hullProps, waterlineZ } from "../hull";
import type { GzPoint, StabilityInput } from "./types";

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_HEELS = Array.from({ length: 17 }, (_, index) => index * 5);
const knCache = new Map<string, Pick<GzPoint, "heel" | "kn">[]>();

function knAtHeel(inp: StabilityInput, heel: number): number {
  const volume = inp.weight / inp.rho;
  let draftMid = inp.draftMid;
  let props = hullProps({ draftMid, trim: inp.trim, heel }, inp.rho);
  let converged = false;
  for (let iteration = 0; iteration < 8; iteration++) {
    const error = volume - props.volume;
    if (Math.abs(error) / Math.max(volume, 1) < 1e-8) {
      converged = true;
      break;
    }
    if (!Number.isFinite(props.awp) || props.awp <= 1e-9) break;
    draftMid += Math.max(-3, Math.min(3, error / props.awp));
    props = hullProps({ draftMid, trim: inp.trim, heel }, inp.rho);
  }
  if (!converged) {
    draftMid = findDraftForVolume(volume, inp.trim, heel);
    props = hullProps({ draftMid, trim: inp.trim, heel }, inp.rho);
  }
  const radians = heel * DEG_TO_RAD;
  return props.tcb * Math.cos(radians) + props.vcb * Math.sin(radians);
}

export function gzCurve(inp: StabilityInput, heels: number[] = DEFAULT_HEELS): GzPoint[] {
  const kgCorrected = inp.vcg + inp.fsmTotal / inp.weight;
  const cacheKey = `${inp.weight}:${inp.rho}:${inp.trim}:${inp.draftMid}:${heels.join(",")}`;
  let offsets = knCache.get(cacheKey);
  if (!offsets) {
    offsets = heels.map(heel => ({ heel, kn: knAtHeel(inp, heel) }));
    knCache.set(cacheKey, offsets);
  }
  return offsets.map(({ heel, kn }) => {
    const radians = heel * DEG_TO_RAD;
    return {
      heel,
      kn,
      // 向重心横向偏移一侧倾斜为不利侧(对称船体),按 |tcg| 取不利曲线
      gz: kn - kgCorrected * Math.sin(radians) - Math.abs(inp.tcg) * Math.cos(radians),
    };
  });
}

function ordinateAt(curve: GzPoint[], heel: number): number {
  if (heel <= curve[0].heel) return curve[0].gz;
  if (heel >= curve[curve.length - 1].heel) return curve[curve.length - 1].gz;
  const upper = curve.findIndex(point => point.heel >= heel);
  if (curve[upper].heel === heel) return curve[upper].gz;
  const lower = curve[upper - 1];
  const fraction = (heel - lower.heel) / (curve[upper].heel - lower.heel);
  return lower.gz + fraction * (curve[upper].gz - lower.gz);
}

export function areaUnder(curve: GzPoint[], from: number, to: number): number {
  if (curve.length < 2 || from === to) return 0;
  if (from > to) return -areaUnder(curve, to, from);
  const ordered = [...curve].sort((a, b) => a.heel - b.heel);
  const start = Math.max(from, ordered[0].heel);
  const end = Math.min(to, ordered[ordered.length - 1].heel);
  if (start >= end) return 0;

  const points = [
    { heel: start, gz: ordinateAt(ordered, start) },
    ...ordered.filter(point => point.heel > start && point.heel < end),
    { heel: end, gz: ordinateAt(ordered, end) },
  ];
  let area = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const widthRadians = (points[index + 1].heel - points[index].heel) * DEG_TO_RAD;
    area += (points[index].gz + points[index + 1].gz) / 2 * widthRadians;
  }
  return area;
}

function parabolaValue(points: [GzPoint, GzPoint, GzPoint], x: number): number {
  return points.reduce((sum, point, index) => {
    const others = points.filter((_, otherIndex) => otherIndex !== index);
    return sum + point.gz
      * (x - others[0].heel) * (x - others[1].heel)
      / ((point.heel - others[0].heel) * (point.heel - others[1].heel));
  }, 0);
}

export function gzMaxOf(curve: GzPoint[]): { gzMax: number; angle: number } {
  if (curve.length === 0) return { gzMax: Number.NEGATIVE_INFINITY, angle: 0 };
  let maximumIndex = 0;
  for (let index = 1; index < curve.length; index++) {
    if (curve[index].gz > curve[maximumIndex].gz) maximumIndex = index;
  }
  const discrete = curve[maximumIndex];
  if (maximumIndex === 0 || maximumIndex === curve.length - 1) {
    return { gzMax: discrete.gz, angle: discrete.heel };
  }

  const points: [GzPoint, GzPoint, GzPoint] = [
    curve[maximumIndex - 1],
    discrete,
    curve[maximumIndex + 1],
  ];
  const [p0, p1, p2] = points;
  const d0 = (p0.heel - p1.heel) * (p0.heel - p2.heel);
  const d1 = (p1.heel - p0.heel) * (p1.heel - p2.heel);
  const d2 = (p2.heel - p0.heel) * (p2.heel - p1.heel);
  const a = p0.gz / d0 + p1.gz / d1 + p2.gz / d2;
  const b = -p0.gz * (p1.heel + p2.heel) / d0
    - p1.gz * (p0.heel + p2.heel) / d1
    - p2.gz * (p0.heel + p1.heel) / d2;
  const angle = -b / (2 * a);
  if (a >= 0 || angle < p0.heel || angle > p2.heel) {
    return { gzMax: discrete.gz, angle: discrete.heel };
  }
  return { gzMax: parabolaValue(points, angle), angle };
}

export function downfloodingAngle(draftMid: number, trim: number): number | null {
  const angles = DEMO_SHIP.openings
    .filter(opening => opening.y > 0)
    .map(opening => {
      const uprightWaterline = waterlineZ({ draftMid, trim, heel: 0 }, opening.x, 0);
      return Math.atan((opening.z - uprightWaterline) / opening.y) / DEG_TO_RAD;
    });
  return angles.length === 0 ? null : Math.max(0, Math.min(...angles));
}

export { generalCriteria } from "./criteria";
