import type { Criterion, GzPoint } from "../stability";

export type DamageKind = "side" | "bottom";

export interface DamageCase {
  id: string;
  kind: DamageKind;
  x0: number;
  x1: number;
  compartments: string[];
  label: string;
}

export interface DamageTank {
  compId: string;
  kind?: "cargo" | "ballast" | "fuel" | "fresh";
  density?: number;
  fillPct?: number;
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
  fsm?: number;
}

export interface DamageInput {
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
  fsmTotal: number;
  rho: number;
  tanks: DamageTank[];
}

export interface DamageEquilibrium {
  draftMid: number;
  draftAft: number;
  draftFwd: number;
  trim: number;
  heel: number;
  capsized: boolean;
  weight: number;
  kg: number;
  tcg: number;
}

export interface IntermediateDamageStage {
  pct: number;
  heel: number;
  ok: boolean;
  approximate: true;
}

export interface DamageCaseResult {
  case: DamageCase;
  equilibrium: DamageEquilibrium;
  gzCurve: GzPoint[];
  range: number;
  gzMax: number;
  area: number;
  gm: number;
  floodAngle: number | null;
  criteria: Criterion[];
  pass: boolean;
  intermediate: IntermediateDamageStage[];
}

export interface DamageResult {
  cases: DamageCaseResult[];
  worst: string;
  pass: boolean;
}
