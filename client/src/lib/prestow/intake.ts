import { zoneDraftLimit } from "./consumption";
import { FL_COEFF } from "../fl-engine";
import {
  buildAdjacency,
  buildAdvisories,
  buildPairOk,
  byTankId,
  candidateGroups,
  mirrorKey,
  prepareParcels,
  prepareParcel,
  simulateStages,
  solvePrestow,
  stageDraftExceeded,
  stageDraftMargin,
  type PreparedParcel,
  type TankGroup,
  type SearchOut,
} from "./engine";
import { diagnoseInfeasibility } from "./diagnose";
import { comparePlans, scorePlan } from "./rank";
import { preciseArrivalDraft } from "./precise";
import type {
  Allocation,
  EngineOptions,
  Parcel,
  PortCall,
  StageState,
  StageConsumables,
  StowPlan,
  StowResult,
  StowShip,
  StowVoyage,
} from "./types";

const ENUMERATION_PLANS = 300;
const SHRINK_CANDIDATES = 20;
const MAX_ZERO_SOLUTION_RETRIES = 6;
const EPSILON = 1e-6;

const isVariable = (parcel: Parcel) =>
  parcel.intake?.mode != null && parcel.intake.mode !== "fixed";
const minimumOf = (parcel: Parcel) => Math.max(0, parcel.intake?.minMt ?? 0);

/** Build the deterministic first-pass quantities described in design spec section 4. */
export function initialTargets(
  ship: StowShip,
  voyage: StowVoyage
): Record<string, number> {
  const variables = voyage.parcels.filter(isVariable);
  const fixedVolume = voyage.parcels
    .filter(parcel => !isVariable(parcel))
    .reduce(
      (sum, parcel) =>
        sum +
        (parcel.quantityMt > 0 && parcel.density > 0
          ? parcel.quantityMt / parcel.density
          : 0),
      0
    );
  let remainingVolume = Math.max(
    0,
    ship.tanks.reduce((sum, tank) => sum + tank.cap100, 0) * FL_COEFF -
      fixedVolume
  );
  const targets: Record<string, number> = {};

  const priorities = variables
    .filter(parcel => parcel.intake!.mode === "priority")
    .map((parcel, index) => ({ parcel, index }))
    .sort(
      (a, b) =>
        (a.parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER) -
          (b.parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index ||
        a.parcel.id.localeCompare(b.parcel.id)
    );
  for (const { parcel } of priorities) {
    const requested = parcel.intake?.maxMt ?? remainingVolume * parcel.density;
    const target = Math.max(minimumOf(parcel), requested);
    targets[parcel.id] = target;
    remainingVolume = Math.max(0, remainingVolume - target / parcel.density);
  }

  for (const parcel of variables.filter(
    item => item.intake!.mode === "range"
  )) {
    const requested = parcel.intake?.maxMt ?? remainingVolume * parcel.density;
    const target = Math.max(minimumOf(parcel), requested);
    targets[parcel.id] = target;
    remainingVolume = Math.max(0, remainingVolume - target / parcel.density);
  }

  const ratios = variables.filter(parcel => parcel.intake!.mode === "ratio");
  const ratioVolumeTotal = ratios.reduce(
    (sum, parcel) =>
      sum + Math.max(0, parcel.intake?.ratio ?? 1) / parcel.density,
    0
  );
  for (const parcel of ratios) {
    const ratio = Math.max(0, parcel.intake?.ratio ?? 1);
    const requested =
      ratioVolumeTotal > 0 ? (remainingVolume * ratio) / ratioVolumeTotal : 0;
    const capped =
      parcel.intake?.maxMt == null
        ? requested
        : Math.min(requested, parcel.intake.maxMt);
    targets[parcel.id] = Math.max(minimumOf(parcel), capped);
  }

  return targets;
}

function materializeVoyage(
  voyage: StowVoyage,
  targets: Record<string, number>,
  ignoreDraft: boolean
): StowVoyage {
  return {
    ...voyage,
    calls: voyage.calls.map(call =>
      ignoreDraft ? { ...call, maxDraftM: undefined } : { ...call }
    ),
    parcels: voyage.parcels
      .filter(
        parcel => !isVariable(parcel) || (targets[parcel.id] ?? 0) > EPSILON
      )
      .map(parcel =>
        isVariable(parcel)
          ? {
              ...parcel,
              quantityMt: targets[parcel.id],
              intake: { mode: "fixed" as const },
            }
          : { ...parcel }
      ),
  };
}

function expandedVariableGroups(
  prepared: PreparedParcel,
  ship: StowShip
): TankGroup[] {
  const groups = candidateGroups(prepared, ship, Infinity);
  const usable = ship.tanks.filter(tank => prepared.usableTanks.has(tank.id));
  const usableIds = new Set(usable.map(tank => tank.id));
  const paired = usable
    .filter(tank => tank.side === "P" && usableIds.has(`${tank.station}S`))
    .flatMap(tank => [`${tank.station}P`, `${tank.station}S`])
    .sort(byTankId);
  const all = usable.map(tank => tank.id).sort(byTankId);
  const seen = new Set(groups.map(group => group.tanks.join("+")));

  for (const tanks of [paired, all]) {
    const key = tanks.join("+");
    if (!tanks.length || seen.has(key)) continue;
    const capacity = tanks.reduce(
      (sum, tankId) =>
        sum + ship.tanks.find(tank => tank.id === tankId)!.cap100,
      0
    );
    const selected = new Set(tanks);
    const singles = tanks.filter(tankId => {
      const mate = tankId.endsWith("P")
        ? `${tankId.slice(0, -1)}S`
        : `${tankId.slice(0, -1)}P`;
      return !selected.has(mate);
    }).length;
    groups.push({
      tanks,
      singles,
      fillRatio: Math.min(prepared.volume / capacity, FL_COEFF),
    });
    seen.add(key);
  }
  return groups;
}

function variableGroupOverrides(
  ship: StowShip,
  voyage: StowVoyage,
  variableIds: Set<string>
): ReadonlyMap<string, TankGroup[]> | undefined {
  const prepared = prepareParcels(ship, voyage);
  if ("errors" in prepared) return undefined;
  return new Map(
    prepared
      .filter(item => variableIds.has(item.parcel.id))
      .map(item => [item.parcel.id, expandedVariableGroups(item, ship)])
  );
}

function planFromAllocations(
  ship: StowShip,
  voyage: StowVoyage,
  allocations: Allocation[],
  intake: Record<string, number>,
  includeStrength = true,
): StowPlan {
  const stages = simulateStages(ship, voyage, allocations, includeStrength);
  const advisories = buildAdvisories(ship, voyage, allocations, stages);
  const limitedStages = stages.filter(
    stage => stageDraftMargin(stage) != null
  );
  const firstExceeded = limitedStages.find(stageDraftExceeded);
  const bindingStage =
    firstExceeded ??
    limitedStages.reduce<StageState | undefined>(
      (best, stage) =>
        !best || stageDraftMargin(stage)! < stageDraftMargin(best)!
          ? stage
          : best,
      undefined
    );
  const plan: StowPlan = {
    key: mirrorKey(allocations),
    allocations,
    stages,
    advisories,
    score: {
      tanksUsed: 0,
      unpairedTanks: 0,
      maxHeelMoment: 0,
      maxLcgShift: 0,
      advisoryCount: 0,
      minGm: 0,
      maxBmPct: 0,
    },
    draftOk: firstExceeded == null,
    stabilityOk: stages.every(stage => stage.floating?.stabilityPass !== false && stage.arrival?.stabilityPass !== false),
    consumablesOk: stages.every(stage => !stage.consumables?.warnings.some(warning => /燃油不足以到港|淡水不足/.test(warning))),
    strengthOk: stages.every(stage => stage.floating?.strengthPass !== false && stage.arrival?.strengthPass !== false),
    strengthChecked: includeStrength,
    bindingCallId: bindingStage?.callId,
    intake: { ...intake },
  };
  plan.score = scorePlan(plan, ship);
  return plan;
}

function allocationQuantity(
  ship: StowShip,
  parcel: Parcel,
  allocation: Allocation | undefined
): number {
  if (!allocation) return 0;
  const capacity = allocation.tanks.reduce(
    (sum, tankId) =>
      sum + (ship.tanks.find(tank => tank.id === tankId)?.cap100 ?? 0),
    0
  );
  return capacity * allocation.fillRatio * parcel.density;
}

type PreciseMarginEvaluator = (
  stage: StageState,
  call: PortCall,
  consumables?: StageConsumables["arrival"]
) => number | undefined;

function preciseMinimumMargin(
  voyage: StowVoyage,
  plan: StowPlan,
  evaluate: PreciseMarginEvaluator
): { margin: number | undefined; call?: PortCall; phase?: "到港" | "离港" } {
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);
  const stagesByCall = new Map(plan.stages.map(stage => [stage.callId, stage]));
  let minimum:
    | { margin: number; call: PortCall; phase: "到港" | "离港" }
    | undefined;
  const consider = (
    margin: number | undefined,
    call: PortCall,
    phase: "到港" | "离港"
  ) => {
    if (margin == null || !Number.isFinite(margin)) return;
    if (!minimum || margin < minimum.margin)
      minimum = { margin, call, phase };
  };

  // 只精算快速引擎裕量 < 0.8 m 的阶段(其余阶段不可能成为受限点),每次精算 ≈ 1 s;
  // 若没有任何阶段接近限值,则退回全量精算
  const NEAR_LIMIT = 0.8;
  const near = (margin: number | undefined) => margin != null && margin < NEAR_LIMIT;
  const anyNear = plan.stages.some(stage => near(stage.floating?.draftMargin) || near(stage.arrival?.draftMargin));
  calls.forEach((call, index) => {
    const stage = stagesByCall.get(call.id);
    if (!stage) return;
    if (!anyNear || near(stage.floating?.draftMargin))
      consider(evaluate(stage, call, stage.consumables?.departure), call, "离港");
    if (!stage.arrival || index === 0) return;
    if (anyNear && !near(stage.arrival.draftMargin)) return;
    const previousStage = stagesByCall.get(calls[index - 1].id);
    if (previousStage)
      consider(evaluate(previousStage, call, stage.consumables?.arrival), call, "到港");
  });
  return minimum ?? { margin: undefined };
}

function preciseCallReason(
  ship: StowShip,
  call: PortCall,
  phase: "到港" | "离港"
): string {
  const portLimit = call.maxDraftM;
  const shipLimit = ship.maxDraftM == null ? undefined : zoneDraftLimit(ship.maxDraftM, call.loadLineZone);
  const structural =
    shipLimit != null && (portLimit == null || shipLimit < portLimit);
  const maxDraftM = structural ? shipLimit : portLimit;
  if (maxDraftM == null) return "吃水(精算)";
  const structureLabel = call.loadLineZone === "winter" ? "(冬季载重线)" : call.loadLineZone === "tropical" ? "(热带载重线)" : "(结构吃水)";
  return `受限于 ${call.port}${structural ? structureLabel : ""} ${phase}吃水 ${maxDraftM.toFixed(2)} m(ρ ${(call.waterDensity ?? 1.025).toFixed(3)})(精算)`;
}

/**
 * 精算收缩的分层顺序(与快速收缩 shrinkForDraft 一致):
 * 优先级票从最不重要开始逐层减,再减比例票(同比例),最后减区间票;每票不低于其最低吨数。
 */
function refineTiers(variables: Parcel[]): Parcel[][] {
  const priorities = variables.filter(parcel => parcel.intake!.mode === "priority");
  const levels = Array.from(new Set(priorities.map(parcel => parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER)))
    .sort((a, b) => b - a);
  const tiers = levels.map(level => priorities.filter(parcel => (parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER) === level));
  const ratios = variables.filter(parcel => parcel.intake!.mode === "ratio");
  const ranges = variables.filter(parcel => parcel.intake!.mode === "range");
  if (ratios.length) tiers.push(ratios);
  if (ranges.length) tiers.push(ranges);
  return tiers;
}

/** Keep tank groups fixed and refine variable fill ratios against precise draft. */
export function refineIntakePrecise(
  ship: StowShip,
  voyage: StowVoyage,
  plan: StowPlan,
  evaluate: PreciseMarginEvaluator
): {
  plan: StowPlan;
  intake: Record<string, number>;
  limitedBy: Record<string, string>;
} {
  const variables = voyage.parcels.filter(isVariable);
  const capacityOf = (tanks: string[]) =>
    tanks.reduce((sum, tankId) => sum + (ship.tanks.find(tank => tank.id === tankId)?.cap100 ?? 0), 0);
  const baseRatio = new Map(variables.map(parcel => [parcel.id, plan.allocations.find(a => a.parcelId === parcel.id)?.fillRatio ?? 0]));
  // 每票的下限装载率:由最低吨数换算(不能被统一缩放突破)
  const floorRatio = new Map(variables.map(parcel => {
    const allocation = plan.allocations.find(a => a.parcelId === parcel.id);
    const capacity = allocation ? capacityOf(allocation.tanks) : 0;
    const minRatio = capacity > 0 ? minimumOf(parcel) / (capacity * parcel.density) : 0;
    return [parcel.id, Math.min(baseRatio.get(parcel.id) ?? 0, minRatio)];
  }));
  const scaledPlan = (scales: Map<string, number>, includeStrength: boolean) => {
    const allocations = plan.allocations.map(allocation => {
      const scale = scales.get(allocation.parcelId);
      return {
        ...allocation,
        tanks: [...allocation.tanks],
        fillRatio: scale == null
          ? allocation.fillRatio
          : Math.max(floorRatio.get(allocation.parcelId) ?? 0, allocation.fillRatio * scale),
      };
    });
    const intake = Object.fromEntries(
      variables.map(parcel => [
        parcel.id,
        allocationQuantity(ship, parcel, allocations.find(allocation => allocation.parcelId === parcel.id)),
      ])
    );
    return { plan: planFromAllocations(ship, voyage, allocations, intake, includeStrength), intake };
  };
  const unitScales = () => new Map(variables.map(parcel => [parcel.id, 1]));

  const initial = preciseMinimumMargin(voyage, plan, evaluate);
  if (initial.margin == null || initial.margin >= -0.005) {
    const unchanged = scaledPlan(unitScales(), true);
    unchanged.plan.draftOk = true;
    unchanged.plan.bindingCallId = initial.call?.id;
    return { plan: unchanged.plan, intake: unchanged.intake, limitedBy: {} };
  }

  // 逐层割线法:吃水裕量对该层缩放系数近似线性(TPC);一层减到下限仍超限才动下一层
  const scales = unitScales();
  const reduced = new Set<string>();
  let feasible: ReturnType<typeof scaledPlan> | undefined;
  let m0 = initial.margin;
  for (const tier of refineTiers(variables)) {
    const tierMin = Math.max(0, ...tier.map(parcel => {
      const base = baseRatio.get(parcel.id) ?? 0;
      return base > 0 ? (floorRatio.get(parcel.id) ?? 0) / base : 1;
    }));
    if (tierMin >= 1 - 1e-6) continue;
    const withTier = (scale: number) => {
      const next = new Map(scales);
      for (const parcel of tier) next.set(parcel.id, scale);
      return next;
    };
    const clamp = (scale: number) => Math.min(1, Math.max(tierMin, scale));
    let s0 = 1;
    let s1 = clamp(1 + m0 / 6); // 初值:满载 TPC 量级 ≈ 60 t/cm → 1 m ≈ 5% 变量票
    let atFloor: { margin: number; trial: ReturnType<typeof scaledPlan> } | undefined;
    for (let iteration = 0; iteration < 4; iteration++) {
      const trial = scaledPlan(withTier(s1), false);
      const m1 = preciseMinimumMargin(voyage, trial.plan, evaluate).margin ?? 0;
      if (s1 <= tierMin + 1e-9) atFloor = { margin: m1, trial };
      if (m1 >= -0.005) {
        feasible = trial;
        for (const parcel of tier) scales.set(parcel.id, s1);
        break;
      }
      const slope = (m1 - m0) / (s1 - s0);
      if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) break;
      const next = clamp(s1 - m1 / slope);
      if (Math.abs(next - s1) < 1e-4) break;
      s0 = s1; m0 = m1; s1 = next;
    }
    for (const parcel of tier) reduced.add(parcel.id);
    if (feasible) break;
    // 本层减到下限仍超限:固定在下限,继续下一层
    for (const parcel of tier) scales.set(parcel.id, tierMin);
    if (!atFloor) {
      const trial = scaledPlan(withTier(tierMin), false);
      atFloor = { margin: preciseMinimumMargin(voyage, trial.plan, evaluate).margin ?? 0, trial };
    }
    m0 = atFloor.margin;
    s0 = tierMin;
  }
  const best = feasible ?? scaledPlan(scales, false);

  const finalPlan = planFromAllocations(ship, voyage, best.plan.allocations, best.intake);
  const binding = preciseMinimumMargin(voyage, finalPlan, evaluate);
  finalPlan.draftOk = binding.margin == null || binding.margin >= -0.005;
  finalPlan.bindingCallId = binding.call?.id;
  // 独立守卫:任何票都不得低于最低吨数(即使精算仍超限也不能继续减)
  for (const parcel of variables) {
    if (best.intake[parcel.id] < minimumOf(parcel) - 0.5) finalPlan.draftOk = false;
  }
  const reason = binding.call && binding.phase
    ? preciseCallReason(ship, binding.call, binding.phase)
    : "吃水(精算)";
  return {
    plan: finalPlan,
    intake: { ...best.intake },
    limitedBy: Object.fromEntries(
      variables.filter(parcel => reduced.has(parcel.id)).map(parcel => [parcel.id, reason])
    ),
  };
}

function limitingDraft(stage: StageState): {
  phase: "到港" | "离港";
  floating: NonNullable<StageState["floating"]>;
} | undefined {
  const arrival = stage.arrival;
  const departure = stage.floating;
  if (
    arrival?.draftMargin != null &&
    (departure?.draftMargin == null || arrival.draftMargin <= departure.draftMargin)
  )
    return { phase: "到港", floating: arrival };
  return departure?.draftMargin == null
    ? undefined
    : { phase: "离港", floating: departure };
}

function callReason(call: PortCall, stage: StageState): string {
  const limiting = limitingDraft(stage);
  if (!limiting || limiting.floating.maxDraftM == null) return "舱容";
  const structural = limiting.floating.limitSource === "zone"
    ? limiting.floating.zone === "winter" ? "(冬季载重线)" : "(热带载重线)"
    : limiting.floating.limitSource === "ship" ? "(结构吃水)" : "";
  return `受限于 ${call.port}${structural} ${limiting.phase}吃水 ${limiting.floating.maxDraftM.toFixed(2)} m(ρ ${limiting.floating.waterDensity.toFixed(3)})`;
}

function canPlaceLocalGroup(
  parcelId: string,
  tanks: string[],
  allocations: Allocation[],
  pair: ReturnType<typeof buildPairOk>,
  adjacency: ReturnType<typeof buildAdjacency>
): boolean {
  const occupied = new Map<string, string>();
  for (const allocation of allocations) {
    if (allocation.parcelId === parcelId) continue;
    for (const tank of allocation.tanks)
      occupied.set(tank, allocation.parcelId);
  }
  for (const tank of tanks) {
    if (occupied.has(tank)) return false;
    for (const neighbour of Array.from(adjacency.get(tank) ?? [])) {
      const other = occupied.get(neighbour);
      if (other != null && !pair.ok[parcelId]?.[other]) return false;
    }
  }
  return true;
}

/** Change only one parcel's allocation; all other parcels remain fixed. */
function setAllocationQuantity(
  ship: StowShip,
  voyage: StowVoyage,
  allocations: Allocation[],
  parcel: Parcel,
  quantity: number,
  compact: boolean
): Allocation[] {
  const next = allocations.map(allocation => ({
    ...allocation,
    tanks: [...allocation.tanks],
  }));
  const index = next.findIndex(allocation => allocation.parcelId === parcel.id);
  if (index < 0) return next;
  if (quantity <= EPSILON) {
    next.splice(index, 1);
    return next;
  }
  const current = next[index];
  const capacity = current.tanks.reduce(
    (sum, tankId) => sum + ship.tanks.find(tank => tank.id === tankId)!.cap100,
    0
  );
  current.fillRatio = quantity / (capacity * parcel.density);
  if (!compact || current.fillRatio >= 0.3 || current.tanks.length <= 1)
    return next;

  const oneParcelVoyage: StowVoyage = {
    ...voyage,
    parcels: [{ ...parcel, quantityMt: quantity, intake: { mode: "fixed" } }],
  };
  const prepared = prepareParcels(ship, oneParcelVoyage);
  if ("errors" in prepared) return next;
  const pair = buildPairOk(voyage.parcels);
  const adjacency = buildAdjacency(ship);
  const local = candidateGroups(prepared[0], ship, Infinity)
    .filter(group => group.tanks.length < current.tanks.length)
    .find(group =>
      canPlaceLocalGroup(parcel.id, group.tanks, next, pair, adjacency)
    );
  if (local)
    next[index] = {
      parcelId: parcel.id,
      tanks: [...local.tanks],
      fillRatio: local.fillRatio,
    };
  return next;
}

function marginAtCall(
  ship: StowShip,
  voyage: StowVoyage,
  allocations: Allocation[],
  callId: string
): number {
  const stage = simulateStages(ship, voyage, allocations, false).find(
    item => item.callId === callId
  );
  return stage == null ? Infinity : (stageDraftMargin(stage) ?? Infinity);
}

function greatestFeasibleQuantity(
  ship: StowShip,
  voyage: StowVoyage,
  allocations: Allocation[],
  parcel: Parcel,
  callId: string,
  minimum: number,
  current: number
): number {
  const atMinimum = setAllocationQuantity(
    ship,
    voyage,
    allocations,
    parcel,
    minimum,
    false
  );
  if (marginAtCall(ship, voyage, atMinimum, callId) < 0) return minimum;
  let low = minimum;
  let high = current;
  for (let iteration = 0; iteration < 28; iteration++) {
    const mid = (low + high) / 2;
    const trial = setAllocationQuantity(
      ship,
      voyage,
      allocations,
      parcel,
      mid,
      false
    );
    if (marginAtCall(ship, voyage, trial, callId) >= 0) low = mid;
    else high = mid;
  }
  return low;
}

function greatestFeasibleRatioScale(
  ship: StowShip,
  voyage: StowVoyage,
  allocations: Allocation[],
  parcels: Parcel[],
  quantities: Record<string, number>,
  callId: string
): number {
  const applyScale = (scale: number, compact: boolean) =>
    parcels.reduce(
      (next, parcel) =>
        setAllocationQuantity(
          ship,
          voyage,
          next,
          parcel,
          Math.max(minimumOf(parcel), quantities[parcel.id] * scale),
          compact
        ),
      allocations
    );
  if (marginAtCall(ship, voyage, applyScale(0, false), callId) < 0) return 0;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const mid = (low + high) / 2;
    if (marginAtCall(ship, voyage, applyScale(mid, false), callId) >= 0)
      low = mid;
    else high = mid;
  }
  return low;
}

/** Restore port limits and reduce only load rates until every limited stage is feasible. */
export function shrinkForDraft(
  ship: StowShip,
  voyage: StowVoyage,
  inputPlan: StowPlan,
  includeStrength = true,
): {
  plan: StowPlan;
  intake: Record<string, number>;
  limitedBy: Record<string, string>;
} {
  const variables = voyage.parcels.filter(isVariable);
  const callSeq = new Map(voyage.calls.map(call => [call.id, call.seq]));
  let allocations = inputPlan.allocations.map(allocation => ({
    ...allocation,
    tanks: [...allocation.tanks],
  }));
  const intake = Object.fromEntries(
    variables.map(parcel => [
      parcel.id,
      allocationQuantity(
        ship,
        parcel,
        allocations.find(allocation => allocation.parcelId === parcel.id)
      ),
    ])
  );
  const draftReason: Record<string, string> = {};

  for (let pass = 0; pass < 80; pass++) {
    const currentPlan = planFromAllocations(
      ship,
      voyage,
      allocations,
      intake,
      false
    );
    const exceeded = currentPlan.stages.find(stageDraftExceeded);
    if (!exceeded) {
      const limitedBy = Object.fromEntries(
        variables.map(parcel => {
          const atMaximum =
            parcel.intake?.maxMt != null &&
            Math.abs(intake[parcel.id] - parcel.intake.maxMt) <=
              Math.max(0.01, parcel.intake.maxMt * 1e-6);
          return [
            parcel.id,
            draftReason[parcel.id] ?? (atMaximum ? "最大量" : "舱容"),
          ];
        })
      );
      return {
        plan: includeStrength
          ? planFromAllocations(ship, voyage, allocations, intake)
          : currentPlan,
        intake: { ...intake },
        limitedBy,
      };
    }

    const call = voyage.calls.find(item => item.id === exceeded.callId)!;
    const seq = callSeq.get(call.id)!;
    const phase = limitingDraft(exceeded)?.phase ?? "离港";
    const reducible = variables.filter(parcel => {
      const loadSeq = callSeq.get(parcel.loadCallId);
      const dischargeSeq = callSeq.get(parcel.dischargeCallId);
      return (
        loadSeq != null &&
        dischargeSeq != null &&
        (phase === "到港" ? loadSeq < seq && seq <= dischargeSeq : loadSeq <= seq && seq < dischargeSeq) &&
        intake[parcel.id] > minimumOf(parcel) + EPSILON
      );
    });
    if (!reducible.length)
      return {
        plan: includeStrength
          ? planFromAllocations(ship, voyage, allocations, intake)
          : currentPlan,
        intake: { ...intake },
        limitedBy: Object.fromEntries(
          variables.map(parcel => [parcel.id, draftReason[parcel.id] ?? "舱容"])
        ),
      };

    const lowPriority = reducible
      .filter(parcel => parcel.intake!.mode === "priority")
      .sort(
        (a, b) =>
          (b.intake?.priority ?? Number.MAX_SAFE_INTEGER) -
            (a.intake?.priority ?? Number.MAX_SAFE_INTEGER) ||
          b.id.localeCompare(a.id)
      );
    const ratios = reducible.filter(parcel => parcel.intake!.mode === "ratio");
    const ranges = reducible.filter(parcel => parcel.intake!.mode === "range");
    const changed: Parcel[] = [];

    if (lowPriority.length) {
      const parcel = lowPriority[0];
      const quantity = greatestFeasibleQuantity(
        ship,
        voyage,
        allocations,
        parcel,
        call.id,
        minimumOf(parcel),
        intake[parcel.id]
      );
      intake[parcel.id] = quantity;
      allocations = setAllocationQuantity(
        ship,
        voyage,
        allocations,
        parcel,
        quantity,
        true
      );
      changed.push(parcel);
    } else if (ratios.length) {
      const scale = greatestFeasibleRatioScale(
        ship,
        voyage,
        allocations,
        ratios,
        intake,
        call.id
      );
      for (const parcel of ratios) {
        const quantity = Math.max(minimumOf(parcel), intake[parcel.id] * scale);
        intake[parcel.id] = quantity;
        allocations = setAllocationQuantity(
          ship,
          voyage,
          allocations,
          parcel,
          quantity,
          true
        );
        changed.push(parcel);
      }
    } else {
      const parcel = ranges[0];
      const quantity = greatestFeasibleQuantity(
        ship,
        voyage,
        allocations,
        parcel,
        call.id,
        minimumOf(parcel),
        intake[parcel.id]
      );
      intake[parcel.id] = quantity;
      allocations = setAllocationQuantity(
        ship,
        voyage,
        allocations,
        parcel,
        quantity,
        true
      );
      changed.push(parcel);
    }
    for (const parcel of changed) draftReason[parcel.id] = callReason(call, exceeded);
  }

  const plan = planFromAllocations(
    ship,
    voyage,
    allocations,
    intake,
    includeStrength
  );
  return {
    plan,
    intake: { ...intake },
    limitedBy: Object.fromEntries(
      variables.map(parcel => [parcel.id, draftReason[parcel.id] ?? "舱容"])
    ),
  };
}

function shrinkTargets(
  voyage: StowVoyage,
  targets: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(
    voyage.parcels
      .filter(isVariable)
      .map(parcel => [
        parcel.id,
        Math.max(minimumOf(parcel), (targets[parcel.id] ?? 0) * 0.9),
      ])
  );
}

function betterCandidate(
  voyage: StowVoyage,
  a: ReturnType<typeof shrinkForDraft>,
  b: ReturnType<typeof shrinkForDraft>
): boolean {
  const priorities = voyage.parcels
    .filter(parcel => parcel.intake?.mode === "priority")
    .map((parcel, index) => ({ parcel, index }))
    .sort(
      (x, y) =>
        (x.parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER) -
          (y.parcel.intake?.priority ?? Number.MAX_SAFE_INTEGER) ||
        x.index - y.index ||
        x.parcel.id.localeCompare(y.parcel.id)
    );
  for (const { parcel } of priorities) {
    const difference = a.intake[parcel.id] - b.intake[parcel.id];
    if (Math.abs(difference) > EPSILON) return difference > 0;
  }
  const totalA = Object.values(a.intake).reduce(
    (sum, quantity) => sum + quantity,
    0
  );
  const totalB = Object.values(b.intake).reduce(
    (sum, quantity) => sum + quantity,
    0
  );
  if (Math.abs(totalA - totalB) > EPSILON) return totalA > totalB;
  return comparePlans(a.plan, b.plan) < 0;
}

export function solveIntake(
  ship: StowShip,
  voyage: StowVoyage,
  opts: EngineOptions = {}
): StowResult {
  const variables = voyage.parcels.filter(isVariable);
  if (!variables.length) return solvePrestow(ship, voyage, opts);

  let targets = initialTargets(ship, voyage);
  const variableIds = new Set(variables.map(parcel => parcel.id));
  const zeroResult = (found: Pick<SearchOut, "rejectedByDraft" | "truncatedBy" | "firstRejected">): StowResult => {
    const capacity = ship.tanks.reduce((sum, tank) => sum + tank.cap100, 0) * FL_COEFF;
    const upperTargets = Object.fromEntries(variables.map(p => [p.id, p.intake?.maxMt ?? capacity * p.density]));
    const materialized = materializeVoyage(voyage, upperTargets, false);
    const prepared = materialized.parcels.map(p => prepareParcel(ship, p)).sort((a, b) => b.volume - a.volume);
    const pair = buildPairOk(materialized.parcels);
    return {
      status: found.truncatedBy ? "truncated" : "ok", truncatedBy: found.truncatedBy,
      plans: [], totalFound: 0, conflictPairs: pair.conflicts, message: "意向无法满足", rejectedByDraft: found.rejectedByDraft,
      diagnosis: diagnoseInfeasibility({ ship, voyage: materialized, prepared, pair, adj: buildAdjacency(ship),
        groupsFor: (p, maxSingles) => variableIds.has(p.parcel.id)
          ? expandedVariableGroups(p, ship).filter(g => p.volume <= p.ll * g.tanks.reduce((sum, id) => sum + ship.tanks.find(t => t.id === id)!.cap100, 0))
          : candidateGroups(p, ship, maxSingles), found, limit: opts.limit }),
    };
  };
  const enumerationShip = { ...ship, maxDraftM: undefined };
  let enumerated: Exclude<StowResult, { status: "invalid" }> | undefined;
  let truncatedBy: SearchOut["truncatedBy"];
  for (let attempt = 0; attempt <= MAX_ZERO_SOLUTION_RETRIES; attempt++) {
    const materialized = materializeVoyage(voyage, targets, true);
    const result = solvePrestow(
      enumerationShip,
      materialized,
      { ...opts, maxPlans: ENUMERATION_PLANS },
      variableGroupOverrides(enumerationShip, materialized, variableIds),
      0,
      false
    );
    if (result.status !== "invalid" && result.plans.length) {
      enumerated = result;
      break;
    }
    if (result.status !== "invalid") truncatedBy = result.truncatedBy;
    if (
      result.status === "invalid" &&
      !result.errors.every(error => /总体积|至少需要一票货/.test(error))
    ) {
      // 意向求解可能移除零装载票，定位仍使用输入表中的原始索引。
      return { ...result, issues: result.issues?.map(issue => {
        const target = issue.target;
        if (target.section !== "parcels" || target.index == null) return issue;
        const parcelId = materialized.parcels[target.index].id;
        return { ...issue, target: { ...target, index: voyage.parcels.findIndex(parcel => parcel.id === parcelId) } };
      }) };
    }
    if (attempt < MAX_ZERO_SOLUTION_RETRIES)
      targets = shrinkTargets(voyage, targets);
  }
  if (!enumerated) return zeroResult({ rejectedByDraft: 0, truncatedBy });

  const shrunk = enumerated.plans
    .slice(0, SHRINK_CANDIDATES)
    .map(plan => shrinkForDraft(ship, voyage, plan, false));
  const candidates = shrunk.filter(candidate => candidate.plan.draftOk);
  if (!candidates.length)
    return zeroResult({ rejectedByDraft: shrunk.length, firstRejected: shrunk[0]?.plan.allocations, truncatedBy: enumerated.truncatedBy });

  const evaluatePrecise: PreciseMarginEvaluator = (stage, call, consumables) =>
    preciseArrivalDraft(ship, voyage, stage, call, consumables).draftMargin;
  // 精算收敛逐个做:首选可行即止(每次精算 ≈ 阶段数 × 40 ms)
  const refineCandidate = (candidate: (typeof candidates)[number]) => {
    if (opts.fastOnly) return { plan: candidate.plan, intake: candidate.intake, limitedBy: candidate.limitedBy };
    const refined = refineIntakePrecise(
      ship,
      voyage,
      candidate.plan,
      evaluatePrecise
    );
    return {
      plan: refined.plan,
      intake: refined.intake,
      limitedBy: Object.fromEntries(
        Object.entries({ ...candidate.limitedBy, ...refined.limitedBy }).map(
          ([parcelId, reason]) => [
            parcelId,
            reason.endsWith("(精算)") ? reason : `${reason}(精算)`,
          ]
        )
      ),
    };
  };
  let best = refineCandidate(candidates[0]);
  for (const candidate of candidates.slice(1, 3)) {
    if (best.plan.draftOk !== false) break;
    const refined = refineCandidate(candidate);
    const candidateFeasible = refined.plan.draftOk !== false;
    const bestFeasible = best.plan.draftOk !== false;
    if (
      (candidateFeasible && !bestFeasible) ||
      (candidateFeasible === bestFeasible &&
        betterCandidate(voyage, refined, best))
    )
      best = refined;
  }
  best.plan.intake = { ...best.intake };
  const preciseStillExceeded = best.plan.draftOk === false;
  const firstLoad = [...voyage.calls].sort((a, b) => a.seq - b.seq)
    .find(call => voyage.parcels.some(parcel => parcel.loadCallId === call.id));
  const firstRob = best.plan.stages.find(stage => stage.callId === firstLoad?.id)?.consumables?.departure;
  const intakeSummary = variables.map(parcel => {
    const limitedBy = best.limitedBy[parcel.id];
    const bindingCall = voyage.calls.find(call => call.id === best.plan.bindingCallId && limitedBy.includes(`受限于 ${call.port}`))
      ?? voyage.calls.find(call => limitedBy.includes(`受限于 ${call.port}`));
    const arrival = best.plan.stages.find(stage => stage.callId === bindingCall?.id)?.consumables?.arrival;
    return {
      parcelId: parcel.id,
      quantityMt: best.intake[parcel.id],
      limitedBy,
      ...(firstRob && arrival ? { consumptionCreditMt: firstRob.fuelMt + firstRob.freshWaterMt - arrival.fuelMt - arrival.freshWaterMt } : {}),
    };
  });
  const rejectedByDraft =
    (candidates.length < Math.min(SHRINK_CANDIDATES, enumerated.plans.length)
      ? Math.min(SHRINK_CANDIDATES, enumerated.plans.length) - candidates.length
      : 0) + (preciseStillExceeded ? 1 : 0);
  return {
    status: enumerated.status,
    truncatedBy: enumerated.truncatedBy,
    plans: [best.plan],
    totalFound: 1,
    conflictPairs: buildPairOk(voyage.parcels).conflicts,
    message: `最大装载量方案，总吨 ${Object.values(best.intake)
      .reduce((sum, quantity) => sum + quantity, 0)
      .toFixed(1)}${preciseStillExceeded ? "；精算后仍超限(方案标记为不合格,默认不列出)" : ""}`,
    rejectedByDraft,
    intakeSummary,
  };
}
