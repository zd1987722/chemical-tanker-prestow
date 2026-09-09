import { zoneDraftLimit } from "./consumption";
import { autoBallast } from "../ballast";
import { lightshipSummary } from "../hull";
import { levelFromWeight } from "../loadcalc/engine";
import type {
  FixedWeight,
  TankLoad as LoadcalcTankLoad,
} from "../loadcalc/types";
import {
  ballastRuleFor,
  DEFAULT_CONSTANTS,
  solverBallastTargets,
  solveWithDraftRelief,
  stageBallastTargets,
} from "./engine";
import type {
  BallastRule,
  StageConsumables,
  LoadLineZone,
  PortCall,
  StageState,
  StowPlan,
  StowShip,
  StowVoyage,
} from "./types";

export interface PreciseFloating {
  displacement: number;
  draftMid: number;
  draftAft: number;
  draftFwd: number;
  trim: number;
  /** 本站按受限港规则放宽了纵倾窗口 */
  trimRelaxed?: boolean;
  /** 若配到平吃水还能再换出的最深吃水,m:max(draftAft, draftFwd) − draftMid,≥ 0 */
  trimReliefM?: number;
  waterDensity: number;
  maxDraftM?: number;
  draftMargin?: number;
  limitSource?: "port" | "ship" | "zone";
  zone?: LoadLineZone;
  ballastMt: number;
  ballastTanks: { id: string; pct: number; weight: number }[];
  ballastRule?: BallastRule;
  gmCorrected: number;
  sfPct: number;
  bmPct: number;
  ok: boolean;
  notes: string[];
}

export interface PreciseStage {
  floating?: PreciseFloating;
  arrival?: PreciseFloating;
}

function fixedWeights(voyage: StowVoyage, consumables?: StageConsumables["arrival"]): FixedWeight[] {
  const lightship = lightshipSummary();
  const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const lightshipWeight =
    voyage.constants?.lightshipOverride ?? lightship.weight;
  const weights: FixedWeight[] = [
    {
      id: "prestow-bunkers",
      name: "Bunkers",
      weight: consumables?.fuelMt ?? constants.bunkersMt,
      lcg: constants.bunkersLcg,
      tcg: 0,
      vcg: constants.bunkersVcg,
    },
    {
      id: "prestow-fresh-water",
      name: "Fresh water",
      weight: consumables?.freshWaterMt ?? constants.freshWaterMt,
      lcg: constants.freshWaterLcg,
      tcg: 0,
      vcg: constants.freshWaterVcg,
    },
    {
      id: "prestow-constants",
      name: "Voyage constants",
      weight: constants.constantsMt,
      lcg: constants.constantsLcg,
      tcg: 0,
      vcg: constants.constantsVcg,
    },
  ];
  if (lightshipWeight !== lightship.weight) {
    weights.push({
      id: "prestow-lightship-adjustment",
      name: "Lightship override adjustment",
      weight: lightshipWeight - lightship.weight,
      lcg: lightship.lcg,
      tcg: lightship.tcg,
      vcg: lightship.vcg,
    });
  }
  return weights;
}

function calculatePreciseFloating(
  ship: StowShip,
  voyage: StowVoyage,
  stage: StageState,
  call: PortCall,
  consumables?: StageConsumables["arrival"]
): PreciseFloating {
  const tankById = new Map(ship.tanks.map(tank => [tank.id, tank]));
  const cargo: LoadcalcTankLoad[] = Object.entries(stage.tanks).flatMap(
    ([compId, load]) => {
      const tank = tankById.get(compId);
      if (!load || !tank || load.volume <= 0) return [];
      const density = load.weight / load.volume;
      return [{
        compId,
        density,
        level: levelFromWeight(compId, load.weight, density),
      }];
    }
  );
  const waterDensity = call.waterDensity ?? 1.025;
  const portLimit = call.maxDraftM;
  const shipLimit = ship.maxDraftM == null ? undefined : zoneDraftLimit(ship.maxDraftM, call.loadLineZone);
  const limitSource =
    portLimit != null && (shipLimit == null || portLimit <= shipLimit)
      ? "port"
      : shipLimit != null
        ? call.loadLineZone && call.loadLineZone !== "summer" ? "zone" : "ship"
        : undefined;
  const maxDraftM = limitSource === "port" ? portLimit : shipLimit;
  const ballastTargets = stageBallastTargets(ship, voyage, stage, call);
  const constants = fixedWeights(voyage, consumables);
  const outcome = solveWithDraftRelief(
    ballastTargets,
    maxDraftM,
    targets => autoBallast({
      cargo,
      fuel: [],
      constants,
      rho: waterDensity,
      targets: solverBallastTargets(targets),
    }),
    result => ({ draftAft: result.achieved.draftAft, draftFwd: result.achieved.draftFwd, ok: result.ok }),
  );
  const result = outcome.result;
  const floating = result.condition.floating;
  const deepestDraft = Math.max(floating.draftAft, floating.draftFwd);
  const ballastIds = new Set(result.ballast.map(tank => tank.compId));
  const ballastTanks = result.condition.tanks
    .filter(tank => ballastIds.has(tank.compId))
    .map(tank => ({
      id: tank.compId,
      pct: tank.fillPct,
      weight: tank.weight,
    }));
  return {
    displacement: floating.displacement,
    draftMid: floating.draftMid,
    draftAft: floating.draftAft,
    draftFwd: floating.draftFwd,
    trim: result.achieved.trim,
    trimRelaxed: outcome.trimRelaxed,
    trimReliefM: Math.max(0, deepestDraft - floating.draftMid),
    waterDensity,
    maxDraftM,
    draftMargin:
      maxDraftM == null ? undefined : maxDraftM - deepestDraft,
    limitSource,
    zone: call.loadLineZone ?? "summer",
    ballastMt: ballastTanks.reduce((sum, tank) => sum + tank.weight, 0),
    ballastTanks,
    ballastRule: ballastRuleFor(outcome.targets, floating),
    gmCorrected: result.gmCorrected,
    sfPct: result.achieved.sfPct,
    bmPct: result.achieved.bmPct,
    ok: result.ok,
    notes: result.notes,
  };
}

export function preciseArrivalDraft(
  ship: StowShip,
  voyage: StowVoyage,
  stage: StageState,
  call: PortCall,
  consumables?: StageConsumables["arrival"]
): { draftAft: number; draftFwd: number; draftMargin: number | undefined } {
  const precise = calculatePreciseFloating(ship, voyage, stage, call, consumables);
  return {
    draftAft: precise.draftAft,
    draftFwd: precise.draftFwd,
    draftMargin: precise.draftMargin,
  };
}

export function precisePlanStages(
  ship: StowShip,
  voyage: StowVoyage,
  plan: StowPlan
): Record<string, PreciseStage> {
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);
  const stagesByCall = new Map(plan.stages.map(stage => [stage.callId, stage]));
  return Object.fromEntries(
    calls.map((call, index) => {
      const stage = stagesByCall.get(call.id);
      const previousStage =
        index > 0 ? stagesByCall.get(calls[index - 1].id) : undefined;
      return [
        call.id,
        {
          floating: stage
            ? calculatePreciseFloating(ship, voyage, stage, call, stage.consumables?.departure)
            : undefined,
          arrival:
            stage?.arrival && previousStage
              ? calculatePreciseFloating(
                  ship,
                  voyage,
                  previousStage,
                  call,
                  stage.consumables?.arrival
                )
              : undefined,
        },
      ];
    })
  );
}
