import type { Hull, HullParams, Section } from "./types";

export const DEFAULT_HULL_PARAMS: HullParams = {
  lbp: 175,
  breadth: 32,
  depth: 19,
  xMin: -6,
  xMax: 181,
  pmbStart: 52,
  pmbEnd: 128,
  aftExp: 2.2,
  fwdExp: 2.6,
  nMid: 6,
  nEnd: 1.6,
  cutUpX: 12,
  cutUpZ: 6,
  bulb: { x0: 176, halfLen: 5, z0: 4, halfH: 3.5, amp: 1.5 },
  dx: 0.5,
  dz: 0.1,
};

export function planW(x: number, p: HullParams = DEFAULT_HULL_PARAMS): number {
  let w: number;
  if (x >= p.pmbStart && x <= p.pmbEnd) w = 1;
  else if (x < p.pmbStart) w = 1 - Math.pow((p.pmbStart - x) / (p.pmbStart - p.xMin), p.aftExp);
  else w = 1 - Math.pow((x - p.pmbEnd) / (p.xMax - p.pmbEnd), p.fwdExp);
  if (x < 0) w *= Math.max(0, 1 - Math.pow(-x / -p.xMin, 2));
  return Math.max(0, w);
}

export function keelZ(x: number, p: HullParams = DEFAULT_HULL_PARAMS): number {
  return x >= p.cutUpX ? 0 : p.cutUpZ * Math.pow((p.cutUpX - x) / p.cutUpX, 2);
}

export function halfBreadth(x: number, z: number, p: HullParams = DEFAULT_HULL_PARAMS): number {
  const z0 = keelZ(x, p);
  if (z < z0 || z > p.depth) return 0;
  const w = planW(x, p);
  const n = p.nEnd + (p.nMid - p.nEnd) * w;
  const s = Math.min(1, Math.max(0, (z - z0) / (p.depth - z0)));
  let y = (p.breadth / 2) * w * Math.pow(1 - Math.pow(1 - s, n), 1 / n);
  const b = p.bulb;
  if (x > p.lbp) {
    y += b.amp
      * Math.max(0, 1 - Math.pow((x - b.x0) / b.halfLen, 2))
      * Math.max(0, 1 - Math.pow((z - b.z0) / b.halfH, 2));
  }
  return y;
}

export function buildSections(p: HullParams = DEFAULT_HULL_PARAMS): Section[] {
  const stationCount = Math.round((p.xMax - p.xMin) / p.dx) + 1;
  return Array.from({ length: stationCount }, (_, stationIndex) => {
    const x = p.xMin + stationIndex * p.dx;
    const bottom = keelZ(x, p);
    const stepCount = Math.floor((p.depth - bottom) / p.dz);
    const levels = Array.from({ length: stepCount + 1 }, (_, zIndex) => bottom + zIndex * p.dz);
    if (levels[levels.length - 1] < p.depth - 1e-12) levels.push(p.depth);
    else levels[levels.length - 1] = p.depth;
    const right = levels.map(z => ({ y: halfBreadth(x, z, p), z }));
    const left = right.slice(1).reverse().map(point => ({ y: -point.y, z: point.z }));
    return {
      x,
      poly: [...right, ...left],
      deckHalfBreadth: halfBreadth(x, p.depth, p),
      keelZ: bottom,
    };
  });
}

const hullCache = new Map<string, Hull>();

export function buildHull(overrides: Partial<HullParams> = {}): Hull {
  const params = { ...DEFAULT_HULL_PARAMS, ...overrides };
  const key = JSON.stringify(params);
  let hull = hullCache.get(key);
  if (!hull) {
    hull = { params, sections: buildSections(params) };
    hullCache.set(key, hull);
  }
  return hull;
}
