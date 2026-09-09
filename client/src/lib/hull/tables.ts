import type { StowShip } from "../prestow/types";
import { listCompartments, tankAtLevel, tankCapacity } from "./compartments";
import { buildHull, planW } from "./hull-form";
import { bonjean, findDraftForVolume, hullProps, waterlineZ } from "./integrate";
import { DEMO_SHIP } from "./ship-demo";
import type { HullProps, TankState } from "./types";

export function hydrostaticsTable(
  trims: number[] = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3],
  drafts: { from: number; to: number; step: number } = { from: 2, to: 16, step: 0.1 },
): { trim: number; rows: HullProps[] }[] {
  const count = Math.round((drafts.to - drafts.from) / drafts.step);
  return trims.map(trim => ({
    trim,
    rows: Array.from({ length: count + 1 }, (_, index) => hullProps({
      draftMid: drafts.from + index * drafts.step,
      trim,
      heel: 0,
    })),
  }));
}

export function bonjeanTable(dz = 0.5): { x: number[]; z: number[]; area: number[][] } {
  const hull = buildHull();
  const zCount = Math.round(hull.params.depth / dz);
  const z = Array.from({ length: zCount + 1 }, (_, index) => index * dz);
  const x = hull.sections.map(section => section.x);
  return { x, z, area: x.map(station => z.map(level => bonjean(station, level, hull))) };
}

let knCache: { disp: number[]; heel: number[]; kn: number[][] } | undefined;

export function knTable(): { disp: number[]; heel: number[]; kn: number[][] } {
  if (knCache) return knCache;
  const disp = Array.from({ length: 27 }, (_, index) => 5000 + index * 2500);
  const heel = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80];
  const kn = disp.map(displacement => heel.map(angle => {
    const draftMid = findDraftForVolume(displacement / 1.025, 0, angle);
    const props = hullProps({ draftMid, trim: 0, heel: angle });
    const radians = (angle * Math.PI) / 180;
    return props.tcb * Math.cos(radians) + props.vcb * Math.sin(radians);
  }));
  knCache = { disp, heel, kn };
  return knCache;
}

export function windProfile(draftMid: number): { area: number; zc: number } {
  const hull = buildHull();
  const rows = hull.sections.map(section => {
    if (planW(section.x, hull.params) <= 0) return { x: section.x, area: 0, moment: 0 };
    const waterline = waterlineZ({ draftMid, trim: 0, heel: 0 }, section.x, 0);
    const height = Math.max(0, hull.params.depth - waterline);
    return {
      x: section.x,
      area: height,
      moment: height * (waterline + hull.params.depth) / 2,
    };
  });
  let area = 0;
  let moment = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const dx = rows[i + 1].x - rows[i].x;
    area += (rows[i].area + rows[i + 1].area) / 2 * dx;
    moment += (rows[i].moment + rows[i + 1].moment) / 2 * dx;
  }
  for (const house of [DEMO_SHIP.deckhouse, DEMO_SHIP.forecastle]) {
    const houseArea = (house.x2 - house.x1) * house.height;
    area += houseArea;
    moment += houseArea * (hull.params.depth + house.height / 2);
  }
  return { area, zc: area > 0 ? moment / area : 0 };
}

export function windAreaTable(): { draft: number; area: number; zc: number }[] {
  return Array.from({ length: 25 }, (_, index) => {
    const draft = 2 + index * 0.5;
    return { draft, ...windProfile(draft) };
  });
}

export function tankTables(step = 0.1): {
  id: string;
  name: string;
  kind: string;
  capacity100: number;
  ullageRef: number;
  rows: TankState[];
}[] {
  return listCompartments().map(compartment => {
    const cap = tankCapacity(compartment.id);
    const count = Math.floor((cap.top - cap.bottom) / step);
    const levels = Array.from({ length: count + 1 }, (_, index) => cap.bottom + index * step);
    if (levels[levels.length - 1] < cap.top - 1e-12) levels.push(cap.top);
    else levels[levels.length - 1] = cap.top;
    return {
      id: compartment.id,
      name: compartment.name,
      kind: compartment.kind,
      capacity100: cap.capacity100,
      ullageRef: cap.ullageRef,
      rows: levels.map(level => tankAtLevel(compartment.id, level)),
    };
  });
}

let lightshipRows: { x: number; w: number; vcg: number }[] | undefined;

export function lightshipDistribution(): { x: number; w: number; vcg: number }[] {
  if (lightshipRows) return lightshipRows;
  const hull = buildHull();
  const rows = hull.sections.slice(0, -1).map(section => ({
    x: section.x + hull.params.dx / 2,
    w: 0,
    verticalMoment: 0,
  }));
  for (const item of DEMO_SHIP.lightship) {
    const raw = rows.map(row => {
      const segmentStart = row.x - hull.params.dx / 2;
      const segmentEnd = row.x + hull.params.dx / 2;
      const overlap = Math.max(0, Math.min(segmentEnd, item.x2) - Math.max(segmentStart, item.x1));
      if (overlap === 0) return 0;
      return item.dist === "hull"
        ? overlap * (0.65 * Math.sqrt(planW(row.x, hull.params)) + 0.35)
        : overlap;
    });
    const totalRaw = raw.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < rows.length; i++) {
      const weight = totalRaw > 0 ? item.weight * raw[i] / totalRaw : 0;
      rows[i].w += weight;
      rows[i].verticalMoment += weight * item.vcg;
    }
  }
  lightshipRows = rows.map(row => ({
    x: row.x,
    w: row.w,
    vcg: row.w > 0 ? row.verticalMoment / row.w : 0,
  }));
  return lightshipRows;
}

export function lightshipSummary(): { weight: number; lcg: number; vcg: number; tcg: number } {
  const rows = lightshipDistribution();
  const weight = rows.reduce((sum, row) => sum + row.w, 0);
  return {
    weight,
    lcg: rows.reduce((sum, row) => sum + row.w * row.x, 0) / weight,
    vcg: rows.reduce((sum, row) => sum + row.w * row.vcg, 0) / weight,
    tcg: 0,
  };
}

export function allowableAt(
  x: number,
  kind: "sea" | "harbour",
): { bmHog: number; bmSag: number; sf: number } {
  const rows = DEMO_SHIP.allowables;
  if (x < rows[0].x || x > rows[rows.length - 1].x) return { bmHog: 0, bmSag: 0, sf: 0 };
  let upper = rows.findIndex(row => row.x >= x);
  if (upper < 0) upper = rows.length - 1;
  const lower = Math.max(0, upper - 1);
  const fraction = upper === lower ? 0 : (x - rows[lower].x) / (rows[upper].x - rows[lower].x);
  const mix = (a: number, b: number) => a + fraction * (b - a);
  return kind === "sea"
    ? {
        bmHog: mix(rows[lower].bmHogSea, rows[upper].bmHogSea),
        bmSag: mix(rows[lower].bmSagSea, rows[upper].bmSagSea),
        sf: mix(rows[lower].sfSea, rows[upper].sfSea),
      }
    : {
        bmHog: mix(rows[lower].bmHogHar, rows[upper].bmHogHar),
        bmSag: mix(rows[lower].bmSagHar, rows[upper].bmSagHar),
        sf: mix(rows[lower].sfHar, rows[upper].sfHar),
      };
}

export function shipSummary(): Record<string, number | string> {
  const design = hullProps({ draftMid: DEMO_SHIP.designDraft, trim: 0, heel: 0 });
  const scantling = hullProps({ draftMid: DEMO_SHIP.scantlingDraft, trim: 0, heel: 0 });
  const lightship = lightshipSummary().weight;
  const capacity = (kind: "cargo" | "ballast" | "fuel" | "fresh") => listCompartments(kind)
    .reduce((sum, item) => sum + tankCapacity(item.id).capacity100, 0);
  return {
    id: DEMO_SHIP.id,
    label: DEMO_SHIP.label,
    lbp: DEMO_SHIP.hull.lbp,
    breadth: DEMO_SHIP.hull.breadth,
    depth: DEMO_SHIP.hull.depth,
    designDraft: DEMO_SHIP.designDraft,
    scantlingDraft: DEMO_SHIP.scantlingDraft,
    cb: design.cb,
    cwp: design.cwp,
    dispDesign: design.disp,
    dispScantling: scantling.disp,
    lightship,
    deadweight: scantling.disp - lightship,
    cargoCapacity: capacity("cargo"),
    ballastCapacity: capacity("ballast"),
    fuelCapacity: capacity("fuel"),
    freshWaterCapacity: capacity("fresh"),
  };
}

function xRange(id: string): { x1: number; x2: number } {
  const def = DEMO_SHIP.compartments.find(item => item.id === id)!;
  return {
    x1: Math.min(...def.boxes.map(box => box.x1)),
    x2: Math.max(...def.boxes.map(box => box.x2)),
  };
}

export function toStowShip(): StowShip {
  const tanks = listCompartments("cargo").map(compartment => {
    const cap = tankCapacity(compartment.id);
    const station = Number.parseInt(compartment.id, 10);
    const side = compartment.id.endsWith("P") ? "P" as const : "S" as const;
    return {
      id: compartment.id,
      label: compartment.name,
      station,
      side,
      cap100: cap.capacity100,
      lcg: cap.lcg,
      tcg: cap.tcg,
      vcg: cap.vcg,
    };
  });
  const ballast = listCompartments("ballast")
    .filter(compartment => /^WB[1-5][PS]$/.test(compartment.id))
    .map(compartment => {
      const side = compartment.id.endsWith("P") ? "P" : "S";
      const wb = xRange(compartment.id);
      const adjacentCargoTanks = listCompartments("cargo")
        .filter(cargo => cargo.id.endsWith(side))
        .filter(cargo => {
          const range = xRange(cargo.id);
          const overlap = Math.min(wb.x2, range.x2) - Math.max(wb.x1, range.x1);
          return overlap > 0.5 || Math.abs(range.x1 - wb.x2) < 1e-9;
        })
        .map(cargo => cargo.id);
      return {
        id: compartment.id,
        label: compartment.name,
        cap100: tankCapacity(compartment.id).capacity100,
        adjacentCargoTanks,
      };
    });
  const totalCapacity = tanks.reduce((sum, tank) => sum + tank.cap100, 0);
  return {
    id: "demo-mr",
    label: "虚构船 · 演示 · MR 型油化船",
    synthetic: true,
    lbp: 175,
    breadth: 32,
    ibcType: 2,
    coating: "stainless",
    maxCargoTempC: 90,
    maxDraftM: DEMO_SHIP.scantlingDraft,
    refLcg: tanks.reduce((sum, tank) => sum + tank.cap100 * tank.lcg, 0) / totalCapacity,
    tanks,
    ballast,
    cofferdams: [],
  };
}
