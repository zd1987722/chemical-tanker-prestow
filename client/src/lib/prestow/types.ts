import type { TableRow } from "../fl-engine";

export interface StowShip { id: string; label: string; synthetic: true; lbp: number; breadth: number; ibcType: 2; coating: "stainless"; maxCargoTempC: number; maxDraftM?: number; refLcg: number; tanks: StowTank[]; ballast: BallastTank[]; cofferdams: [string, string][]; }
export interface StowTank { id: string; label: string; station: number; side: "P" | "S"; cap100: number; lcg: number; tcg: number; vcg: number; maxCargoTempC?: number; }
export interface BallastTank { id: string; label: string; cap100: number; adjacentCargoTanks: string[]; }
export type LoadLineZone = "summer" | "winter" | "tropical";
export interface PortCall { id: string; seq: number; port: string; berth: string; note?: string; maxDraftM?: number; waterDensity?: number; distanceNm?: number; speedKn?: number; portHours?: number; bunkerMt?: number; freshWaterTakeMt?: number; loadLineZone?: LoadLineZone; }
export type Heating = { enabled: false } | { enabled: true; carriageTempC: number };
export type IntakeMode = "fixed" | "priority" | "ratio" | "range";
export interface Parcel { id: string; productId: number | null; name: string; display: string; group: number | null; quantityMt: number; density: number; loadTempC?: number; densityTable?: TableRow[]; loadCallId: string; dischargeCallId: string; heating: Heating; boilPointC: number | null; meltPointC: number | null; polymerizable: boolean; maxAllowedTempC: number | null; intake?: { mode: IntakeMode; priority?: number; ratio?: number; minMt?: number; maxMt?: number }; }
export interface VoyageConstants { departureDate?: string; serviceSpeedKn?: number; seaMarginPct?: number; meSeaLadenTpd?: number; meSeaBallastTpd?: number; aeSeaTpd?: number; aePortTpd?: number; cargoOpsLoadTpd?: number; cargoOpsDischargeTpd?: number; heatingTpdPer1000t?: number; fwConsumptionTpd?: number; fwGeneratorSeaTpd?: number; cargoRateTph?: number; portFixedHours?: number; bunkerReserveDays?: number; bunkerCapacityMt?: number; freshWaterCapacityMt?: number;  lightshipOverride?: number; bunkersMt?: number; bunkersLcg?: number; bunkersVcg?: number; freshWaterMt?: number; freshWaterLcg?: number; freshWaterVcg?: number; constantsMt?: number; constantsLcg?: number; constantsVcg?: number; trimTargetMin?: number; trimTargetMax?: number; ballastTrimTarget?: number; ballastTrimMax?: number; }
export interface StowVoyage { shipId: string; voyageNo: string; calls: PortCall[]; parcels: Parcel[]; constants?: VoyageConstants; }
export interface Allocation { parcelId: string; tanks: string[]; fillRatio: number; }
export interface TankLoad { parcelId: string; volume: number; weight: number; }
export interface StageBallastTank { id: string; pct: number; weight: number; }
export interface BallastRule { dmMin?: number; dm: number; draftFwdMin?: number; trimTarget: number; trimMin: number; trimMax: number; ok: boolean; notes: string[]; }
export interface StageFloating { displacement: number; draftMid: number; draftAft: number; draftFwd: number; trim: number; waterDensity: number; maxDraftM?: number; draftMargin?: number; limitSource?: "port" | "ship" | "zone"; zone?: LoadLineZone; ballastMt: number; ballastTanks: StageBallastTank[]; ballastRule?: BallastRule; gmCorrected: number; stabilityPass: boolean; stabilityNote?: string; sfPct: number; bmPct: number; strengthPass: boolean; /** false = 本阶段未做强度校核(strengthPass 无意义) */ strengthChecked?: boolean; approx: boolean;
  /** 本站按受限港规则放宽了纵倾窗口 */
  trimRelaxed?: boolean;
  /** 若配到平吃水还能再换出的最深吃水,m:max(draftAft, draftFwd) − draftMid,≥ 0 */
  trimReliefM?: number;
}
export interface StageState { consumables?: StageConsumables; callId: string; tanks: Record<string, TankLoad | null>; totalWeight: number; heelMomentTm: number; lcgM: number; emptiedCargoTanks?: string[]; floating?: StageFloating; arrival?: StageFloating; }
export interface Advisory { code: "ballast-cooling"; tankId: string; ballastId: string; parcelId: string; callIds: string[]; message: string; }
export interface PlanScore { minBunkerMarginMt?: number; tanksUsed: number; unpairedTanks: number; maxHeelMoment: number; maxLcgShift: number; advisoryCount: number; minDraftMargin?: number; minGm: number; maxBmPct: number; }
export interface StowPlan { consumablesOk: boolean; key: string; allocations: Allocation[]; stages: StageState[]; advisories: Advisory[]; score: PlanScore; draftOk?: boolean; stabilityOk: boolean; strengthOk: boolean; strengthChecked: boolean; bindingCallId?: string; intake?: Record<string, number>; }
export type TruncatedBy = "limit" | "maxPlans";
export type InfeasibilityCode = "no-candidate" | "tank-demand" | "capacity-relaxed" | "compat" | "thermal" | "draft" | "search-budget";
export interface InfeasibilityReason {
  code: InfeasibilityCode;
  severity: "blocker" | "likely" | "hint";
  message: string;
  parcels?: string[];
  target?: ValidationTarget;
}
export interface Diagnosis {
  reasons: InfeasibilityReason[];
  suggestions: string[];
  stats: { parcels: number; tanksTotal: number; tanksNeededMin: number; conflictPairs: number; thermalPairs: number; relaxedFeasible: boolean | null; rejectedByDraft: number; truncatedBy?: TruncatedBy };
}
export const INFEASIBILITY_LABELS: Record<InfeasibilityCode, string> = {
  "no-candidate": "舱容不足", "tank-demand": "舱数不足", "capacity-relaxed": "舱容不足",
  compat: "相容性", thermal: "热隔离", draft: "吃水超限", "search-budget": "枚举耗尽",
};
export type StowResult =
  | { status: "invalid"; errors: string[]; issues?: ValidationIssue[] }
  | { status: "ok" | "truncated"; truncatedBy?: TruncatedBy; plans: StowPlan[]; totalFound: number; conflictPairs: [string, string][]; message: string; rejectedByDraft?: number; diagnosis?: Diagnosis; intakeSummary?: { parcelId: string; quantityMt: number; limitedBy: string; consumptionCreditMt?: number }[] };
export interface EngineOptions { limit?: number; maxPlans?: number; /** 意向求解只用快速估算,跳过静水力精算收敛(修复建议等对速度敏感的场景) */ fastOnly?: boolean; }

export interface ValidationTarget { section: "calls" | "parcels" | "constants"; index?: number; field?: string; }
export interface ValidationIssue { message: string; target: ValidationTarget; }

export interface StageConsumables {
  legNm: number; legDays: number; portDays: number;
  etaDay: number; etdDay: number;
  legFuelMt: number; legFwMt: number;
  portFuelMt: number; portFwMt: number;
  bunkerMt: number; freshWaterTakeMt: number;
  arrival: { fuelMt: number; freshWaterMt: number };
  departure: { fuelMt: number; freshWaterMt: number };
  reserveMt: number;
  warnings: string[];
}

/** 无解修复:对原计划的一处修改(减量或整票删除)。 */
export interface RepairChange { parcelId: string; display: string; kind: "reduce" | "drop"; fromMt: number; toMt: number; note?: string; }
export interface RepairProposal {
  id: string;
  title: string;
  origin: "reduce" | "drop" | "combo" | "draft";
  changes: RepairChange[];
  /** 比原计划少装的吨数。 */
  removedMt: number;
  /** 排序用代价:少装吨数 + 整票删除惩罚。 */
  cost: number;
  message: string;
  /** 应用修改后的航次(已复核可行)。 */
  voyage: StowVoyage;
}
export interface RepairReport { proposals: RepairProposal[]; tried: number; elapsedMs: number; note?: string; }
