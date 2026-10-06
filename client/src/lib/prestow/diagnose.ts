import { FL_COEFF } from "../fl-engine";
import { evaluateCompat } from "../uscg-verdict";
import { DEFAULT_LIMIT, search, simulateStages, thermalOk, type PairMatrix, type PreparedParcel, type SearchOut, type TankGroup } from "./engine";
import type { Diagnosis, InfeasibilityCode, InfeasibilityReason, StowShip, StowVoyage } from "./types";

const SUGGESTIONS: Record<InfeasibilityCode, string[]> = {
  "no-candidate": ["减少票数或合并同货分票", "降低单票吨数"],
  "tank-demand": ["减少票数或合并同货分票", "降低单票吨数"],
  "capacity-relaxed": ["减少票数或合并同货分票", "降低单票吨数"],
  compat: ["核对货物 USCG 相容族,或把不相容货物拆到不同装港/卸港的航次"],
  thermal: ["降低加温温度或取消加温,或减少与之相邻的货票"],
  draft: ["先核对受限港吃水限值和水密度的输入与来源；已确认的港限保持不变，可减少货量，或将重货的装载意向改为『优先』后重新求解"],
  "search-budget": ["先减少 1–2 票货试运行,确认瓶颈货票"],
};

export function diagnoseInfeasibility(input: {
  ship: StowShip; voyage: StowVoyage; prepared: PreparedParcel[]; pair: PairMatrix; adj: Map<string, Set<string>>;
  groupsFor: (p: PreparedParcel, maxSingles: number) => TankGroup[];
  found: Pick<SearchOut, "rejectedByDraft" | "truncatedBy" | "firstRejected">;
  limit?: number;
}): Diagnosis {
  const { ship, voyage, prepared, pair, adj, groupsFor, found } = input;
  const reasons: InfeasibilityReason[] = [];
  const groups = prepared.map(p => groupsFor(p, Infinity));
  let tanksNeededMin = 0;
  prepared.forEach((p, index) => {
    const { parcel, volume, ll, usableTanks } = p;
    const candidates = groups[index];
    const capMax = Math.max(0, ...ship.tanks.filter(t => usableTanks.has(t.id)).map(t => t.cap100))
      || Math.max(0, ...ship.tanks.map(t => t.cap100));
    tanksNeededMin += candidates.length
      ? candidates.reduce((min, g) => Math.min(min, g.tanks.length), Infinity)
      : Math.max(1, Math.ceil(volume / (ll * capMax)));
    if (!candidates.length) reasons.push({
      code: "no-candidate", severity: "blocker", parcels: [parcel.display],
      message: parcel.heating.enabled && !usableTanks.size
        ? `${parcel.display} 加温 ${parcel.heating.carriageTempC} °C 超过所有货舱许可温度`
        : `${parcel.display} ${parcel.quantityMt.toFixed(0)} t(体积 ${volume.toFixed(0)} m³)在可用舱里没有任何装得下的舱组合`,
    });
  });
  const N = prepared.length, T = ship.tanks.length;
  // 对所有货票都装不下"任何一舱份"的小舱(如 SLOP)不算可用舱
  const smallest = prepared.reduce((min, p) => Math.min(min, p.volume / (p.ll * Math.max(1, Math.ceil(p.volume / (p.ll * Math.max(...ship.tanks.map(t => t.cap100))))))), Infinity);
  const tooSmall = ship.tanks.filter(t => t.cap100 * FL_COEFF < smallest);
  const usable = T - tooSmall.length;
  // 仅作说明:小舱仍可与大舱组成多舱组,所以判定阈值仍用总舱数 T
  if (tanksNeededMin > T) reasons.push({
    code: "tank-demand", severity: "blocker",
    message: `${N} 票货按最少舱数合计需要 ${tanksNeededMin} 舱,船只有 ${T} 舱${tooSmall.length ? `(其中 ${tooSmall.map(t => t.id).join("、")} 容量 ${Math.round(tooSmall[0].cap100)} m³ 装不下任何一票的最小舱份,实际可用 ${usable} 舱)` : ""}`,
  });

  const relaxedPair: PairMatrix = {
    ok: Object.fromEntries(prepared.map(a => [a.parcel.id, Object.fromEntries(prepared.map(b => [b.parcel.id, true]))])),
    conflicts: [],
  };
  // Only the diagnostic witness search prefers tight capacity fits, so small/slop
  // tanks are not left unusable at the tail. Production enumeration is unchanged.
  const capacity = new Map(ship.tanks.map(t => [t.id, t.cap100]));
  const relaxedGroups = groups.map(gs => gs.map(g => ({ g, cap: g.tanks.reduce((sum, id) => sum + capacity.get(id)!, 0) }))
    .sort((a, b) => a.g.tanks.length - b.g.tanks.length || a.cap - b.cap).map(({ g }) => g));
  const relaxed = search(prepared, relaxedGroups, relaxedPair, adj, 300_000, 1, () => true, new Set());
  // maxPlans=1 marks a successful witness as truncated; check the witness first.
  const relaxedFeasible = relaxed.allocs.length > 0 ? true : relaxed.truncatedBy ? null : false;
  if (relaxedFeasible === false) reasons.push({
    code: "capacity-relaxed", severity: "blocker",
    message: `即使不考虑相容性与隔离,舱容组合也装不下这 ${N} 票货(合计 ${prepared.reduce((sum, p) => sum + p.volume, 0).toFixed(0)} m³ / 可装 ${(ship.tanks.reduce((sum, t) => sum + t.cap100, 0) * FL_COEFF).toFixed(0)} m³,舱数需求 ${tanksNeededMin}/${T})`,
  });

  const parcels = prepared.map(p => p.parcel);
  const thermalNeighbours = new Map<string, string[]>();
  let thermalPairs = 0;
  for (let i = 0; i < parcels.length; i++) for (let j = i + 1; j < parcels.length; j++) {
    const a = parcels[i], b = parcels[j];
    const compat = evaluateCompat(a.group, b.group, a.name, b.name);
    if (!compat.known || !compat.isCompatible || (thermalOk(a, b) && thermalOk(b, a))) continue;
    thermalPairs++;
    for (const [hot, other] of [[a, b], [b, a]]) if (!thermalOk(hot, other)) {
      const neighbours = thermalNeighbours.get(hot.id) ?? [];
      neighbours.push(other.display);
      thermalNeighbours.set(hot.id, neighbours);
    }
  }
  // A draft-rejected complete allocation already satisfies compatibility/isolation.
  if (relaxedFeasible && found.rejectedByDraft === 0 && pair.conflicts.length > 0) {
    const ranked = parcels.map(parcel => ({ parcel, others: parcels.filter(other => other.id !== parcel.id && !pair.ok[parcel.id]?.[other.id]) }))
      .sort((a, b) => b.others.length - a.others.length);
    const top = ranked[0];
    reasons.push({
      code: "compat", severity: "likely", parcels: [top.parcel.display, ...top.others.slice(0, 3).map(p => p.display)],
      message: `相容性 / 相邻隔离无法满足:${top.parcel.display} 与 ${top.others.slice(0, 3).map(p => p.display).join("、")} 不能相邻(${pair.conflicts.length} 个不相容对,${N} 票货挤在 ${T} 舱里)`,
    });
    for (const [id, others] of Array.from(thermalNeighbours)) {
      const hot = parcels.find(p => p.id === id)!;
      if (hot.heating.enabled) reasons.push({
        code: "thermal", severity: "likely", parcels: [hot.display, ...others],
        message: `加温货 ${hot.display}(${hot.heating.carriageTempC} °C)因热隔离不能与 ${others.join("、")} 相邻`,
      });
    }
  }
  if (found.rejectedByDraft > 0) {
    let example = "";
    let target: InfeasibilityReason["target"];
    const stages = found.firstRejected ? simulateStages(ship, voyage, found.firstRejected, false) : [];
    for (const stage of stages) {
      for (const [phase, floating] of [["到港", stage.arrival], ["离港", stage.floating]] as const) {
        if (floating?.draftMargin == null || floating.draftMargin >= 0 || floating.maxDraftM == null) continue;
        const port = voyage.calls.find(c => c.id === stage.callId)?.port ?? stage.callId;
        target = { section: "calls", index: voyage.calls.findIndex(c => c.id === stage.callId), field: floating.limitSource === "zone" ? "loadLineZone" : "maxDraftM" };
        example = `,例如 ${port} ${phase} 吃水 ${Math.max(floating.draftAft, floating.draftFwd).toFixed(2)} m 超过限值 ${floating.maxDraftM.toFixed(1)} m`;
        if (floating.trimRelaxed) example += "(已按平吃水配平仍超限)";
        break;
      }
      if (example) break;
    }
    reasons.push({ code: "draft", severity: "likely", message: `找到 ${found.rejectedByDraft} 个舱位分配但全部因吃水超限剔除${example}`, target });
  }
  if (found.truncatedBy === "limit" && !reasons.length) reasons.push({
    code: "search-budget", severity: "hint", message: `枚举 ${input.limit ?? DEFAULT_LIMIT} 步未找到完整分配,约束可能过紧`,
  });
  const severityOrder = { blocker: 0, likely: 1, hint: 2 };
  reasons.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return {
    reasons, suggestions: Array.from(new Set(reasons.flatMap(r => SUGGESTIONS[r.code]))),
    stats: { parcels: N, tanksTotal: T, tanksNeededMin, conflictPairs: pair.conflicts.length, thermalPairs, relaxedFeasible, rejectedByDraft: found.rejectedByDraft, truncatedBy: found.truncatedBy },
  };
}
