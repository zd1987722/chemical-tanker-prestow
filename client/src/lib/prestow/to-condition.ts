import { lightshipSummary, tankCapacity, tankFill } from "../hull";
import type {
  FixedWeight,
  LoadingCondition,
  TankLoad as ConditionTankLoad,
} from "../loadcalc/types";
import type { StageState, StageFloating, StowPlan, StowShip, StowVoyage } from "./types";
import { DEFAULT_CONSTANTS as PRESTOW_DEFAULT_CONSTANTS } from "./engine";
import { planStageViews, type StageViewData } from "./stage-view";

let nextConditionId = 0;

function conditionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `prestow-condition-${Date.now()}-${nextConditionId++}`
  );
}

function conditionConstants(voyage: StowVoyage): FixedWeight[] {
  const constants = { ...PRESTOW_DEFAULT_CONSTANTS, ...voyage.constants };
  const items: FixedWeight[] = [
    {
      id: "const",
      name: "常数",
      weight: constants.constantsMt,
      lcg: constants.constantsLcg,
      tcg: 0,
      vcg: constants.constantsVcg,
    },
  ];
  if (voyage.constants?.lightshipOverride !== undefined) {
    const lightship = lightshipSummary();
    items.push({
      id: "lightship-adjustment",
      name: "空船重量修正",
      weight: voyage.constants.lightshipOverride - lightship.weight,
      lcg: lightship.lcg,
      tcg: lightship.tcg,
      vcg: lightship.vcg,
    });
  }
  return items;
}

function loadAtWeight(
  compId: string,
  weight: number,
  density: number
): ConditionTankLoad {
  return {
    compId,
    density,
    level: tankFill(compId, weight / density).level,
  };
}

function pairedLoads(
  baseId: string,
  weight: number,
  density: number
): ConditionTankLoad[] {
  if (weight <= 0) return [];
  return [
    loadAtWeight(`${baseId}P`, weight / 2, density),
    loadAtWeight(`${baseId}S`, weight / 2, density),
  ];
}

function consumables(voyage: StowVoyage, stage: StageState): ConditionTankLoad[] {
  const constants = { ...PRESTOW_DEFAULT_CONSTANTS, ...voyage.constants };
  const fuelMt = stage.consumables?.departure.fuelMt ?? constants.bunkersMt;
  const freshWaterMt = stage.consumables?.departure.freshWaterMt ?? constants.freshWaterMt;
  const hfo2Capacity = 2 * tankCapacity("HFO2P").capacity100 * 0.98;
  const hfo2Weight = Math.min(fuelMt, hfo2Capacity);
  const hfo1Weight = Math.max(0, fuelMt - hfo2Weight);
  return [
    ...pairedLoads("HFO1", hfo1Weight, 0.98),
    ...pairedLoads("HFO2", hfo2Weight, 0.98),
    ...pairedLoads("FW", freshWaterMt, 1),
  ];
}

function ballastPercentages(
  floating: StageFloating | undefined
): { id: string; pct: number }[] {
  return floating?.ballastTanks ?? [];
}

export function stageToCondition(
  ship: StowShip,
  voyage: StowVoyage,
  plan: StowPlan,
  stageIndex: number,
  name: string
): LoadingCondition {
  const stage = plan.stages[stageIndex];
  if (!stage) throw new Error(`预配载站序号无效：${stageIndex}`);
  return stageViewToCondition(ship, voyage, planStageViews(plan, {})[stage.callId], name);
}

export function stageViewToCondition(
  ship: StowShip,
  voyage: StowVoyage,
  view: StageViewData,
  name: string,
): LoadingCondition {
  const { stage } = view;
  const call = voyage.calls.find(item => item.id === stage.callId);
  if (!call) throw new Error(`预配载站不存在：${stage.callId}`);

  const parcelById = new Map(voyage.parcels.map(parcel => [parcel.id, parcel]));
  const tankById = new Map(ship.tanks.map(tank => [tank.id, tank]));
  const cargo: ConditionTankLoad[] = [];

  for (const [compId, load] of Object.entries(stage.tanks)) {
    if (!load) continue;
    const parcel = parcelById.get(load.parcelId);
    if (!parcel) throw new Error(`预配载票货不存在：${load.parcelId}`);
    if (!tankById.has(compId)) throw new Error(`预配载货舱不存在：${compId}`);
    cargo.push({
      compId,
      density: parcel.density,
      level: tankFill(compId, load.volume).level,
      cargoName: parcel.display,
      ...(parcel.loadTempC == null ? {} : { tempC: parcel.loadTempC }),
    });
  }

  const waterDensity =
    stage.floating?.waterDensity ?? call.waterDensity ?? 1.025;
  const ballast = ballastPercentages(stage.floating).map(
    ({ id: compId, pct }) => {
      const capacity = tankCapacity(compId).capacity100;
      return {
        compId,
        density: waterDensity,
        level: tankFill(
          compId,
          (capacity * Math.min(100, Math.max(0, pct))) / 100
        ).level,
      };
    }
  );

  const timestamp = new Date().toISOString();
  const ballastMissing = ballast.length === 0;
  return {
    id: conditionId(),
    name,
    note: `由预配载 ${voyage.voyageNo} / ${call.port} ${call.berth} 生成；离港 / 作业后 · ${view.calculationSource === "precise" ? "精算" : "估算"}${ballastMissing ? "；该站未提供压载舱结果" : ""}`,
    waterDensity,
    port: { name: `${call.port || "未填港口"} · ${call.berth || "未填泊位"}`, density: waterDensity, maxDraft: call.maxDraftM },
    tanks: [...cargo, ...ballast, ...consumables(voyage, stage)],
    constants: conditionConstants(voyage),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
