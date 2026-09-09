import { clipBelow, lineCrossings, polyProps } from "./geometry";
import { buildHull, DEFAULT_HULL_PARAMS } from "./hull-form";
import type { Hull, HullProps, Waterplane } from "./types";

export function waterlineZ(
  wp: Waterplane,
  x: number,
  y: number,
  lbp = DEFAULT_HULL_PARAMS.lbp,
): number {
  return wp.draftMid
    + (wp.trim * (lbp / 2 - x)) / lbp
    + y * Math.tan((wp.heel * Math.PI) / 180);
}

export function hullProps(
  wp: Waterplane,
  rho = 1.025,
  hull: Hull = buildHull(),
): HullProps {
  const { lbp, dx, breadth } = hull.params;
  const tanH = Math.tan((wp.heel * Math.PI) / 180);
  const n = hull.sections.length;
  const A = new Array<number>(n).fill(0);
  const Ay = new Array<number>(n).fill(0);
  const Az = new Array<number>(n).fill(0);
  const bw = new Array<number>(n).fill(0);
  const yS = new Array<number>(n).fill(0);
  const yP = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const section = hull.sections[i];
    const a = wp.draftMid + (wp.trim * (lbp / 2 - section.x)) / lbp;
    const wet = clipBelow(section.poly, a, tanH);
    const props = polyProps(wet);
    A[i] = props.area;
    Ay[i] = props.area * props.yc;
    Az[i] = props.area * props.zc;
    const crossings = lineCrossings(section.poly, a, tanH);
    if (crossings.length >= 2) {
      yP[i] = crossings[0];
      yS[i] = crossings[crossings.length - 1];
      bw[i] = yS[i] - yP[i];
    }
  }

  const trap = (values: number[]) => {
    let sum = 0;
    for (let i = 0; i < n - 1; i++) sum += ((values[i] + values[i + 1]) / 2) * dx;
    return sum;
  };
  const xs = hull.sections.map(section => section.x);
  const volume = trap(A);
  const lcb = trap(A.map((area, i) => area * xs[i])) / volume;
  const tcb = trap(Ay) / volume;
  const vcb = trap(Az) / volume;
  const awp = trap(bw);
  const lcf = trap(bw.map((width, i) => width * xs[i])) / awp;
  const iT = trap(bw.map((_, i) => (yS[i] ** 3 - yP[i] ** 3) / 3));
  const iL = trap(bw.map((width, i) => width * (xs[i] - lcf) ** 2));
  const disp = volume * rho;
  const bmT = iT / volume;
  const bmL = iL / volume;
  const draftAft = waterlineZ(wp, 0, 0, lbp);
  const draftFwd = waterlineZ(wp, lbp, 0, lbp);
  const meanDraft = (draftAft + draftFwd) / 2;

  return {
    volume,
    disp,
    lcb,
    tcb,
    vcb,
    awp,
    lcf,
    iT,
    iL,
    tpc: (awp * rho) / 100,
    mtc: (disp * bmL) / (100 * lbp),
    kb: vcb,
    bmT,
    kmT: vcb + bmT,
    bmL,
    kmL: vcb + bmL,
    draftAft,
    draftFwd,
    cb: volume / (lbp * breadth * meanDraft),
    cwp: awp / (lbp * breadth),
  };
}

export function bonjean(x: number, z: number, hull: Hull = buildHull()): number {
  const { sections } = hull;
  if (x < sections[0].x || x > sections[sections.length - 1].x) return 0;
  const position = (x - sections[0].x) / hull.params.dx;
  const lowerIndex = Math.min(Math.floor(position), sections.length - 1);
  const lower = sections[lowerIndex];
  const lowerArea = polyProps(clipBelow(lower.poly, z, 0)).area;
  if (lowerIndex === sections.length - 1) return lowerArea;
  const upper = sections[lowerIndex + 1];
  const upperArea = polyProps(clipBelow(upper.poly, z, 0)).area;
  const fraction = (x - lower.x) / (upper.x - lower.x);
  return lowerArea + fraction * (upperArea - lowerArea);
}

export function findDraftForVolume(
  volume: number,
  trim: number,
  heel: number,
  hull: Hull = buildHull(),
): number {
  let low = 0;
  let high = hull.params.depth + 5;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const current = hullProps({ draftMid: mid, trim, heel }, 1.025, hull).volume;
    if (current < volume) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
