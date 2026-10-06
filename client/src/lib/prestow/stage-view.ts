import type { PreciseFloating, PreciseStage } from "./precise";
import type { Allocation, StageFloating, StageState, StowPlan, StowVoyage } from "./types";

/** 现有舱图使用离港状态；精算数值与初筛判定分别保留来源。 */
export interface StageViewData {
  planKey: string;
  callId: string;
  phase: "departure";
  calculationSource: "estimate" | "precise";
  stage: StageState;
  precise?: PreciseFloating;
}

function mergeFloating(estimated: StageFloating | undefined, calculated: PreciseFloating | undefined): StageFloating | undefined {
  if (!estimated || !calculated) return estimated;
  return {
    ...estimated,
    displacement: calculated.displacement,
    draftMid: calculated.draftMid,
    draftAft: calculated.draftAft,
    draftFwd: calculated.draftFwd,
    trim: calculated.trim,
    trimRelaxed: calculated.trimRelaxed,
    trimReliefM: calculated.trimReliefM,
    waterDensity: calculated.waterDensity,
    maxDraftM: calculated.maxDraftM,
    draftMargin: calculated.draftMargin,
    limitSource: calculated.limitSource,
    zone: calculated.zone,
    ballastMt: calculated.ballastMt,
    ballastTanks: calculated.ballastTanks,
    ballastRule: calculated.ballastRule,
    gmCorrected: calculated.gmCorrected,
    sfPct: calculated.sfPct,
    bmPct: calculated.bmPct,
    approx: false,
  };
}

export function planStageViews(plan: StowPlan, preciseByCall: Record<string, PreciseStage>): Record<string, StageViewData> {
  return Object.fromEntries(plan.stages.map(stage => {
    const calculated = preciseByCall[stage.callId];
    return [stage.callId, {
      planKey: plan.key,
      callId: stage.callId,
      phase: "departure",
      calculationSource: calculated?.floating ? "precise" : "estimate",
      stage: {
        ...stage,
        floating: mergeFloating(stage.floating, calculated?.floating),
        arrival: mergeFloating(stage.arrival, calculated?.arrival),
      },
      precise: calculated?.floating,
    } satisfies StageViewData];
  }));
}

/** 装港含、卸港不含：同港卸完再装属于顺序复用。 */
export function allocationHistory(allocations: Allocation[], voyage: StowVoyage) {
  const callSeq = new Map(voyage.calls.map(call => [call.id, call.seq]));
  const parcels = new Map(voyage.parcels.map(parcel => [parcel.id, parcel]));
  const periods = allocations.flatMap(allocation => {
    const parcel = parcels.get(allocation.parcelId);
    const start = parcel && callSeq.get(parcel.loadCallId);
    const end = parcel && callSeq.get(parcel.dischargeCallId);
    return start == null || end == null ? [] : [{ allocation, start, end }];
  }).sort((a, b) => a.start - b.start);
  return {
    ordered: periods.map(period => period.allocation),
    conflict: periods.some((period, index) => periods.slice(index + 1).some(other =>
      Math.max(period.start, other.start) < Math.min(period.end, other.end),
    )),
  };
}
