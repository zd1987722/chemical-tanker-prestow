import { clipBelow, clipHalfPlane, lineCrossings, polyProps } from "./geometry";
import { buildHull, halfBreadth, keelZ } from "./hull-form";
import { waterlineZ } from "./integrate";
import { DEMO_SHIP } from "./ship-demo";
import type {
  BoxDef,
  CompartmentDef,
  CompSection,
  Hull,
  Poly,
  TankState,
  Waterplane,
} from "./types";

type Capacity = {
  capacity100: number;
  top: number;
  bottom: number;
  ullageRef: number;
  lcg: number;
  tcg: number;
  vcg: number;
};

type Plane = { a: number; b: number };

const sectionCache = new WeakMap<Hull, Map<string, CompSection[]>>();
const capacityCache = new Map<string, Capacity>();
const levelTableCache = new Map<string, TankState[]>();

function compartment(id: string): CompartmentDef {
  const found = DEMO_SHIP.compartments.find(item => item.id === id);
  if (!found) throw new Error(`Unknown compartment: ${id}`);
  return found;
}

function sectionPolyAt(x: number, hull: Hull): Poly {
  const position = (x - hull.params.xMin) / hull.params.dx;
  const index = Math.round(position);
  if (Math.abs(position - index) < 1e-9 && hull.sections[index]) {
    return hull.sections[index].poly;
  }

  const bottom = keelZ(x, hull.params);
  const stepCount = Math.floor((hull.params.depth - bottom) / hull.params.dz);
  const levels = Array.from(
    { length: stepCount + 1 },
    (_, zIndex) => bottom + zIndex * hull.params.dz,
  );
  if (levels[levels.length - 1] < hull.params.depth - 1e-12) {
    levels.push(hull.params.depth);
  } else {
    levels[levels.length - 1] = hull.params.depth;
  }
  const right = levels.map(z => ({ y: halfBreadth(x, z, hull.params), z }));
  const left = right.slice(1).reverse().map(point => ({ y: -point.y, z: point.z }));
  return [...right, ...left];
}

function clipToBox(poly: Poly, box: BoxDef): Poly {
  let clipped = clipHalfPlane(poly, 1, 0, box.y2);
  clipped = clipHalfPlane(clipped, -1, 0, -box.y1);
  clipped = clipHalfPlane(clipped, 0, 1, box.z2);
  return clipHalfPlane(clipped, 0, -1, -box.z1);
}

export function compartmentSections(id: string, hull: Hull = buildHull()): CompSection[] {
  let hullEntries = sectionCache.get(hull);
  if (!hullEntries) {
    hullEntries = new Map<string, CompSection[]>();
    sectionCache.set(hull, hullEntries);
  }
  const cached = hullEntries.get(id);
  if (cached) return cached;

  const def = compartment(id);
  const xMin = Math.min(...def.boxes.map(box => box.x1));
  const xMax = Math.max(...def.boxes.map(box => box.x2));
  const xs = new Set(
    hull.sections
      .map(section => section.x)
      .filter(x => x >= xMin && x <= xMax),
  );
  for (const box of def.boxes) {
    xs.add(box.x1);
    xs.add(box.x2);
  }

  const sections: CompSection[] = [];
  for (const x of Array.from(xs).sort((a, b) => a - b)) {
    const hullPoly = sectionPolyAt(x, hull);
    for (const box of def.boxes) {
      if (x < box.x1 || x > box.x2) continue;
      const poly = clipToBox(hullPoly, box);
      sections.push({ x, poly });
    }
  }
  hullEntries.set(id, sections);
  return sections;
}

function groupedSections(id: string): { x: number; polys: Poly[] }[] {
  const groups = new Map<number, Poly[]>();
  for (const section of compartmentSections(id)) {
    const polys = groups.get(section.x) ?? [];
    polys.push(section.poly);
    groups.set(section.x, polys);
  }
  return Array.from(groups.entries())
    .map(([x, polys]) => ({ x, polys }))
    .sort((a, b) => a.x - b.x);
}

function trap(
  rows: { x: number }[],
  value: (row: { x: number }, index: number) => number,
): number {
  let sum = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    sum += ((value(rows[i], i) + value(rows[i + 1], i + 1)) / 2)
      * (rows[i + 1].x - rows[i].x);
  }
  return sum;
}

function stateAtPlane(id: string, planeAt: (x: number) => Plane): Omit<TankState, "fillPct"> {
  const groups = groupedSections(id).map(group => {
    const plane = planeAt(group.x);
    let area = 0;
    let yMoment = 0;
    let zMoment = 0;
    const freeSegments: { width: number; yc: number }[] = [];
    for (const poly of group.polys) {
      const props = polyProps(clipBelow(poly, plane.a, plane.b));
      area += props.area;
      yMoment += props.area * props.yc;
      zMoment += props.area * props.zc;
      const crossings = lineCrossings(poly, plane.a, plane.b);
      if (crossings.length >= 2) {
        const y1 = crossings[0];
        const y2 = crossings[crossings.length - 1];
        freeSegments.push({ width: y2 - y1, yc: (y1 + y2) / 2 });
      }
    }
    return {
      x: group.x,
      area,
      yMoment,
      zMoment,
      freeSegments,
      freeBreadth: freeSegments.reduce((sum, segment) => sum + segment.width, 0),
      freeYMoment: freeSegments.reduce(
        (sum, segment) => sum + segment.width * segment.yc,
        0,
      ),
    };
  });

  const volume = trap(groups, (_, i) => groups[i].area);
  if (volume <= 1e-12) {
    return { id, level: 0, volume: 0, lcg: 0, tcg: 0, vcg: 0, iT: 0 };
  }
  const lcg = trap(groups, (row, i) => groups[i].area * row.x) / volume;
  const tcg = trap(groups, (_, i) => groups[i].yMoment) / volume;
  const vcg = trap(groups, (_, i) => groups[i].zMoment) / volume;
  const freeArea = trap(groups, (_, i) => groups[i].freeBreadth);
  const freeYc = freeArea > 1e-12
    ? trap(groups, (_, i) => groups[i].freeYMoment) / freeArea
    : 0;
  const iT = trap(groups, (_, i) => groups[i].freeSegments.reduce(
    (sum, segment) => sum
      + segment.width ** 3 / 12
      + segment.width * (segment.yc - freeYc) ** 2,
    0,
  ));
  return { id, level: 0, volume, lcg, tcg, vcg, iT };
}

function bounds(id: string): { bottom: number; top: number } {
  const def = compartment(id);
  return {
    bottom: Math.min(...def.boxes.map(box => box.z1)),
    top: Math.max(...def.boxes.map(box => box.z2)),
  };
}

export function tankCapacity(id: string): Capacity {
  const cached = capacityCache.get(id);
  if (cached) return cached;
  const def = compartment(id);
  const { bottom, top } = bounds(id);
  const full = stateAtPlane(id, () => ({ a: top, b: 0 }));
  const capacity = {
    capacity100: full.volume,
    top,
    bottom,
    ullageRef: def.ullageRef ?? top,
    lcg: full.lcg,
    tcg: full.tcg,
    vcg: full.vcg,
  };
  capacityCache.set(id, capacity);
  return capacity;
}

function levelTable(id: string): TankState[] {
  const cached = levelTableCache.get(id);
  if (cached) return cached;
  const cap = tankCapacity(id);
  const levels: number[] = [];
  const count = Math.floor((cap.top - cap.bottom) / 0.05);
  for (let i = 0; i <= count; i++) levels.push(cap.bottom + i * 0.05);
  if (levels[levels.length - 1] < cap.top - 1e-12) levels.push(cap.top);
  else levels[levels.length - 1] = cap.top;
  const table = levels.map(level => {
    const raw = stateAtPlane(id, () => ({ a: level, b: 0 }));
    return {
      ...raw,
      level,
      iT: level <= cap.bottom + 1e-12 || level >= cap.top - 1e-12 ? 0 : raw.iT,
      fillPct: cap.capacity100 > 0 ? (raw.volume / cap.capacity100) * 100 : 0,
    };
  });
  levelTableCache.set(id, table);
  return table;
}

function interpolate(a: TankState, b: TankState, fraction: number, level: number): TankState {
  const mix = (key: keyof TankState) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return av + fraction * (bv - av);
  };
  return {
    id: a.id,
    level,
    volume: mix("volume"),
    lcg: mix("lcg"),
    tcg: mix("tcg"),
    vcg: mix("vcg"),
    iT: mix("iT"),
    fillPct: mix("fillPct"),
  };
}

export function tankAtLevel(id: string, level: number): TankState {
  const cap = tankCapacity(id);
  const target = Math.min(cap.top, Math.max(cap.bottom, level));
  const table = levelTable(id);
  let low = 0;
  let high = table.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (table[mid].level <= target) low = mid;
    else high = mid;
  }
  if (Math.abs(table[low].level - target) < 1e-12) return table[low];
  if (Math.abs(table[high].level - target) < 1e-12) return table[high];
  const fraction = (target - table[low].level) / (table[high].level - table[low].level);
  return interpolate(table[low], table[high], fraction, target);
}

export function tankFill(id: string, volume: number): TankState {
  const cap = tankCapacity(id);
  const target = Math.min(cap.capacity100, Math.max(0, volume));
  const table = levelTable(id);
  if (target <= 0) return table[0];
  if (target >= cap.capacity100) return table[table.length - 1];
  let low = 0;
  let high = table.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (table[mid].volume <= target) low = mid;
    else high = mid;
  }
  const fraction = (target - table[low].volume) / (table[high].volume - table[low].volume);
  const level = table[low].level + fraction * (table[high].level - table[low].level);
  const state = interpolate(table[low], table[high], fraction, level);
  state.volume = target;
  state.fillPct = cap.capacity100 > 0 ? (target / cap.capacity100) * 100 : 0;
  return state;
}

export function tankAtLevelWp(id: string, level: number, wp: Waterplane): TankState {
  const def = compartment(id);
  const x1 = Math.min(...def.boxes.map(box => box.x1));
  const x2 = Math.max(...def.boxes.map(box => box.x2));
  const y1 = Math.min(...def.boxes.map(box => box.y1));
  const y2 = Math.max(...def.boxes.map(box => box.y2));
  const xc = (x1 + x2) / 2;
  const yc = (y1 + y2) / 2;
  const tanHeel = Math.tan((wp.heel * Math.PI) / 180);
  const raw = stateAtPlane(id, x => ({
    a: level + (wp.trim * (xc - x)) / DEMO_SHIP.hull.lbp - yc * tanHeel,
    b: tanHeel,
  }));
  const cap = tankCapacity(id);
  return {
    ...raw,
    level,
    iT: raw.volume <= 1e-12 || raw.volume >= cap.capacity100 - 1e-9 ? 0 : raw.iT,
    fillPct: cap.capacity100 > 0 ? (raw.volume / cap.capacity100) * 100 : 0,
  };
}

export function compartmentProps(
  id: string,
  wp: Waterplane,
): { volume: number; lcb: number; tcb: number; vcb: number } {
  const tanHeel = Math.tan((wp.heel * Math.PI) / 180);
  const raw = stateAtPlane(id, x => ({
    a: waterlineZ({ ...wp, heel: 0 }, x, 0),
    b: tanHeel,
  }));
  return { volume: raw.volume, lcb: raw.lcg, tcb: raw.tcg, vcb: raw.vcg };
}

export function listCompartments(kind?: CompartmentDef["kind"]): CompartmentDef[] {
  return kind
    ? DEMO_SHIP.compartments.filter(item => item.kind === kind)
    : [...DEMO_SHIP.compartments];
}
