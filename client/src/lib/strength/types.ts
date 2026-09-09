export type StrengthMode = "sea" | "harbour";

export interface StrengthInput {
  tanks: { compId: string; level: number; weight: number }[];
  constants: { weight: number; lcg: number }[];
  floating: { draftMid: number; trim: number; waterDensity: number };
  includeLightship?: boolean;
}

export interface LoadStation {
  x: number;
  weight: number;
  buoyancy: number;
  net: number;
}

export interface StrengthPoint {
  x: number;
  frame: number;
  sf: number;
  bm: number;
  sfAllow: number;
  bmAllow: number;
  sfPct: number;
  bmPct: number;
}

export interface StrengthResult {
  mode: StrengthMode;
  stations: LoadStation[];
  points: StrengthPoint[];
  maxSf: { value: number; x: number; pct: number; sign: 1 | -1 };
  maxSfPct: { pct: number; x: number; value: number };
  maxBm: {
    value: number;
    x: number;
    pct: number;
    kind: "hogging" | "sagging";
  };
  maxBmPct: {
    pct: number;
    x: number;
    value: number;
    kind: "hogging" | "sagging";
  };
  pass: boolean;
  closureError: number;
}
