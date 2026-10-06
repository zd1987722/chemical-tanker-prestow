import {
  DEMO_SHIP,
  allowableAt,
  bonjean,
  clipBelow,
  compartmentSections,
  lightshipDistribution,
  polyProps,
  waterlineZ,
} from "../hull";
import type { ConditionResult } from "../loadcalc/types";
import type {
  LoadStation,
  StrengthInput,
  StrengthMode,
  StrengthPoint,
  StrengthResult,
} from "./types";

const G = 9.81;
const MIN_ALLOWABLE_RATIO = 0.02;
const { dx: DX, xMin: X_MIN, xMax: X_MAX } = DEMO_SHIP.hull;
const SEGMENT_COUNT = Math.round((X_MAX - X_MIN) / DX);

type AreaRow = { x: number; area: number };
type MinimumAllowables = { sf: number; bm: number };

function emptyStations(): LoadStation[] {
  return Array.from({ length: SEGMENT_COUNT }, (_, index) => ({
    x: X_MIN + (index + 0.5) * DX,
    weight: 0,
    buoyancy: 0,
    net: 0,
  }));
}

function areaAt(rows: AreaRow[], x: number): number {
  if (x < rows[0].x || x > rows[rows.length - 1].x) return 0;
  let low = 0;
  let high = rows.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].x <= x) low = mid;
    else high = mid;
  }
  if (Math.abs(x - rows[low].x) < 1e-12) return rows[low].area;
  if (Math.abs(x - rows[high].x) < 1e-12) return rows[high].area;
  const fraction = (x - rows[low].x) / (rows[high].x - rows[low].x);
  return rows[low].area + fraction * (rows[high].area - rows[low].area);
}

function tankAreaRows(compId: string, level: number): AreaRow[] {
  const grouped = new Map<number, number>();
  for (const section of compartmentSections(compId)) {
    const area = polyProps(clipBelow(section.poly, level, 0)).area;
    grouped.set(section.x, (grouped.get(section.x) ?? 0) + area);
  }
  return Array.from(grouped, ([x, area]) => ({ x, area })).sort(
    (a, b) => a.x - b.x
  );
}

function addTankWeight(
  stations: LoadStation[],
  tank: StrengthInput["tanks"][number]
): void {
  if (tank.weight === 0) return;
  const rows = tankAreaRows(tank.compId, tank.level);
  if (rows.length < 2) return;
  const start = rows[0].x;
  const end = rows[rows.length - 1].x;
  const volumes = stations.map((_, index) => {
    const segmentStart = X_MIN + index * DX;
    const segmentEnd = segmentStart + DX;
    const overlapStart = Math.max(segmentStart, start);
    const overlapEnd = Math.min(segmentEnd, end);
    if (overlapEnd <= overlapStart) return 0;
    return (
      ((areaAt(rows, overlapStart) + areaAt(rows, overlapEnd)) *
        (overlapEnd - overlapStart)) /
      2
    );
  });
  const volume = volumes.reduce((sum, value) => sum + value, 0);
  if (volume <= 0) return;
  for (let index = 0; index < stations.length; index++) {
    stations[index].weight += (tank.weight * volumes[index]) / volume / DX;
  }
}

function addConstantWeight(
  stations: LoadStation[],
  constant: StrengthInput["constants"][number]
): void {
  const start = constant.lcg - 2;
  const end = constant.lcg + 2;
  const density = constant.weight / 4;
  for (let index = 0; index < stations.length; index++) {
    const segmentStart = X_MIN + index * DX;
    const segmentEnd = segmentStart + DX;
    const overlap = Math.max(
      0,
      Math.min(segmentEnd, end) - Math.max(segmentStart, start)
    );
    stations[index].weight += (density * overlap) / DX;
  }
}

export function weightDistribution(input: StrengthInput): LoadStation[] {
  const stations = emptyStations();
  if (input.includeLightship !== false) {
    for (const row of lightshipDistribution()) {
      const index = Math.round((row.x - (X_MIN + DX / 2)) / DX);
      if (stations[index]) stations[index].weight += row.w / DX;
    }
  }
  for (const tank of input.tanks) addTankWeight(stations, tank);
  for (const constant of input.constants) addConstantWeight(stations, constant);
  return stations;
}

export function buoyancyDistribution(
  floating: StrengthInput["floating"]
): number[] {
  const waterplane = {
    draftMid: floating.draftMid,
    trim: floating.trim,
    heel: 0,
  };
  return emptyStations().map(
    station =>
      bonjean(station.x, waterlineZ(waterplane, station.x, 0)) *
      floating.waterDensity
  );
}

function integrate(net: number[]): { sf: number[]; bm: number[] } {
  const sf = new Array<number>(net.length + 1).fill(0);
  const bm = new Array<number>(net.length + 1).fill(0);
  for (let index = 0; index < net.length; index++) {
    sf[index + 1] = sf[index] + net[index] * DX * G;
    bm[index + 1] = bm[index] + ((sf[index] + sf[index + 1]) * DX) / 2;
  }
  return { sf, bm };
}

function closeResidual(net: number[], sfEnd: number, bmEnd: number): number[] {
  const length = SEGMENT_COUNT * DX;
  let force0 = 0;
  let force1 = 0;
  let moment0 = 0;
  let moment1 = 0;
  for (let index = 0; index < SEGMENT_COUNT; index++) {
    const x = (index + 0.5) * DX;
    force0 += DX;
    force1 += x * DX;
    moment0 += (length - x) * DX;
    moment1 += (length - x) * x * DX;
  }
  const targetForce = -sfEnd / G;
  const targetMoment = -bmEnd / G;
  const determinant = force0 * moment1 - force1 * moment0;
  const intercept =
    (targetForce * moment1 - force1 * targetMoment) / determinant;
  const slope = (force0 * targetMoment - targetForce * moment0) / determinant;
  return net.map(
    (value, index) => value + intercept + slope * (index + 0.5) * DX
  );
}

function pointAt(
  index: number,
  sf: number,
  bm: number,
  mode: StrengthMode,
  minimumAllowables: MinimumAllowables
): StrengthPoint {
  const x = X_MIN + index * DX;
  const allowable = allowableAt(x, mode);
  const bmAllow = bm >= 0 ? allowable.bmHog : Math.abs(allowable.bmSag);
  return {
    x,
    frame: x / DEMO_SHIP.frameSpacing,
    sf,
    bm,
    sfAllow: allowable.sf,
    bmAllow,
    sfPct:
      allowable.sf >= minimumAllowables.sf
        ? (Math.abs(sf) / allowable.sf) * 100
        : 0,
    bmPct:
      bmAllow >= minimumAllowables.bm
        ? (Math.abs(bm) / bmAllow) * 100
        : 0,
  };
}

function minimumAllowables(mode: StrengthMode): MinimumAllowables {
  const maxima = DEMO_SHIP.allowables.reduce(
    (current, row) => ({
      sf: Math.max(current.sf, mode === "sea" ? row.sfSea : row.sfHar),
      bm: Math.max(
        current.bm,
        mode === "sea" ? row.bmHogSea : row.bmHogHar,
        Math.abs(mode === "sea" ? row.bmSagSea : row.bmSagHar)
      ),
    }),
    { sf: 0, bm: 0 }
  );
  return {
    sf: maxima.sf * MIN_ALLOWABLE_RATIO,
    bm: maxima.bm * MIN_ALLOWABLE_RATIO,
  };
}

export function computeStrength(
  input: StrengthInput,
  mode: StrengthMode
): StrengthResult {
  const stations = weightDistribution(input);
  const buoyancy = buoyancyDistribution(input.floating);
  for (let index = 0; index < stations.length; index++) {
    stations[index].buoyancy = buoyancy[index];
    stations[index].net = buoyancy[index] - stations[index].weight;
  }

  const physicalNet = stations.map(station => station.net);
  let integrated = integrate(physicalNet);
  const totalWeight = stations.reduce(
    (sum, station) => sum + station.weight * DX,
    0
  );
  if (
    Math.abs(integrated.sf[integrated.sf.length - 1]) >
    0.01 * totalWeight * G
  ) {
    const last = integrated.sf.length - 1;
    integrated = integrate(
      closeResidual(physicalNet, integrated.sf[last], integrated.bm[last])
    );
  }

  const thresholds = minimumAllowables(mode);
  const points = integrated.sf.map((sf, index) =>
    // The x axis runs aft-to-forward; invert the mathematical integral so
    // positive bending moment retains the naval-architecture hogging sign.
    pointAt(index, sf, -integrated.bm[index], mode, thresholds)
  );
  const maxSfPoint = points.reduce((max, point) =>
    Math.abs(point.sf) > Math.abs(max.sf) ? point : max
  );
  const maxBmPoint = points.reduce((max, point) =>
    Math.abs(point.bm) > Math.abs(max.bm) ? point : max
  );
  const maxSfPctPoint = points
    .filter(point => point.sfAllow >= thresholds.sf)
    .reduce((max, point) => (point.sfPct > max.sfPct ? point : max));
  const maxBmPctPoint = points
    .filter(point => point.bmAllow >= thresholds.bm)
    .reduce((max, point) => (point.bmPct > max.bmPct ? point : max));
  const closureError = integrated.sf[integrated.sf.length - 1];

  return {
    mode,
    stations,
    points,
    maxSf: {
      value: maxSfPoint.sf,
      x: maxSfPoint.x,
      pct: maxSfPoint.sfPct,
      sign: maxSfPoint.sf >= 0 ? 1 : -1,
    },
    maxSfPct: {
      pct: maxSfPctPoint.sfPct,
      x: maxSfPctPoint.x,
      value: maxSfPctPoint.sf,
    },
    maxBm: {
      value: maxBmPoint.bm,
      x: maxBmPoint.x,
      pct: maxBmPoint.bmPct,
      kind: maxBmPoint.bm >= 0 ? "hogging" : "sagging",
    },
    maxBmPct: {
      pct: maxBmPctPoint.bmPct,
      x: maxBmPctPoint.x,
      value: maxBmPctPoint.bm,
      kind: maxBmPctPoint.bm >= 0 ? "hogging" : "sagging",
    },
    pass: maxSfPctPoint.sfPct <= 100 && maxBmPctPoint.bmPct <= 100,
    closureError,
  };
}

export function strengthFromCondition(
  result: ConditionResult,
  mode: StrengthMode
): StrengthResult {
  const constants =
    result.groups.constants.weight === 0
      ? []
      : [
          {
            weight: result.groups.constants.weight,
            lcg: result.groups.constants.lcg,
          },
        ];
  return computeStrength(
    {
      tanks: result.tanks.map(tank => ({
        compId: tank.compId,
        level: tank.level,
        weight: tank.weight,
      })),
      constants,
      floating: result.floating,
    },
    mode
  );
}
