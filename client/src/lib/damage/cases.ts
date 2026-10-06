import { DEMO_SHIP, type CompartmentDef } from "../hull";
import type { DamageCase, DamageKind } from "./types";

export const SIDE_EXTENT = { length: 10.43, penetration: 6.4 } as const;
export const BOTTOM_EXTENT_FWD = { length: 10.43, halfWidth: 5.33, height: 2.13 } as const;
export const BOTTOM_EXTENT_OTHER = { length: 5, halfWidth: 5, height: 2.13 } as const;

const WALL_MARGIN = 0.3;
const FORWARD_LIMIT = DEMO_SHIP.hull.xMax - 0.3 * DEMO_SHIP.hull.lbp;

export function compartmentHit(
  def: CompartmentDef,
  kind: DamageKind,
  x0: number,
  x1: number,
): boolean {
  const expandedX0 = x0 - WALL_MARGIN;
  const expandedX1 = x1 + WALL_MARGIN;
  const longitudinalHit = (box: CompartmentDef["boxes"][number]) => (
    box.x2 >= expandedX0 && box.x1 <= expandedX1
  );

  if (kind === "side") {
    const innerLimit = DEMO_SHIP.hull.breadth / 2 - SIDE_EXTENT.penetration;
    return def.boxes.some(box => longitudinalHit(box) && box.y2 >= innerLimit);
  }

  const extent = x0 >= FORWARD_LIMIT ? BOTTOM_EXTENT_FWD : BOTTOM_EXTENT_OTHER;
  return def.boxes.some(box => longitudinalHit(box)
    && box.z1 < extent.height
    && box.y2 >= -extent.halfWidth
    && box.y1 <= extent.halfWidth);
}

function windows(kind: DamageKind): { x0: number; x1: number }[] {
  const result: { x0: number; x1: number }[] = [];
  for (let x0 = DEMO_SHIP.hull.xMin; x0 <= DEMO_SHIP.hull.xMax + 1e-9; x0 += 0.5) {
    const length = kind === "side"
      ? SIDE_EXTENT.length
      : x0 >= FORWARD_LIMIT ? BOTTOM_EXTENT_FWD.length : BOTTOM_EXTENT_OTHER.length;
    if (x0 + length > DEMO_SHIP.hull.xMax + 1e-9) continue;
    result.push({ x0, x1: x0 + length });
  }
  return result;
}

export function generateCases(defs: CompartmentDef[] = DEMO_SHIP.compartments): DamageCase[] {
  const cases: DamageCase[] = [];
  const seen = new Set<string>();

  for (const kind of ["side", "bottom"] as const) {
    for (const { x0, x1 } of windows(kind)) {
      const compartments = defs
        .filter(def => compartmentHit(def, kind, x0, x1))
        .map(def => def.id)
        .sort();
      if (compartments.length === 0 || compartments.length > 6) continue;
      const key = compartments.join("+");
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({
        id: `${kind}-${cases.filter(item => item.kind === kind).length + 1}`,
        kind,
        x0,
        x1,
        compartments,
        label: `${kind === "side" ? "舷侧" : "船底"} ${x0.toFixed(1)}–${x1.toFixed(1)} m`,
      });
    }
  }

  return cases.sort((a, b) => a.x0 - b.x0 || a.kind.localeCompare(b.kind));
}
