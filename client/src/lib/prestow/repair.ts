/**
 * 无法配载时的修改建议(可行性修复)。
 *
 * 思路来自数学规划里的「最小松弛」:给每票货的吨数加松弛量,在保证舱位/相容/隔离/吃水
 * 全部可行的前提下,让被削减的吨数(加上整票删除的惩罚)最小。引擎是组合枚举而非线性
 * 模型,所以用「贪心修改 → 真实复核」逼近:每一步选「每省一舱代价最小」的修改,
 * 每步之后用真实引擎(枚举预算 300 000 步、找到第一个可行方案即止)复核,
 * 只有复核通过的组合才会给出。
 *
 * 候选算子:
 *  - reduce:把某票货减到 k 舱能装下的上限(k = 当前最少舱数 − 1);
 *  - drop:整票删除(带惩罚,默认排在减量之后);
 *  - draft:把最重的货改为「尽量多」意向,由意向求解器按到港吃水求上限,再转回固定吨数。
 *
 * 设计文档:docs/research/2026-09-06-infeasible-plan-repair.md
 */
import {
  buildPairOk,
  candidateGroups,
  prepareParcel,
  prepareParcels,
  solvePrestow,
  type PreparedParcel, planFeasible } from "./engine";
import { solveIntake } from "./intake";
import type {
  Diagnosis,
  Parcel,
  RepairChange,
  RepairProposal,
  RepairReport,
  StowShip,
  StowVoyage,
} from "./types";

export interface RepairOptions {
  /** 最多返回几个方案(默认 3)。 */
  maxProposals?: number;
  /** 总时间预算,毫秒(默认 8000);超时后返回已找到的方案。 */
  deadlineMs?: number;
  /** 复核枚举预算(默认 300 000 步)。 */
  verifyLimit?: number;
  /** 是否允许用意向求解器做吃水修复(耗时,默认 true)。 */
  allowIntake?: boolean;
}

const ROUND_MT = 10;
const MAX_GREEDY_STEPS = 10;

/** 贪心策略:整票删除的惩罚吨数,以及相容性冲突的权重。 */
interface Policy { name: "reduce-first" | "drop-friendly" | "fewest-changes"; dropPenaltyMt: number; degreeWeight: number; reduceMultiplier?: number }
const POLICIES: Policy[] = [
  { name: "reduce-first", dropPenaltyMt: 1500, degreeWeight: 0 },
  { name: "drop-friendly", dropPenaltyMt: 0, degreeWeight: 0 },
  // 尽量少动几票:减量代价放大,整票删除无惩罚 → 给出「删 1–2 票、其余不动」的备选
  { name: "fewest-changes", dropPenaltyMt: 0, degreeWeight: 0, reduceMultiplier: 4 },
];

const isVariable = (parcel: Parcel) => parcel.intake?.mode != null && parcel.intake.mode !== "fixed";

function roundDown(value: number): number {
  return Math.floor(value / ROUND_MT) * ROUND_MT;
}

function minTanks(ship: StowShip, p: PreparedParcel): number {
  const groups = candidateGroups(p, ship, Infinity);
  if (groups.length) return groups.reduce((min, g) => Math.min(min, g.tanks.length), Infinity);
  const capMax = Math.max(0, ...ship.tanks.filter(t => p.usableTanks.has(t.id)).map(t => t.cap100));
  return capMax > 0 ? Math.max(1, Math.ceil(p.volume / (p.ll * capMax))) : Infinity;
}

/** k 个最大可用舱能装的最大吨数。 */
function maxQuantityInTanks(ship: StowShip, p: PreparedParcel, k: number): number {
  const caps = ship.tanks.filter(t => p.usableTanks.has(t.id)).map(t => t.cap100).sort((a, b) => b - a);
  if (caps.length < k || k < 1) return 0;
  const cap = caps.slice(0, k).reduce((sum, c) => sum + c, 0);
  return roundDown(cap * p.ll * p.parcel.density);
}

export function applyRepairChanges(voyage: StowVoyage, changes: RepairChange[]): StowVoyage {
  const byId = new Map(changes.map(c => [c.parcelId, c]));
  return {
    ...voyage,
    parcels: voyage.parcels
      .filter(parcel => byId.get(parcel.id)?.kind !== "drop")
      .map(parcel => {
        const change = byId.get(parcel.id);
        return change && change.kind === "reduce"
          ? { ...parcel, quantityMt: change.toMt, intake: { mode: "fixed" as const } }
          : parcel;
      }),
  };
}

/** 同一票货多次减量只保留最终值;删除覆盖减量。 */
function mergeChanges(original: StowVoyage, changes: RepairChange[]): RepairChange[] {
  const byId = new Map<string, RepairChange>();
  for (const change of changes) {
    const first = original.parcels.find(p => p.id === change.parcelId);
    if (!first) continue;
    byId.set(change.parcelId, { ...change, fromMt: first.quantityMt });
  }
  return Array.from(byId.values());
}

function costOf(changes: RepairChange[], dropPenaltyMt = 1500): number {
  return changes.reduce((sum, c) => sum + (c.fromMt - c.toMt) + (c.kind === "drop" ? dropPenaltyMt : 0), 0);
}

function describe(changes: RepairChange[], totalMt: number): { title: string; message: string } {
  const removed = changes.reduce((sum, c) => sum + c.fromMt - c.toMt, 0);
  const drops = changes.filter(c => c.kind === "drop").length;
  const reduces = changes.length - drops;
  const parts: string[] = [];
  if (reduces) parts.push(`减少 ${reduces} 票吨数`);
  if (drops) parts.push(`删除 ${drops} 票`);
  const pct = totalMt > 0 ? (removed / totalMt) * 100 : 0;
  return {
    title: `${parts.join("、")} · 共 −${Math.round(removed).toLocaleString("en-US")} t`,
    message: `比原计划少装 ${Math.round(removed).toLocaleString("en-US")} t(${pct.toFixed(1)}%),其余货票与港序不变`,
  };
}

/** 「已复核可行」= 修改后的航次至少有一个方案通过吃水、稳性、油水与强度校核(与列表默认展示同口径)。 */
function verify(ship: StowShip, voyage: StowVoyage, limit: number): boolean {
  if (!voyage.parcels.length) return false;
  const result = solvePrestow(ship, voyage, { limit, maxPlans: 3 }, undefined, 3, false);
  return result.status !== "invalid" && result.plans.some(planFeasible);
}

/** 当前航次上每票货的下一步修改(减一舱 / 删除)及其代价。 */
function nextSteps(ship: StowShip, voyage: StowVoyage, policy: Policy, degree: Map<string, number>): { change: RepairChange; score: number }[] {
  const steps: { change: RepairChange; score: number }[] = [];
  for (const parcel of voyage.parcels) {
    const p = prepareParcel(ship, parcel);
    const kMin = minTanks(ship, p);
    const weight = 1 + policy.degreeWeight * (degree.get(parcel.id) ?? 0);
    if (Number.isFinite(kMin) && kMin >= 2) {
      const to = maxQuantityInTanks(ship, p, kMin - 1);
      if (to > 0 && to < parcel.quantityMt) steps.push({
        change: { parcelId: parcel.id, display: parcel.display, kind: "reduce", fromMt: parcel.quantityMt, toMt: to, note: `从 ${kMin} 舱减到 ${kMin - 1} 舱` },
        score: (parcel.quantityMt - to) * (policy.reduceMultiplier ?? 1) / weight,
      });
    }
    if (voyage.parcels.length > 1) steps.push({
      change: { parcelId: parcel.id, display: parcel.display, kind: "drop", fromMt: parcel.quantityMt, toMt: 0, note: "整票删除" },
      score: (parcel.quantityMt + policy.dropPenaltyMt) / (Math.max(1, Number.isFinite(kMin) ? kMin : 1) * weight),
    });
  }
  return steps.sort((a, b) => a.score - b.score);
}

export function proposeRepairs(
  ship: StowShip,
  voyage: StowVoyage,
  diagnosis?: Diagnosis,
  options: RepairOptions = {},
): RepairReport {
  const started = Date.now();
  const maxProposals = options.maxProposals ?? 3;
  const deadline = started + (options.deadlineMs ?? 8000);
  const verifyLimit = options.verifyLimit ?? 300_000;
  const allowIntake = options.allowIntake ?? true;
  let tried = 0;
  const done = (proposals: RepairProposal[], note?: string): RepairReport => ({
    proposals, tried, elapsedMs: Date.now() - started, note,
  });

  if (voyage.parcels.some(isVariable)) {
    return done([], "含「尽量多」等意向的航次已由引擎按上限求解,暂不生成吨数修改建议");
  }
  const prep = prepareParcels(ship, voyage);
  if ("errors" in prep) return done([], "先修正输入错误再看修改建议");
  const totalMt = voyage.parcels.reduce((sum, p) => sum + p.quantityMt, 0);
  const codes = new Set(diagnosis?.reasons.map(r => r.code) ?? []);
  const pair = buildPairOk(voyage.parcels);
  const degree = new Map(voyage.parcels.map(p => [p.id, voyage.parcels.filter(o => o.id !== p.id && !pair.ok[p.id]?.[o.id]).length]));
  const compatDriven = codes.has("compat") || codes.has("thermal");

  const seen = new Set<string>();
  const feasible: RepairProposal[] = [];
  const keyOf = (changes: RepairChange[]) => changes.map(c => `${c.parcelId}:${c.kind}:${c.toMt}`).sort().join("|");
  const record = (changes: RepairChange[], origin: RepairProposal["origin"], modified: StowVoyage) => {
    const merged = mergeChanges(voyage, changes);
    const key = keyOf(merged);
    if (seen.has(key)) return;
    seen.add(key);
    const { title, message } = describe(merged, totalMt);
    feasible.push({
      id: key, title, origin, changes: merged,
      removedMt: merged.reduce((sum, c) => sum + c.fromMt - c.toMt, 0),
      cost: costOf(merged), message, voyage: modified,
    });
  };
  const check = (changes: RepairChange[], origin: RepairProposal["origin"]): boolean => {
    const merged = mergeChanges(voyage, changes);
    const key = keyOf(merged);
    if (seen.has(key)) return feasible.some(p => p.id === key);
    const modified = applyRepairChanges(voyage, merged);
    tried++;
    if (!verify(ship, modified, verifyLimit)) { seen.add(key); return false; }
    record(merged, origin, modified);
    return true;
  };

  // ---- 吃水修复:最重的货改「尽量多」,由意向求解器按到港吃水求上限 ----
  if (allowIntake && (codes.has("draft") || (diagnosis?.stats.rejectedByDraft ?? 0) > 0)) {
    const heaviest = [...voyage.parcels].sort((a, b) => b.quantityMt - a.quantityMt).slice(0, 2);
    for (const target of heaviest) {
      if (Date.now() > deadline) break;
      const intakeVoyage: StowVoyage = {
        ...voyage,
        parcels: voyage.parcels.map(p => p.id === target.id ? { ...p, intake: { mode: "priority" as const, priority: 1 } } : p),
      };
      tried++;
      const result = solveIntake(ship, intakeVoyage, { fastOnly: true });
      if (result.status === "invalid" || !result.plans.length) continue;
      const summary = result.intakeSummary?.find(item => item.parcelId === target.id);
      const to = summary ? roundDown(summary.quantityMt) : 0;
      if (!(to > 0) || to >= target.quantityMt) continue;
      const change: RepairChange = {
        parcelId: target.id, display: target.display, kind: "reduce", fromMt: target.quantityMt, toMt: to,
        note: summary?.limitedBy ? `按${summary.limitedBy.replace(/^受限于\s*/, "受限港 ")}求得上限(快速估算)` : "按到港吃水求得上限(快速估算)",
      };
      // 意向求解给的是估算上限;最终固定吨数的航次必须再走同一复核
      check([change], "draft");
    }
  }

  // ---- 单步修改:某一票减一舱 / 删一票就够了的情况 ----
  const singleSteps = nextSteps(ship, voyage, { name: "reduce-first", dropPenaltyMt: 1500, degreeWeight: compatDriven ? 1 : 0 }, degree);
  for (const step of singleSteps) {
    if (Date.now() > deadline) break;
    check([step.change], step.change.kind === "drop" ? "drop" : "reduce");
    if (feasible.length >= maxProposals) break;
  }

  // ---- 贪心多步:每步选每省一舱代价最小的修改,直到复核可行 ----
  for (const base of POLICIES) {
    if (Date.now() > deadline) break;
    const policy: Policy = { ...base, degreeWeight: compatDriven ? 1 : 0 };
    let current = voyage;
    const applied: RepairChange[] = [];
    for (let step = 0; step < MAX_GREEDY_STEPS && Date.now() < deadline; step++) {
      const candidates = nextSteps(ship, current, policy, degree);
      if (!candidates.length) break;
      const chosen = candidates[0].change;
      applied.push(chosen);
      current = applyRepairChanges(current, [chosen]);
      if (applied.length === 1 && seen.has(keyOf(mergeChanges(voyage, applied)))) continue;
      if (check(applied, "combo")) break;
    }
  }

  feasible.sort((a, b) => a.cost - b.cost || a.changes.length - b.changes.length);
  const proposals = feasible.slice(0, maxProposals).map((p, index) => ({ ...p, title: `方案 ${String.fromCharCode(65 + index)} · ${p.title}` }));
  const note = proposals.length
    ? undefined
    : Date.now() > deadline
      ? "时间预算内未找到只改吨数就可行的方案;可先手工减少 1–2 票再试"
      : "未找到只改吨数就可行的方案;请减少票数、调整港序或核对相容族后重试";
  return done(proposals, note);
}
