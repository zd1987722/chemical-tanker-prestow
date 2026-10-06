import type { LoadCalcPort } from "../cargo/ports";

export type LoadKind = "cargo" | "ballast" | "fuel" | "fresh";

export interface CargoGrade {
  id: string;
  name: string;
  abbr: string;
  densityBase: number;
  densityBasis: "air" | "vacuum";
  method: "none" | "astm54b" | "tec";
  tec?: number;
  color?: string;
}

export interface TankLoad {
  compId: string;
  density: number;
  level: number;
  cargoName?: string;
  gradeId?: string;
  temperature?: number;
  tempC?: number;
  entry?: "level" | "pct" | "volume" | "weight";
  fsmMode?: "actual" | "max" | "zero";
}

export interface FixedWeight {
  id: string;
  name: string;
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
}

export interface LoadingCondition {
  id: string;
  name: string;
  note?: string;
  /** 从预配载带入的港口快照，不覆盖用户维护的港口表。 */
  port?: Omit<LoadCalcPort, "id">;
  approved?: boolean;
  waterDensity: number;
  tanks: TankLoad[];
  constants: FixedWeight[];
  grades?: CargoGrade[];
  calcMode?: "beforeLoading" | "afterLoading";
  voyage?: {
    operator?: string;
    date?: string;
    pol?: string;
    pod?: string;
    remark?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TankResult {
  compId: string;
  kind: LoadKind;
  name: string;
  level: number;
  ullage: number;
  sounding: number;
  volume: number;
  fillPct: number;
  density: number;
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
  fsm: number;
}

export interface WeightGroup {
  weight: number;
  lcg: number;
  tcg: number;
  vcg: number;
}

export interface ConditionResult {
  groups: {
    lightship: WeightGroup;
    cargo: WeightGroup;
    ballast: WeightGroup;
    fuel: WeightGroup;
    fresh: WeightGroup;
    constants: WeightGroup;
    deadweight: WeightGroup;
    total: WeightGroup;
  };
  tanks: TankResult[];
  fsmTotal: number;
  floating: {
    draftMid: number;
    draftAft: number;
    draftFwd: number;
    trim: number;
    heel: number;
    draftMarkAft: number;
    draftMarkMid: number;
    draftMarkFwd: number;
    displacement: number;
    volume: number;
    lcb: number;
    vcb: number;
    lcf: number;
    tpc: number;
    mtc: number;
    kmT: number;
    kg: number;
    gm0: number;
    gsc: number;
    gmCorrected: number;
    waterDensity: number;
  };
  warnings: string[];
}
