import { simulateConsumables, isLadenLeg, zoneDraftLimit } from "./consumption";
import { evaluateCompat } from "../uscg-verdict";
import { deriveAdjacency } from "../voyage";
import { calcTank, densityAt, FL_COEFF } from "../fl-engine";
import { fastAutoBallast } from "../ballast";
import { propellerImmersion } from "../checks/geometry";
import { lightshipSummary, tankAtLevel, tankCapacity, tankFill } from "../hull";
import { DEMO_SHIP } from "../hull/ship-demo";
import type {
  Advisory,
  Allocation,
  BallastRule,
  EngineOptions,
  Parcel,
  PortCall,
  StageFloating,
  StageState,
  StowPlan,
  StowResult,
  StowShip,
  StowVoyage,
  TankLoad,
  VoyageConstants,
  ValidationIssue,
  ValidationTarget,
} from "./types";
import { fastFloating } from "./hydro-fast";
import { scorePlan, comparePlans } from "./rank";
import { solveIntake } from "./intake";
import { diagnoseInfeasibility } from "./diagnose";
import { fastStability } from "./stability-fast";
import { fastStrength } from "./strength-fast";

export interface PreparedParcel { parcel: Parcel; volume: number; ll: number; usableTanks: Set<string>; }
export interface PairMatrix { ok: Record<string, Record<string, boolean>>; conflicts: [string, string][]; }
export interface TankGroup { tanks: string[]; singles: number; fillRatio: number; }

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** 数值型输入不变量:有限、范围合理、ID/序号唯一(NaN/Infinity 会穿透 `> 0` 判断) */
function validateNumbers(voyage: StowVoyage, report: (message: string, target: ValidationTarget) => void) {
  const callIds = new Set<string>(), seqs = new Set<number>();
  for (const [index, c] of Array.from(voyage.calls.entries())) {
    const add = (message: string, field?: string) => report(message, { section: "calls", index, field });
    const tag = c.port || c.id;
    if (callIds.has(c.id)) add(`停靠点 ${tag}:ID 重复`);
    callIds.add(c.id);
    if (!finite(c.seq)) add(`停靠点 ${tag}:港序无效`);
    else if (seqs.has(c.seq)) add(`停靠点 ${tag}:港序 ${c.seq} 重复`);
    seqs.add(c.seq);
    if (c.maxDraftM != null && !(finite(c.maxDraftM) && c.maxDraftM > 0)) add(`停靠点 ${tag}:最大吃水无效`, "maxDraftM");
    if (c.waterDensity != null && !(finite(c.waterDensity) && c.waterDensity >= 0.9 && c.waterDensity <= 1.1)) add(`停靠点 ${tag}:水密度须在 0.900–1.100`, "waterDensity");
    if (c.distanceNm != null && !(finite(c.distanceNm) && c.distanceNm >= 0)) add(`停靠点 ${tag}:航程无效`, "distanceNm");
    if (c.speedKn != null && !(finite(c.speedKn) && c.speedKn > 0)) add(`停靠点 ${tag}:航速必须大于 0`, "speedKn");
    for (const [key, label] of [["portHours", "在港时间"], ["bunkerMt", "加油量"], ["freshWaterTakeMt", "加水量"]] as const) {
      const value = c[key];
      if (value != null && !(finite(value) && value >= 0)) add(`停靠点 ${tag}:${label}无效`, key);
    }
  }
  const parcelIds = new Set<string>();
  for (const [index, p] of Array.from(voyage.parcels.entries())) {
    const add = (message: string, field?: string) => report(message, { section: "parcels", index, field });
    const tag = p.display || p.id;
    if (parcelIds.has(p.id)) add(`${tag}:货票 ID 重复`);
    parcelIds.add(p.id);
    const intake = p.intake;
    if (!intake) continue;
    switch (intake.mode) {
      case "priority":
        if (intake.priority != null && !finite(intake.priority)) add(`${tag}:优先级无效`, "priority");
        break;
      case "ratio":
        if (intake.ratio != null && !(finite(intake.ratio) && intake.ratio > 0)) add(`${tag}:比例必须大于 0`, "ratio");
        break;
      case "range":
        if (intake.minMt != null && !(finite(intake.minMt) && intake.minMt >= 0)) add(`${tag}:最低吨数无效`, "minMt");
        if (intake.maxMt != null && !(finite(intake.maxMt) && intake.maxMt > 0)) add(`${tag}:最高吨数无效`, "maxMt");
        if (finite(intake.minMt) && finite(intake.maxMt) && intake.minMt > intake.maxMt) add(`${tag}:最低吨数大于最高吨数`, "minMt");
        break;
    }
  }
  const constants = voyage.constants ?? {};
  for (const [key, value] of Object.entries(constants)) {
    const add = (message: string) => report(message, { section: "constants", field: key });
    if (value == null || key === "departureDate") continue;
    if (!finite(value)) { add(`航次常数 ${key} 无效`); continue; }
    if (/Speed|Capacity|Rate/.test(key) && !(value > 0)) add(`航次常数 ${key} 必须大于 0`);
    if (/Tpd|Mt$|Pct|Days|Hours|Per1000t/.test(key) && !/Lcg|Vcg|Target|Max|Min/.test(key) && value < 0) add(`航次常数 ${key} 不能为负`);
  }
}

export function validateVoyageIssues(ship: StowShip, voyage: StowVoyage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (message: string, target: ValidationTarget) => { issues.push({ message, target }); };
  if (!voyage.parcels.length) report("至少需要一票货", { section: "parcels" });
  if (!voyage.calls.length) report("至少需要一个停靠点", { section: "calls" });
  validateNumbers(voyage, report);
  const callSeq = new Map(voyage.calls.map(c => [c.id, c.seq]));
  const totalCap = ship.tanks.reduce((a, t) => a + t.cap100, 0);
  let totalVol = 0;
  for (const [index, p] of Array.from(voyage.parcels.entries())) {
    const add = (message: string, field: string) => report(message, { section: "parcels", index, field });
    const tag = p.display || p.id;
    if ((p.intake?.mode ?? "fixed") === "fixed" && !(finite(p.quantityMt) && p.quantityMt > 0)) add(`${tag}:数量必须大于 0`, "quantityMt");
    if (!(finite(p.density) && p.density > 0 && p.density < 5)) add(`${tag}:密度必须大于 0`, "density");
    const ls = callSeq.get(p.loadCallId), ds = callSeq.get(p.dischargeCallId);
    if (ls == null || ds == null) add(`${tag}:装泊位或卸泊位不存在`, ls == null ? "loadCallId" : "dischargeCallId");
    else if (ls >= ds) add(`${tag}:装泊位必须早于卸泊位`, "dischargeCallId");
    if (p.heating.enabled && !Number.isFinite(p.heating.carriageTempC)) add(`${tag}:加温航行温度无效`, "carriageTempC");
    if (p.densityTable) {
      if (p.loadTempC == null) add(`${tag}:给了温度-密度表但缺装货温度 loadTempC`, "loadTempC");
      else if (!densityAt(p.densityTable, p.loadTempC)) add(`${tag}:装货温度超出温度-密度表范围`, "loadTempC");
      if (p.heating.enabled && !densityAt(p.densityTable, p.heating.carriageTempC)) add(`${tag}:航行温度超出温度-密度表范围`, "carriageTempC");
    }
    if (p.quantityMt > 0 && p.density > 0) totalVol += p.quantityMt / p.density;
  }
  if (totalVol > FL_COEFF * totalCap) report(`总体积 ${totalVol.toFixed(0)} m³ 超过船舶可装 ${(FL_COEFF * totalCap).toFixed(0)} m³`, { section: "parcels" });
  return issues;
}

export function validateVoyage(ship: StowShip, voyage: StowVoyage): string[] {
  return validateVoyageIssues(ship, voyage).map(issue => issue.message);
}

export function prepareParcels(ship: StowShip, voyage: StowVoyage): PreparedParcel[] | { errors: string[]; issues: ValidationIssue[] } {
  const issues = validateVoyageIssues(ship, voyage);
  if (issues.length) return { errors: issues.map(issue => issue.message), issues };
  return voyage.parcels.map(parcel => prepareParcel(ship, parcel));
}

/** Prepare an already validated parcel, including materialized intake targets. */
export function prepareParcel(ship: StowShip, parcel: Parcel): PreparedParcel {
    const volume = parcel.quantityMt / parcel.density;
    let ll = FL_COEFF;
    if (parcel.densityTable && parcel.heating.enabled) {
      const rhoR = densityAt(parcel.densityTable, parcel.heating.carriageTempC)!.rho;
      const r = calcTank({ capacity100: 1, rhoR, table: parcel.densityTable, temp: parcel.loadTempC! });
      if (!r.outOfRange) ll = r.ll;
    }
    const usableTanks = new Set(
      ship.tanks
        .filter(t => !parcel.heating.enabled || parcel.heating.carriageTempC <= (t.maxCargoTempC ?? ship.maxCargoTempC))
        .map(t => t.id)
    );
    return { parcel, volume, ll, usableTanks };
}

/** a 加温时,b 能否与 a 相邻。a 不加温恒 true。 */
export function thermalOk(a: Parcel, b: Parcel): boolean {
  if (!a.heating.enabled) return true;
  const T = a.heating.carriageTempC;
  if (b.polymerizable) return false;
  if (b.boilPointC == null) return false;
  if (T >= b.boilPointC - 10) return false;
  if (b.maxAllowedTempC != null && b.maxAllowedTempC < T) return false;
  return true;
}

export function buildPairOk(parcels: Parcel[]): PairMatrix {
  const ok: PairMatrix["ok"] = {};
  const conflicts: [string, string][] = [];
  for (const a of parcels) ok[a.id] = {};
  for (let i = 0; i < parcels.length; i++) {
    for (let j = i + 1; j < parcels.length; j++) {
      const a = parcels[i], b = parcels[j];
      const v = evaluateCompat(a.group, b.group, a.name, b.name);
      const pass = v.known && v.isCompatible && thermalOk(a, b) && thermalOk(b, a);
      ok[a.id][b.id] = pass;
      ok[b.id][a.id] = pass;
      if (!pass) conflicts.push([a.display, b.display]);
    }
  }
  return { ok, conflicts };
}

export function buildAdjacency(ship: StowShip): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const t of ship.tanks) m.set(t.id, new Set());
  for (const [a, b] of deriveAdjacency(ship.tanks.map(t => t.id), ship.cofferdams)) {
    m.get(a)?.add(b);
    m.get(b)?.add(a);
  }
  return m;
}

/** 舱组候选:m 个完整 P/S 对 + s 个单舱(s ≤ maxSingles),k ∈ {kMin, kMin+1}。 */
export function candidateGroups(p: PreparedParcel, ship: StowShip, maxSingles: number): TankGroup[] {
  const capOf = new Map(ship.tanks.map(t => [t.id, t.cap100]));
  const usable = ship.tanks.filter(t => p.usableTanks.has(t.id));
  if (!usable.length) return [];
  const capMax = Math.max(...usable.map(t => t.cap100));
  const kMin = Math.max(1, Math.ceil(p.volume / (p.ll * capMax)));
  const stations = Array.from(new Set(usable.map(t => t.station))).sort((a, b) => a - b);
  const pairs = stations
    .filter(st => p.usableTanks.has(`${st}P`) && p.usableTanks.has(`${st}S`))
    .map(st => [`${st}P`, `${st}S`]);
  const singles = usable.map(t => t.id).sort(byTankId);
  const tankOrder = new Map(singles.map((id, index) => [id, index]));
  const out: TankGroup[] = [];
  for (const k of [kMin, kMin + 1]) {
    for (let s = 0; s <= Math.min(k, maxSingles); s++) {
      const m = (k - s) / 2;
      if (!Number.isInteger(m)) continue;
      for (const pairSel of combos(pairs, m)) {
        const used = new Set(pairSel.flat());
        const freeSingles = singles.filter(id => !used.has(id));
        for (const singleSel of combos(freeSingles, s)) {
          const tanks = [...pairSel.flat(), ...singleSel]
            .sort((a, b) => tankOrder.get(a)! - tankOrder.get(b)!);
          const cap = tanks.reduce((a, id) => a + capOf.get(id)!, 0);
          if (p.volume > p.ll * cap) continue;
          out.push({ tanks, singles: s, fillRatio: p.volume / cap });
        }
      }
    }
  }
  // 已按 k、s、生成顺序(站号字典序)排列;combos 保持输入顺序即可
  return out;
}

export function byTankId(a: string, b: string): number {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  return na !== nb ? na - nb : a.localeCompare(b);
}

function combos<T>(arr: T[], k: number, start = 0, acc: T[] = []): T[][] {
  if (acc.length === k) return [acc.slice()];
  const out: T[][] = [];
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    out.push(...combos(arr, k, i + 1, acc));
    acc.pop();
  }
  return out;
}

export const DEFAULT_LIMIT = 3_000_000;
const DEFAULT_MAX_PLANS = 2000;
const STRENGTH_CHECK_TOP = 60;

export const DEFAULT_CONSTANTS = {
  serviceSpeedKn: 13,
  seaMarginPct: 8,
  meSeaLadenTpd: 22,
  meSeaBallastTpd: 19,
  aeSeaTpd: 3,
  aePortTpd: 4,
  cargoOpsLoadTpd: 2,
  cargoOpsDischargeTpd: 6,
  heatingTpdPer1000t: 0.5,
  fwConsumptionTpd: 4,
  fwGeneratorSeaTpd: 15,
  cargoRateTph: 500,
  portFixedHours: 6,
  bunkerReserveDays: 3,
  bunkerCapacityMt: 2000,
  freshWaterCapacityMt: 450,

  bunkersMt: 1200,
  bunkersLcg: 22,
  bunkersVcg: 8,
  freshWaterMt: 250,
  freshWaterLcg: 11,
  freshWaterVcg: 11,
  constantsMt: 200,
  constantsLcg: 30,
  constantsVcg: 12,
  trimTargetMin: 0,
  trimTargetMax: 0.5,
  ballastTrimTarget: 1,
  ballastTrimMax: 2.5,
} satisfies VoyageConstants;

const halfLevelIT = new Map<string, number>();

function freeSurfaceIT(tankId: string): number {
  const cached = halfLevelIT.get(tankId);
  if (cached != null) return cached;
  const capacity = tankCapacity(tankId);
  const value = tankAtLevel(tankId, (capacity.bottom + capacity.top) / 2).iT;
  halfLevelIT.set(tankId, value);
  return value;
}

const flip = (id: string) => id.endsWith("P") ? id.slice(0, -1) + "S" : id.endsWith("S") ? id.slice(0, -1) + "P" : id;

export function mirrorKey(allocs: Allocation[]): string {
  const sig = (map: (t: string) => string) =>
    [...allocs]
      .sort((a, b) => a.parcelId.localeCompare(b.parcelId))
      .map(a => `${a.parcelId}:${a.tanks.map(map).sort(byTankId).join("+")}`)
      .join("|");
  const s1 = sig(t => t), s2 = sig(flip);
  return s1 < s2 ? s1 : s2;
}

export interface SearchOut { allocs: Allocation[][]; rejectedByDraft: number; truncatedBy?: "limit" | "maxPlans"; firstRejected?: Allocation[] }

export function search(
  prepared: PreparedParcel[],
  groups: TankGroup[][],
  pair: PairMatrix,
  adj: Map<string, Set<string>>,
  limit: number,
  maxPlans: number,
  accept: (allocations: Allocation[]) => boolean,
  seen: Set<string>,
): SearchOut {
  const occupant = new Map<string, string>();
  const out: Allocation[][] = [];
  const cur: Allocation[] = [];
  let steps = 0;
  let rejectedByDraft = 0;
  let firstRejected: Allocation[] | undefined;
  let truncatedBy: SearchOut["truncatedBy"];

  const rec = (i: number): boolean => {
    if (++steps > limit) { truncatedBy = "limit"; return true; }
    if (i === prepared.length) {
      const key = mirrorKey(cur);
      if (!seen.has(key)) {
        seen.add(key);
        const allocations = cur.map(a => ({ ...a, tanks: [...a.tanks] }));
        if (!accept(allocations)) {
          rejectedByDraft++;
          firstRejected ??= allocations;
          return false;
        }
        out.push(allocations);
        if (out.length >= maxPlans) { truncatedBy = "maxPlans"; return true; }
      }
      return false;
    }
    const pid = prepared[i].parcel.id;
    for (const g of groups[i]) {
      if (++steps > limit) { truncatedBy = "limit"; return true; }
      let feasible = true;
      for (const t of g.tanks) {
        if (occupant.has(t)) { feasible = false; break; }
        for (const n of Array.from(adj.get(t)!)) {
          const o = occupant.get(n);
          if (o != null && o !== pid && !pair.ok[pid][o]) { feasible = false; break; }
        }
        if (!feasible) break;
      }
      if (!feasible) continue;
      for (const t of g.tanks) occupant.set(t, pid);
      cur.push({ parcelId: pid, tanks: g.tanks, fillRatio: g.fillRatio });
      const stop = rec(i + 1);
      cur.pop();
      for (const t of g.tanks) occupant.delete(t);
      if (stop) return true;
    }
    return false;
  };
  rec(0);
  return { allocs: out, rejectedByDraft, truncatedBy, firstRejected };
}

/** 中途装货港(之后还有装货港)的纵倾窗口。 */
export const INTERMEDIATE_TRIM_WINDOW = { trimMin: -0.5, trimMax: 2.5 } as const;

export function isIntermediateLoadingCall(voyage: StowVoyage, call: PortCall): boolean {
  const seqOf = new Map(voyage.calls.map(item => [item.id, item.seq]));
  const loadsHere = voyage.parcels.some(parcel => parcel.loadCallId === call.id);
  const loadsLater = voyage.parcels.some(parcel => (seqOf.get(parcel.loadCallId) ?? -1) > call.seq);
  return loadsHere && loadsLater;
}

export interface BallastTargets {
  trimMin: number;
  trimMax: number;
  trimTarget: number;
  dmMin?: number;
  draftFwdMin?: number;
  propellerImmersed: true;
  gmMin: 0.3;
  preferredUnits?: string[];
  relaxedForDraft?: boolean;
}

const PROPELLER_Z_TOP =
  DEMO_SHIP.geometry.propeller.z + DEMO_SHIP.geometry.propeller.diameter / 2;

function isDeparture(stage: StageState, call: PortCall): boolean {
  return stage.callId === call.id;
}

function preferredBallastUnits(
  ship: StowShip,
  voyage: StowVoyage,
  stage: StageState,
  call: PortCall,
): string[] {
  if (
    !isDeparture(stage, call) ||
    !voyage.parcels.some(parcel => parcel.dischargeCallId === call.id)
  ) return [];
  const emptied = new Set(stage.emptiedCargoTanks ?? []);
  const preferred = new Map<string, { order: number; adjacentTanks: number }>();
  for (let order = 0; order < ship.ballast.length; order++) {
    const tank = ship.ballast[order];
    if (!tank.adjacentCargoTanks.some(tankId => emptied.has(tankId))) continue;
    const unit = tank.id.match(/^WB\d+/)?.[0] ?? tank.id;
    const existing = preferred.get(unit);
    preferred.set(unit, {
      order: existing?.order ?? order,
      adjacentTanks: (existing?.adjacentTanks ?? 0) + 1,
    });
  }
  return Array.from(preferred.entries())
    .sort(([, a], [, b]) =>
      b.adjacentTanks - a.adjacentTanks || a.order - b.order
    )
    .map(([unit]) => unit);
}

export function stageBallastTargets(
  ship: StowShip,
  voyage: StowVoyage,
  stage: StageState,
  call: PortCall,
): BallastTargets {
  const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const preferredUnits = preferredBallastUnits(ship, voyage, stage, call);
  if (!isLadenLeg(ship, stage)) {
    const minimumDraft = 2 + 0.02 * ship.lbp;
    return {
      trimMin: 0.3,
      trimMax: constants.ballastTrimMax,
      trimTarget: constants.ballastTrimTarget,
      dmMin: minimumDraft,
      draftFwdMin: minimumDraft,
      propellerImmersed: true,
      gmMin: 0.3,
      preferredUnits,
    };
  }
  if (isDeparture(stage, call) && isIntermediateLoadingCall(voyage, call)) {
    return {
      ...INTERMEDIATE_TRIM_WINDOW,
      trimTarget: 0.5,
      propellerImmersed: true,
      gmMin: 0.3,
      preferredUnits,
    };
  }
  const hasLaterDischarge = voyage.parcels.some(parcel => {
    const discharge = voyage.calls.find(item => item.id === parcel.dischargeCallId);
    return discharge != null && discharge.seq > call.seq;
  });
  const unloadsHere = voyage.parcels.some(
    parcel => parcel.dischargeCallId === call.id,
  );
  if (isDeparture(stage, call) && unloadsHere && hasLaterDischarge) {
    return {
      trimMin: 0,
      trimMax: 2.5,
      trimTarget: 0.5,
      propellerImmersed: true,
      gmMin: 0.3,
      preferredUnits,
    };
  }
  return {
    trimMin: constants.trimTargetMin,
    trimMax: constants.trimTargetMax,
    trimTarget: (constants.trimTargetMin + constants.trimTargetMax) / 2,
    propellerImmersed: true,
    gmMin: 0.3,
    preferredUnits,
  };
}

/** 吃水裕量低于此值(含超限)时,允许把纵倾放宽到接近平吃水以换取最深吃水。与 presentation.ts 的临界阈值 0.05 一致。 */
export const DRAFT_RELIEF_TRIGGER_M = 0.05;
/** 放宽后的纵倾下限:允许轻微艏倾,避免目标 0 落在窗口边界被判未达成。 */
export const RELAXED_TRIM_MIN_M = -0.1;

export function draftRelaxedTargets(targets: BallastTargets): BallastTargets | undefined {
  if (targets.dmMin != null) return undefined;
  return {
    ...targets,
    trimMin: Math.min(targets.trimMin, RELAXED_TRIM_MIN_M),
    trimTarget: 0,
    relaxedForDraft: true,
  };
}

export interface DraftReliefOutcome<R> { result: R; targets: BallastTargets; trimRelaxed: boolean; }

export function solveWithDraftRelief<R>(
  targets: BallastTargets,
  maxDraftM: number | undefined,
  solve: (targets: BallastTargets) => R,
  read: (result: R) => { draftAft: number; draftFwd: number; ok?: boolean },
): DraftReliefOutcome<R> {
  const first = solve(targets);
  const original = { result: first, targets, trimRelaxed: false };
  if (maxDraftM == null) return original;
  const firstDraft = read(first);
  const deepest = Math.max(firstDraft.draftAft, firstDraft.draftFwd);
  if (maxDraftM - deepest >= DRAFT_RELIEF_TRIGGER_M) return original;
  const relaxed = draftRelaxedTargets(targets);
  if (!relaxed) return original;
  const second = solve(relaxed);
  const secondDraft = read(second);
  if (
    deepest - Math.max(secondDraft.draftAft, secondDraft.draftFwd) >= 0.005 &&
    (secondDraft.ok !== false || firstDraft.ok === false)
  ) return { result: second, targets: relaxed, trimRelaxed: true };
  return original;
}

export function solverBallastTargets(targets: BallastTargets) {
  const { propellerImmersed, relaxedForDraft, ...solverTargets } = targets;
  return {
    ...solverTargets,
    propellerZTop: propellerImmersed ? PROPELLER_Z_TOP : undefined,
  };
}

export function ballastRuleFor(
  targets: BallastTargets,
  floating: Pick<StageFloating, "draftMid" | "draftAft" | "draftFwd" | "trim">,
): BallastRule {
  const notes: string[] = [];
  if (targets.dmMin != null && floating.draftMid < targets.dmMin)
    notes.push(`dm ${floating.draftMid.toFixed(2)} m 低于 ${targets.dmMin.toFixed(2)} m`);
  if (targets.draftFwdMin != null && floating.draftFwd < targets.draftFwdMin)
    notes.push(`艏吃水 ${floating.draftFwd.toFixed(2)} m 低于 ${targets.draftFwdMin.toFixed(2)} m`);
  if (targets.propellerImmersed && !propellerImmersion(floating).pass)
    notes.push("螺旋桨未全浸");
  if (floating.trim < targets.trimMin || floating.trim > targets.trimMax)
    notes.push(`纵倾 ${floating.trim.toFixed(2)} m 未进入 ${targets.trimMin.toFixed(2)}–${targets.trimMax.toFixed(2)} m`);
  return {
    dmMin: targets.dmMin,
    dm: floating.draftMid,
    draftFwdMin: targets.draftFwdMin,
    trimTarget: targets.trimTarget,
    trimMin: targets.trimMin,
    trimMax: targets.trimMax,
    ok: notes.length === 0,
    notes,
  };
}

export function stageFloating(ship: StowShip, voyage: StowVoyage, stage: StageState, call: PortCall, includeStrength = true, consumables?: { fuelMt: number; freshWaterMt: number }): StageFloating {
  const lightship = lightshipSummary();
  const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const fuelMt = consumables?.fuelMt ?? constants.bunkersMt;
  const freshWaterMt = consumables?.freshWaterMt ?? constants.freshWaterMt;
  const lightshipWeight = voyage.constants?.lightshipOverride ?? lightship.weight;
  const displacement = lightshipWeight
    + fuelMt
    + freshWaterMt
    + constants.constantsMt
    + stage.totalWeight;
  const longitudinalMoment = lightshipWeight * lightship.lcg
    + fuelMt * constants.bunkersLcg
    + freshWaterMt * constants.freshWaterLcg
    + constants.constantsMt * constants.constantsLcg
    + stage.totalWeight * stage.lcgM;
  let cargoVerticalMoment = 0;
  let fsmTotal = 0;
  for (const tank of ship.tanks) {
    const tankId = tank.id;
    const load = stage.tanks[tankId];
    if (!load) continue;
    cargoVerticalMoment += load.weight * tank.vcg;
    if (load.volume / tank.cap100 >= 0.98) continue;
    fsmTotal += freeSurfaceIT(tankId) * (load.weight / load.volume);
  }
  const verticalMoment = lightshipWeight * lightship.vcg
    + fuelMt * constants.bunkersVcg
    + freshWaterMt * constants.freshWaterVcg
    + constants.constantsMt * constants.constantsVcg
    + cargoVerticalMoment;
  const waterDensity = call.waterDensity ?? 1.025;
  const portLimit = call.maxDraftM;
  const shipLimit = ship.maxDraftM == null ? undefined : zoneDraftLimit(ship.maxDraftM, call.loadLineZone);
  const limitSource = portLimit != null && (shipLimit == null || portLimit <= shipLimit)
    ? "port"
    : shipLimit != null
      ? call.loadLineZone && call.loadLineZone !== "summer" ? "zone" : "ship"
      : undefined;
  const maxDraftM = limitSource === "port" ? portLimit : shipLimit;
  const ballastTargets = stageBallastTargets(ship, voyage, stage, call);
  const outcome = solveWithDraftRelief(
    ballastTargets,
    maxDraftM,
    targets => {
      const ballast = fastAutoBallast(
        displacement,
        longitudinalMoment / displacement,
        (verticalMoment + fsmTotal) / displacement,
        waterDensity,
        solverBallastTargets(targets),
      );
      const ballastMt = ballast.ballast.reduce((sum, tank) => sum + tank.weight, 0);
      const ballastMoment = ballast.ballast.reduce((sum, tank) => sum + tank.weight * tank.lcg, 0);
      const balancedDisplacement = displacement + ballastMt;
      const floating = fastFloating(balancedDisplacement, (longitudinalMoment + ballastMoment) / balancedDisplacement, waterDensity);
      return { ballast, ballastMt, balancedDisplacement, floating };
    },
    result => result.floating,
  );
  const { ballast, ballastMt, balancedDisplacement, floating } = outcome.result;
  const ballastVerticalMoment = ballast.ballast.reduce(
    (sum, tank) => sum + tank.weight * tank.vcg,
    0
  );
  const stability = fastStability(
    balancedDisplacement,
    (verticalMoment + ballastVerticalMoment + fsmTotal) / balancedDisplacement,
    stage.heelMomentTm / balancedDisplacement,
    waterDensity,
    floating.kmT,
  );
  const draftMargin = maxDraftM == null
    ? undefined
    : maxDraftM - Math.max(floating.draftAft, floating.draftFwd);
  const strength = includeStrength
    ? fastStrength(
        Object.entries(stage.tanks).flatMap(([compId, load]) =>
          load
            ? [{
                compId,
                weight: load.weight,
                level: tankFill(compId, load.volume).level,
              }]
            : []
        ).concat(ballast.ballast.map(tank => ({
          compId: tank.compId,
          weight: tank.weight,
          level: tankFill(
            tank.compId,
            tank.weight / waterDensity
          ).level,
        }))),
        [
          { weight: fuelMt, lcg: constants.bunkersLcg },
          { weight: freshWaterMt, lcg: constants.freshWaterLcg },
          { weight: constants.constantsMt, lcg: constants.constantsLcg },
        ],
        {
          draftMid: floating.draftMid,
          trim: floating.trim,
          waterDensity,
        }
      )
    : { sfPct: 0, bmPct: 0, pass: true };
  return {
    strengthChecked: includeStrength,
    displacement: balancedDisplacement,
    draftMid: floating.draftMid,
    draftAft: floating.draftAft,
    draftFwd: floating.draftFwd,
    trim: floating.trim,
    trimRelaxed: outcome.trimRelaxed,
    trimReliefM: Math.max(0, Math.max(floating.draftAft, floating.draftFwd) - floating.draftMid),
    waterDensity,
    maxDraftM,
    draftMargin,
    limitSource,
    zone: call.loadLineZone ?? "summer",
    ballastMt,
    ballastTanks: ballast.ballast.map(tank => ({
      id: tank.compId,
      pct: tank.weight / (tankCapacity(tank.compId).capacity100 * waterDensity) * 100,
      weight: tank.weight,
    })),
    ballastRule: ballastRuleFor(outcome.targets, floating),
    gmCorrected: stability.gmCorrected,
    stabilityPass: stability.pass,
    stabilityNote: stability.note,
    sfPct: strength.sfPct,
    bmPct: strength.bmPct,
    strengthPass: strength.pass,
    approx: true,
  };
}

export function stageDraftMargin(stage: StageState): number | undefined {
  const margins = [stage.arrival?.draftMargin, stage.floating?.draftMargin]
    .filter((margin): margin is number => margin != null);
  return margins.length ? Math.min(...margins) : undefined;
}

export function stageDraftExceeded(stage: StageState): boolean {
  const margin = stageDraftMargin(stage);
  return margin != null && margin < 0;
}

export function simulateStages(ship: StowShip, voyage: StowVoyage, allocs: Allocation[], includeStrength = true): StageState[] {
  const tankOf = new Map(ship.tanks.map(t => [t.id, t]));
  const parcelOf = new Map(voyage.parcels.map(p => [p.id, p]));
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);
  const state: Record<string, TankLoad | null> = {};
  for (const t of ship.tanks) state[t.id] = null;
  const out: StageState[] = [];
  const cargoTotals = () => {
    let totalWeight = 0, heelMomentTm = 0, longitudinalMoment = 0;
    for (const tank of ship.tanks) {
      const load = state[tank.id];
      if (!load) continue;
      totalWeight += load.weight;
      heelMomentTm += load.weight * tank.tcg;
      longitudinalMoment += load.weight * tank.lcg;
    }
    return {
      totalWeight,
      heelMomentTm,
      lcgM: totalWeight > 0 ? longitudinalMoment / totalWeight : ship.refLcg,
    };
  };
  for (const call of calls) {
    const beforeOperations = { ...state };
    // 同港换货先卸后装，避免卸掉刚装入同一舱的新票货。
    for (const a of allocs) {
      const p = parcelOf.get(a.parcelId)!;
      if (p.dischargeCallId !== call.id) continue;
      for (const t of a.tanks) state[t] = null;
    }
    for (const a of allocs) {
      const p = parcelOf.get(a.parcelId)!;
      if (p.loadCallId === call.id) {
        for (const t of a.tanks) {
          const volume = tankOf.get(t)!.cap100 * a.fillRatio;
          state[t] = { parcelId: p.id, volume, weight: volume * p.density };
        }
      }
    }
    const afterOperations = cargoTotals();
    const emptiedCargoTanks = ship.tanks
      .filter(tank => beforeOperations[tank.id] != null && state[tank.id] == null)
      .map(tank => tank.id);
    const stage: StageState = {
      callId: call.id,
      tanks: { ...state },
      ...afterOperations,
      emptiedCargoTanks,
    };
    out.push(stage);
  }
  const consumables = simulateConsumables(ship, voyage, out);
  out.forEach((stage, index) => {
    const call = calls[index];
    stage.consumables = consumables[index];
    stage.floating = stageFloating(ship, voyage, stage, call, includeStrength, stage.consumables.departure);
    const previous = out[index - 1];
    if (previous?.floating && call.seq > 0) {
      // 到港状态按到港油水/压载重算(含强度);此前复制上一离港的 SF/BM 不是到港状态的实测值
      stage.arrival = stageFloating(ship, voyage, previous, call, includeStrength, stage.consumables.arrival);
    }
  });
  return out;
}

export function buildAdvisories(ship: StowShip, voyage: StowVoyage, allocs: Allocation[], _stages: StageState[]): Advisory[] {
  const parcelOf = new Map(voyage.parcels.map(p => [p.id, p]));
  const tankOf = new Map(ship.tanks.map(t => [t.id, t]));
  const seqOf = new Map(voyage.calls.map(c => [c.id, c.seq]));
  const labelOf = new Map(voyage.calls.map(c => [c.id, `${c.port} ${c.berth}`]));
  const dischargeCalls = new Set(voyage.parcels.map(p => p.dischargeCallId));
  const out: Advisory[] = [];
  for (const a of allocs) {
    const p = parcelOf.get(a.parcelId)!;
    const sensitive = p.heating.enabled || (p.meltPointC != null && p.meltPointC > 15);
    if (!sensitive) continue;
    const ls = seqOf.get(p.loadCallId)!, ds = seqOf.get(p.dischargeCallId)!;
    const callIds = voyage.calls
      .filter(c => c.seq > ls && c.seq < ds && dischargeCalls.has(c.id))
      .sort((x, y) => x.seq - y.seq)
      .map(c => c.id);
    for (const t of a.tanks) {
      for (const wb of ship.ballast) {
        if (!wb.adjacentCargoTanks.includes(t)) continue;
        const when = callIds.length ? `候选阶段:${callIds.map(id => labelOf.get(id)).join("、")}` : "本航次无中途卸货阶段";
        out.push({
          code: "ballast-cooling", tankId: t, ballastId: wb.id, parcelId: p.id, callIds,
          message: `${tankOf.get(t)!.label} 旁 ${wb.id} 打压载可能导致 ${p.display} 降温/凝固(${when})`,
        });
      }
    }
  }
  return out;
}

export function solvePrestow(
  ship: StowShip,
  voyage: StowVoyage,
  opts: EngineOptions = {},
  candidateOverrides?: ReadonlyMap<string, TankGroup[]>,
  strengthCheckTop = STRENGTH_CHECK_TOP,
  diagnoseZero = true,
): StowResult {
  if (voyage.parcels.some(parcel => parcel.intake?.mode != null && parcel.intake.mode !== "fixed")) {
    return solveIntake(ship, voyage, opts);
  }
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxPlans = opts.maxPlans ?? DEFAULT_MAX_PLANS;
  const prep = prepareParcels(ship, voyage);
  if ("errors" in prep) return { status: "invalid", errors: prep.errors, issues: prep.issues };
  const prepared = [...prep].sort((a, b) => b.volume - a.volume);
  const pair = buildPairOk(voyage.parcels);
  const adj = buildAdjacency(ship);
  const seen = new Set<string>();
  const acceptedStages = new WeakMap<Allocation[], StageState[]>();
  const acceptDraft = (allocations: Allocation[]) => {
    const stages = simulateStages(ship, voyage, allocations, false);
    const accepted = stages.every(stage => !stageDraftExceeded(stage));
    // 同一分配在筛选和评分时沿用相同浮态，避免受限港重复执行两次配平。
    if (accepted) acceptedStages.set(allocations, stages);
    return accepted;
  };
  const groupsFor = (parcel: PreparedParcel, maxSingles: number) =>
    candidateOverrides?.get(parcel.parcel.id) ?? candidateGroups(parcel, ship, maxSingles);

  let found = search(prepared, prepared.map(p => groupsFor(p, 1)), pair, adj, limit, maxPlans, acceptDraft, seen);
  if (!found.allocs.length && !found.truncatedBy) {
    const retried = search(prepared, prepared.map(p => groupsFor(p, Infinity)), pair, adj, limit, maxPlans, acceptDraft, seen);
    found = { ...retried, rejectedByDraft: found.rejectedByDraft + retried.rejectedByDraft, firstRejected: found.firstRejected ?? retried.firstRejected };
  }

  const evaluatePlan = (
    allocations: Allocation[],
    includeStrength: boolean,
  ): StowPlan => {
    const stages = (!includeStrength && acceptedStages.get(allocations))
      || simulateStages(ship, voyage, allocations, includeStrength);
    const advisories = buildAdvisories(ship, voyage, allocations, stages);
    const limitedStages = stages.filter(stage => stageDraftMargin(stage) != null);
    const firstExceeded = limitedStages.find(stageDraftExceeded);
    const bindingStage = firstExceeded ?? limitedStages.reduce<StageState | undefined>((best, stage) =>
      !best || stageDraftMargin(stage)! < stageDraftMargin(best)! ? stage : best,
    undefined);
    const draftOk = firstExceeded == null;
    const plan: StowPlan = {
      key: mirrorKey(allocations),
      allocations,
      stages,
      advisories,
      score: { tanksUsed: 0, unpairedTanks: 0, maxHeelMoment: 0, maxLcgShift: 0, advisoryCount: 0, minGm: 0, maxBmPct: 0 },
      draftOk,
      stabilityOk: stages.every(stage => stage.floating?.stabilityPass !== false && stage.arrival?.stabilityPass !== false),
      consumablesOk: stages.every(stage => !stage.consumables?.warnings.some(warning => /燃油不足以到港|淡水不足/.test(warning))),
      strengthOk: stages.every(stage => stage.floating?.strengthPass !== false && stage.arrival?.strengthPass !== false),
      strengthChecked: includeStrength,
      bindingCallId: bindingStage?.callId,
    };
    plan.score = scorePlan(plan, ship);
    return plan;
  };
  const evaluatedPlans = found.allocs.map(allocations =>
    evaluatePlan(allocations, false)
  );
  const rejectedByDraft = found.rejectedByDraft + evaluatedPlans.filter(plan => !plan.draftOk).length;
  const plans = evaluatedPlans.filter(plan => plan.draftOk);
  plans.sort(comparePlans);
  const checkedPlans = plans
    .slice(0, strengthCheckTop)
    .map(plan => evaluatePlan(plan.allocations, true));
  checkedPlans.sort(comparePlans);
  plans.splice(0, checkedPlans.length, ...checkedPlans);

  const n = plans.length;
  const status = found.truncatedBy ? "truncated" : "ok";
  const baseMessage =
    found.truncatedBy === "maxPlans" ? `已收集 ${n} 个方案后停止枚举,未列出的方案不代表不可行`
    : found.truncatedBy === "limit" ? `枚举步数达上限(已收集 ${n} 个),可能还有其他方案`
    : n === 0 ? "无满足约束的方案"
    : `共 ${n} 个可行方案`;
  const message = rejectedByDraft > 0
    ? `${baseMessage}；另有 ${rejectedByDraft} 个方案因吃水超限剔除`
    : baseMessage;
  const result: StowResult = { status, truncatedBy: found.truncatedBy, plans, totalFound: n, conflictPairs: pair.conflicts, message, rejectedByDraft };
  if (plans.length === 0 && diagnoseZero) result.diagnosis = diagnoseInfeasibility({
    ship, voyage, prepared, pair, adj, groupsFor,
    found: { ...found, rejectedByDraft, firstRejected: found.firstRejected ?? evaluatedPlans.find(plan => !plan.draftOk)?.allocations },
    limit,
  });
  return result;
}

/**
 * 方案可行性的唯一口径:列表默认展示、排序、修改建议复核、导出都用它。
 * 吃水超限 / 稳性 / 油水不合格即不可行;强度只在已校核时参与判定(未校核 ≠ 通过)。
 */
export function planFeasible(plan: StowPlan): boolean {
  return plan.draftOk !== false
    && plan.stabilityOk
    && plan.consumablesOk !== false
    && (!plan.strengthChecked || plan.strengthOk);
}

/** 独立校验器(不复用回溯逻辑):供测试与界面自检。 */
export function checkPlan(ship: StowShip, voyage: StowVoyage, plan: StowPlan): string[] {
  const errs: string[] = [];
  const prep = prepareParcels(ship, voyage);
  if ("errors" in prep) return prep.errors;
  const byId = new Map(prep.map(p => [p.parcel.id, p]));
  const capOf = new Map(ship.tanks.map(t => [t.id, t.cap100]));
  const pair = buildPairOk(voyage.parcels);
  const adj = buildAdjacency(ship);
  const occ = new Map<string, string>();
  // 每票恰好一条分配、舱组非空、装载率有限且在许可范围内、吨数守恒(意向票按 plan.intake)
  const allocCount = new Map<string, number>();
  for (const a of plan.allocations) allocCount.set(a.parcelId, (allocCount.get(a.parcelId) ?? 0) + 1);
  for (const p of prep) {
    const n = allocCount.get(p.parcel.id) ?? 0;
    if (n === 0) errs.push(`${p.parcel.id} 未分配舱位`);
    else if (n > 1) errs.push(`${p.parcel.id} 有 ${n} 条分配`);
  }
  for (const a of plan.allocations) {
    const p = byId.get(a.parcelId);
    if (!p) { errs.push(`未知票货 ${a.parcelId}`); continue; }
    if (!a.tanks.length) errs.push(`${a.parcelId} 舱组为空`);
    if (!(Number.isFinite(a.fillRatio) && a.fillRatio > 0)) errs.push(`${a.parcelId} 装载率无效`);
    else if (a.fillRatio > p.ll + 1e-9) errs.push(`${a.parcelId} 装载率 ${(a.fillRatio * 100).toFixed(1)}% 超过许可 ${(p.ll * 100).toFixed(1)}%`);
    const cap = a.tanks.reduce((s, t) => s + (capOf.get(t) ?? 0), 0);
    if (p.volume > p.ll * cap + 1e-6) errs.push(`${a.parcelId} 超装载率`);
    const expectedMt = plan.intake?.[a.parcelId] ?? p.parcel.quantityMt;
    const actualMt = cap * a.fillRatio * p.parcel.density;
    if (Number.isFinite(expectedMt) && Math.abs(actualMt - expectedMt) > Math.max(1, expectedMt * 0.005))
      errs.push(`${a.parcelId} 舱内吨数 ${actualMt.toFixed(1)} 与应装 ${expectedMt.toFixed(1)} 不符`);
    for (const t of a.tanks) {
      if (!p.usableTanks.has(t)) errs.push(`${a.parcelId} 占用不可用舱 ${t}`);
      if (occ.has(t)) errs.push(`舱 ${t} 重复占用`);
      occ.set(t, a.parcelId);
    }
  }
  for (const [t, pid] of Array.from(occ)) for (const n of Array.from(adj.get(t) ?? [])) {
    const o = occ.get(n);
    if (o && o !== pid && !pair.ok[pid][o]) errs.push(`${t}(${pid}) 与 ${n}(${o}) 相邻但不允许`);
  }
  const callById = new Map(voyage.calls.map(call => [call.id, call]));
  for (const stage of simulateStages(ship, voyage, plan.allocations, false)) {
    const call = callById.get(stage.callId);
    const label = call?.port || stage.callId;
    if (stageDraftExceeded(stage)) {
      if ((stage.arrival?.draftMargin ?? 0) < 0)
        errs.push(`${label} 到港吃水超限`);
      if ((stage.floating?.draftMargin ?? 0) < 0)
        errs.push(`${label} 离港吃水超限`);
    }
    if (stage.arrival?.stabilityPass === false) errs.push(`${label} 到港稳性不通过`);
    if (stage.floating?.stabilityPass === false) errs.push(`${label} 离港稳性不通过`);
    const floating = stage.floating;
    const rule = floating?.ballastRule;
    if (!floating || rule?.dmMin == null) continue;
    if (floating.draftMid < rule.dmMin)
      errs.push(`${label} 离港 dm 不足`);
    if (rule.draftFwdMin != null && floating.draftFwd < rule.draftFwdMin)
      errs.push(`${label} 离港艏吃水不足`);
    if (!propellerImmersion(floating).pass)
      errs.push(`${label} 离港螺旋桨未全浸`);
    if (floating.trim < rule.trimMin || floating.trim > rule.trimMax)
      errs.push(`${label} 离港纵倾超出压载态窗口`);
  }
  return errs;
}
