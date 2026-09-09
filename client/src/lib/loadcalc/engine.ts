import {
  findDraftForVolume,
  hullProps,
  lightshipSummary,
  listCompartments,
  tankAtLevel,
  tankCapacity,
  tankFill,
  waterlineZ,
  type HullProps,
} from "../hull";
import type {
  ConditionResult,
  FixedWeight,
  LoadKind,
  LoadingCondition,
  TankResult,
  WeightGroup,
} from "./types";

const STRUCTURAL_DRAFT = 13;
const EMPTY_GROUP: WeightGroup = { weight: 0, lcg: 0, tcg: 0, vcg: 0 };

type WeightItem = Pick<WeightGroup, "weight" | "lcg" | "tcg" | "vcg">;

function propsAtVolume(
  volume: number,
  trim: number,
  heel: number,
  rho: number,
  initialDraft?: number,
): { draftMid: number; props: HullProps } {
  let draftMid = initialDraft ?? Math.max(0.1, Math.min(20, volume / (175 * 32 * 0.72)));
  let props = hullProps({ draftMid, trim, heel }, rho);
  for (let index = 0; index < 8; index++) {
    const error = volume - props.volume;
    if (Math.abs(error) / Math.max(volume, 1) < 1e-8) return { draftMid, props };
    if (!Number.isFinite(props.awp) || props.awp <= 1e-9) break;
    const correction = Math.max(-3, Math.min(3, error / props.awp));
    draftMid += correction;
    props = hullProps({ draftMid, trim, heel }, rho);
  }

  // Keep the hull library's exact bisection as a fallback for extreme attitudes.
  draftMid = findDraftForVolume(volume, trim, heel);
  return { draftMid, props: hullProps({ draftMid, trim, heel }, rho) };
}

function combine(items: WeightItem[]): WeightGroup {
  const weight = items.reduce((sum, item) => sum + item.weight, 0);
  if (weight === 0) return { ...EMPTY_GROUP };
  return {
    weight,
    lcg: items.reduce((sum, item) => sum + item.weight * item.lcg, 0) / weight,
    tcg: items.reduce((sum, item) => sum + item.weight * item.tcg, 0) / weight,
    vcg: items.reduce((sum, item) => sum + item.weight * item.vcg, 0) / weight,
  };
}

function fixedWeightGroup(items: FixedWeight[]): WeightGroup {
  return combine(items);
}

export function levelFromPct(compId: string, pct: number): number {
  const capacity = tankCapacity(compId).capacity100;
  return tankFill(compId, capacity * Math.min(100, Math.max(0, pct)) / 100).level;
}

export function levelFromVolume(compId: string, volume: number): number {
  return tankFill(compId, volume).level;
}

export function levelFromWeight(compId: string, weight: number, density: number): number {
  if (density <= 0) return tankCapacity(compId).bottom;
  return levelFromVolume(compId, weight / density);
}

export function solveEquilibrium(
  weight: number,
  lcg: number,
  tcg: number,
  vcg: number,
  rho: number,
): {
  draftMid: number;
  trim: number;
  heel: number;
  props: HullProps;
  iterations: number;
  converged: boolean;
} {
  const volume = weight / rho;
  let trim = 0;
  let heel = 0;
  let state = propsAtVolume(volume, trim, heel, rho);
  let draftMid = state.draftMid;
  let props = state.props;
  let converged = false;
  let iterations = 0;

  for (; iterations < 30; iterations++) {
    const dTrim = ((props.lcb - lcg) * weight) / (100 * props.mtc);
    trim += dTrim;

    state = propsAtVolume(volume, trim, heel, rho, draftMid);
    draftMid = state.draftMid;
    props = state.props;
    const gz = (angle: number, angleProps: HullProps) => {
      const radians = angle * Math.PI / 180;
      return angleProps.tcb * Math.cos(radians)
        + angleProps.vcb * Math.sin(radians)
        - vcg * Math.sin(radians)
        - tcg * Math.cos(radians);
    };
    const g0 = gz(heel, props);
    let dHeel = 0;
    if (Math.abs(g0) >= 1e-10) {
      const trialAngle = heel + 0.5;
      const trial = propsAtVolume(volume, trim, trialAngle, rho, draftMid);
      const slope = (gz(trialAngle, trial.props) - g0) / 0.5;
      dHeel = slope > 1e-9 ? -g0 / slope : 0;
      dHeel = Math.max(-5, Math.min(5, dHeel));
      heel += dHeel;
    }

    state = propsAtVolume(volume, trim, heel, rho, draftMid);
    draftMid = state.draftMid;
    props = state.props;
    const volumeError = Math.abs(props.volume - volume) / Math.max(volume, 1);
    if (Math.abs(dTrim) < 0.001 && Math.abs(dHeel) < 0.01 && volumeError < 1e-6) {
      converged = true;
      iterations++;
      break;
    }
  }

  return { draftMid, trim, heel, props, iterations, converged };
}

export function computeCondition(cond: LoadingCondition): ConditionResult {
  const definitions = new Map(listCompartments().map(compartment => [compartment.id, compartment]));
  const warnings: string[] = [];
  const tanks: TankResult[] = cond.tanks.map(load => {
    const definition = definitions.get(load.compId);
    if (!definition || definition.kind === "void") {
      throw new Error(`Unknown loadable compartment: ${load.compId}`);
    }
    const capacity = tankCapacity(load.compId);
    if (load.level > capacity.top) {
      warnings.push(`「${definition.name} 液位超过舱顶」`);
    }
    const level = Math.min(capacity.top, Math.max(capacity.bottom, load.level));
    const state = tankAtLevel(load.compId, level);
    const weight = state.volume * load.density;
    const result: TankResult = {
      compId: load.compId,
      kind: definition.kind,
      name: definition.name,
      level,
      ullage: capacity.ullageRef - level,
      sounding: level - capacity.bottom,
      volume: state.volume,
      fillPct: state.fillPct,
      density: load.density,
      weight,
      lcg: state.lcg,
      tcg: state.tcg,
      vcg: state.vcg,
      fsm: load.density * state.iT,
    };
    if (result.kind === "cargo" && result.fillPct > 98) {
      warnings.push(`「${result.name} 装载率 ${result.fillPct.toFixed(1)}% 超过 98%」`);
    }
    return result;
  });

  const tankGroup = (kind: LoadKind) => combine(tanks.filter(tank => tank.kind === kind));
  const lightship = lightshipSummary();
  const groups = {
    lightship: { ...lightship },
    cargo: tankGroup("cargo"),
    ballast: tankGroup("ballast"),
    fuel: tankGroup("fuel"),
    fresh: tankGroup("fresh"),
    constants: fixedWeightGroup(cond.constants),
    deadweight: { ...EMPTY_GROUP },
    total: { ...EMPTY_GROUP },
  };
  groups.deadweight = combine([
    groups.cargo,
    groups.ballast,
    groups.fuel,
    groups.fresh,
    groups.constants,
  ]);
  groups.total = combine([groups.lightship, groups.deadweight]);

  const equilibrium = solveEquilibrium(
    groups.total.weight,
    groups.total.lcg,
    groups.total.tcg,
    groups.total.vcg,
    cond.waterDensity,
  );
  const { draftMid, trim, heel, props } = equilibrium;
  const wp = { draftMid, trim, heel };
  const fsmTotal = tanks.reduce((sum, tank) => sum + tank.fsm, 0);
  const kg = groups.total.vcg;
  const gm0 = props.kmT - kg;
  const gsc = fsmTotal / groups.total.weight;
  const gmCorrected = gm0 - gsc;

  if (Math.abs(heel) > 1) warnings.push(`「横倾 ${heel.toFixed(2)}° 超过 1°」`);
  if (draftMid > STRUCTURAL_DRAFT) {
    warnings.push(`「船中吃水 ${draftMid.toFixed(2)} m 超过结构吃水 13.0 m」`);
  }
  if (gmCorrected < 0.15) {
    warnings.push(`「GM 修正后 ${gmCorrected.toFixed(2)} m 低于 0.15 m」`);
  }
  const structuralDisplacement = hullProps(
    { draftMid: STRUCTURAL_DRAFT, trim: 0, heel: 0 },
    cond.waterDensity,
  ).disp;
  if (groups.total.weight > structuralDisplacement) {
    warnings.push("「排水量超过结构吃水对应排水量」");
  }

  return {
    groups,
    tanks,
    fsmTotal,
    floating: {
      draftMid,
      draftAft: props.draftAft,
      draftFwd: props.draftFwd,
      trim,
      heel,
      draftMarkAft: waterlineZ(wp, 2, 0),
      draftMarkMid: waterlineZ(wp, 87.5, 0),
      draftMarkFwd: waterlineZ(wp, 173, 0),
      displacement: groups.total.weight,
      volume: props.volume,
      lcb: props.lcb,
      vcb: props.vcb,
      lcf: props.lcf,
      tpc: props.tpc,
      mtc: props.mtc,
      kmT: props.kmT,
      kg,
      gm0,
      gsc,
      gmCorrected,
      waterDensity: cond.waterDensity,
    },
    warnings,
  };
}
