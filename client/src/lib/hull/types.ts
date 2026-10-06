export type Pt = { y: number; z: number };
export type Poly = Pt[];

export interface Waterplane {
  draftMid: number;
  trim: number;
  heel: number;
}

export interface PolyProps {
  area: number;
  yc: number;
  zc: number;
  iyy: number;
  iy0: number;
}

export interface HullParams {
  lbp: number;
  breadth: number;
  depth: number;
  xMin: number;
  xMax: number;
  pmbStart: number;
  pmbEnd: number;
  aftExp: number;
  fwdExp: number;
  nMid: number;
  nEnd: number;
  cutUpX: number;
  cutUpZ: number;
  bulb: { x0: number; halfLen: number; z0: number; halfH: number; amp: number };
  dx: number;
  dz: number;
}

export interface Section {
  x: number;
  poly: Poly;
  deckHalfBreadth: number;
  keelZ: number;
}

export interface Hull {
  params: HullParams;
  sections: Section[];
}

export interface BoxDef {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  z1: number;
  z2: number;
}

export interface CompartmentDef {
  id: string;
  name: string;
  kind: "cargo" | "ballast" | "fuel" | "fresh" | "void";
  boxes: BoxDef[];
  ullageRef?: number;
}

export interface LightshipItem {
  name: string;
  weight: number;
  x1: number;
  x2: number;
  vcg: number;
  dist: "uniform" | "hull";
}

export interface AllowableRow {
  x: number;
  bmHogSea: number;
  bmSagSea: number;
  bmHogHar: number;
  bmSagHar: number;
  sfSea: number;
  sfHar: number;
}

export interface DemoShipDef {
  id: string;
  label: string;
  hull: HullParams;
  designDraft: number;
  scantlingDraft: number;
  frameSpacing: number;
  doubleBottom: number;
  doubleSide: number;
  compartments: CompartmentDef[];
  lightship: LightshipItem[];
  allowables: AllowableRow[];
  superstructure?: {
    profile: Array<{ id: string; points: [number, number][] }>;
    section: Array<{ id: string; points: [number, number][] }>;
    plan: Array<{ id: string; points: [number, number][] }>;
  };
  deckhouse: { x1: number; x2: number; height: number };
  forecastle: { x1: number; x2: number; height: number };
  geometry: {
    bridgeX: number;
    bridgeEyeZ: number;
    forecastleTopZ: number;
    propeller: { x: number; z: number; diameter: number };
    mastTopZ: number;
    minForwardDraft: number;
  };
  openings: { name: string; x: number; y: number; z: number }[];
}

export interface HullProps {
  volume: number;
  disp: number;
  lcb: number;
  tcb: number;
  vcb: number;
  awp: number;
  lcf: number;
  iT: number;
  iL: number;
  tpc: number;
  mtc: number;
  kb: number;
  bmT: number;
  kmT: number;
  bmL: number;
  kmL: number;
  draftAft: number;
  draftFwd: number;
  cb: number;
  cwp: number;
}

export interface TankState {
  id: string;
  level: number;
  volume: number;
  lcg: number;
  tcg: number;
  vcg: number;
  iT: number;
  fillPct: number;
}

export interface CompSection {
  x: number;
  poly: Poly;
}
