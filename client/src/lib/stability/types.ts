export interface StabilityInput {
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
  fsmTotal: number;
  rho: number;
  trim: number;
  draftMid: number;
}

export interface GzPoint {
  heel: number;
  kn: number;
  gz: number;
}

export interface Criterion {
  id: string;
  name: string;
  required: string;
  actual: string;
  value: number;
  limit: number;
  pass: boolean;
}

export interface WeatherResult {
  lw1: number;
  lw2: number;
  theta0: number;
  theta1: number;
  theta2: number;
  thetaC: number;
  areaA: number;
  areaB: number;
  pass: boolean;
  rollPeriod: number;
  k: number;
  x1: number;
  x2: number;
  r: number;
  s: number;
}

export interface StabilityResult {
  kg: number;
  kgCorrected: number;
  gm0: number;
  gmCorrected: number;
  kmT: number;
  curve: GzPoint[];
  gzMax: number;
  gzMaxAngle: number;
  downfloodingAngle: number | null;
  area0to30: number;
  area0to40: number;
  area30to40: number;
  criteria: Criterion[];
  weather: WeatherResult;
  allowableKg: number | null;
  kgMargin: number | null;
  pass: boolean;
}

export interface StabilityOptions {
  allowableKg?: boolean;
}
