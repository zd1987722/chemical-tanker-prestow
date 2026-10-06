import type { Poly, PolyProps, Pt } from "./types";

export function clipBelow(poly: Poly, a: number, b: number): Poly {
  return clipHalfPlane(poly, -b, 1, a);
}

export function clipHalfPlane(poly: Poly, ny: number, nz: number, c: number): Poly {
  if (poly.length < 3) return [];
  const signedDistance = (p: Pt) => ny * p.y + nz * p.z - c;
  const inside = (p: Pt) => signedDistance(p) <= 1e-12;
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const ci = inside(cur), pi = inside(prev);
    if (ci) {
      if (!pi) out.push(intersectHalfPlane(prev, cur, signedDistance));
      out.push(cur);
    } else if (pi) out.push(intersectHalfPlane(prev, cur, signedDistance));
  }
  return out.length >= 3 ? out : [];
}

function intersectHalfPlane(p: Pt, q: Pt, distance: (point: Pt) => number): Pt {
  const fp = distance(p), fq = distance(q);
  const t = fp / (fp - fq);
  return { y: p.y + t * (q.y - p.y), z: p.z + t * (q.z - p.z) };
}

function intersect(p: Pt, q: Pt, a: number, b: number): Pt {
  const fp = p.z - (a + b * p.y), fq = q.z - (a + b * q.y);
  const t = fp / (fp - fq);
  return { y: p.y + t * (q.y - p.y), z: p.z + t * (q.z - p.z) };
}

export function polyProps(poly: Poly): PolyProps {
  if (poly.length < 3) return { area: 0, yc: 0, zc: 0, iyy: 0, iy0: 0 };
  let A = 0, Sy = 0, Sz = 0, Iy0 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.y * q.z - q.y * p.z;
    A += cross;
    Sy += (p.y + q.y) * cross;
    Sz += (p.z + q.z) * cross;
    Iy0 += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
  }
  const sign = A < 0 ? -1 : 1;
  A *= 0.5 * sign; Sy *= sign / 6; Sz *= sign / 6; Iy0 *= sign / 12;
  if (A < 1e-12) return { area: 0, yc: 0, zc: 0, iyy: 0, iy0: 0 };
  const yc = Sy / A, zc = Sz / A;
  return { area: A, yc, zc, iy0: Iy0, iyy: Iy0 - A * yc * yc };
}

export function lineCrossings(poly: Poly, a: number, b: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = p.z - (a + b * p.y), fq = q.z - (a + b * q.y);
    if ((fp <= 0 && fq > 0) || (fp > 0 && fq <= 0)) ys.push(intersect(p, q, a, b).y);
  }
  return ys.sort((u, v) => u - v);
}
