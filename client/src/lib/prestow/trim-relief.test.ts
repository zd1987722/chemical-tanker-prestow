import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StageTimeline } from "../../components/prestow/StageTimeline";
import { trimReliefHint } from "../../components/prestow/presentation";
import { resetRuntimeExceptionsForTest, setRuntimeExceptions } from "../appendix-i-exceptions";
import { fastAutoBallast } from "../ballast";
import { lightshipSummary, tankAtLevel, tankCapacity } from "../hull";
import { DEMO_STOW_SHIP as ship } from "./demo-ship";
import {
  DEFAULT_CONSTANTS, DRAFT_RELIEF_TRIGGER_M, RELAXED_TRIM_MIN_M,
  draftRelaxedTargets, solvePrestow, solveWithDraftRelief, solverBallastTargets,
  stageBallastTargets, stageFloating, type BallastTargets,
} from "./engine";
import { diagnoseInfeasibility } from "./diagnose";
import { precisePlanStages, type PreciseFloating } from "./precise";
import { findSampleVoyage } from "./sample-voyages";
import { planStageViews } from "./stage-view";
import type { StageFloating, StageState, StowPlan, StowVoyage } from "./types";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());
// 测试环境使用经典 JSX 转换，为静态渲染提供运行时。
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const deepest = (floating: { draftAft: number; draftFwd: number }) => Math.max(floating.draftAft, floating.draftFwd);
const targets: BallastTargets = { trimMin: 0, trimMax: 0.5, trimTarget: 0.25, propellerImmersed: true, gmMin: 0.3 };

describe("受限港两次配平取优", () => {
  it("放宽满载窗口并保留中途装货港更低的下限，标记不传给求解器", () => {
    const relaxed = draftRelaxedTargets(targets)!;
    expect(relaxed).toEqual({ ...targets, trimMin: -0.1, trimTarget: 0, relaxedForDraft: true });
    expect(targets.trimMin).toBe(0);
    expect(draftRelaxedTargets({ ...targets, trimMin: -0.5, trimMax: 2.5 })?.trimMin).toBe(-0.5);
    expect(solverBallastTargets(relaxed)).not.toHaveProperty("relaxedForDraft");
    expect(solverBallastTargets(relaxed)).not.toHaveProperty("propellerImmersed");
  });

  it.each([undefined, 10.05, 11])("港限 %s 时无需第二次配平", limit => {
    const solve = vi.fn(() => ({ draftAft: 10, draftFwd: 9.75 }));
    const outcome = solveWithDraftRelief(targets, limit, solve, result => result);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: solve.mock.results[0].value, targets, trimRelaxed: false });
  });

  it.each([
    { label: "没有改善", aft: 10, firstOk: true, secondOk: true },
    { label: "改善不足五毫米", aft: 9.996, firstOk: true, secondOk: true },
    { label: "第二次未达成而第一次达成", aft: 9.9, firstOk: true, secondOk: false },
  ])("$label 时保留第一次及原窗口", ({ aft, firstOk, secondOk }) => {
    const first = { draftAft: 10, draftFwd: 9.75, ok: firstOk };
    const solve = vi.fn((t: BallastTargets) => t.relaxedForDraft ? { draftAft: aft, draftFwd: 9.75, ok: secondOk } : first);
    expect(solveWithDraftRelief(targets, 10, solve, result => result)).toEqual({ result: first, targets, trimRelaxed: false });
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it.each([true, false, undefined])("第一次状态为 %s 时按改善与达成状态采用放宽结果", firstOk => {
    const second = { draftAft: 9.995, draftFwd: 9.75, ok: firstOk === false ? false : undefined };
    const solve = vi.fn((t: BallastTargets) => t.relaxedForDraft ? second : { draftAft: 10, draftFwd: 9.75, ok: firstOk });
    const outcome = solveWithDraftRelief(targets, 10.04, solve, result => result);
    expect(outcome.result).toBe(second);
    expect(outcome.trimRelaxed).toBe(true);
    expect(outcome.targets.trimTarget).toBe(0);
  });

  it("压载航段即使超限也只求解一次", () => {
    const ballastTargets = { ...targets, dmMin: 6 };
    expect(draftRelaxedTargets(ballastTargets)).toBeUndefined();
    const solve = vi.fn(() => ({ draftAft: 10, draftFwd: 9 }));
    expect(solveWithDraftRelief(ballastTargets, 4, solve, result => result).trimRelaxed).toBe(false);
    expect(solve).toHaveBeenCalledTimes(1);
  });
});

describe("满载离港的快速与精算配平", () => {
  let voyage: StowVoyage;
  let plan: StowPlan;
  let stage: StageState;
  let original: StageFloating;
  let relaxed: StageFloating;
  let precise: PreciseFloating;

  beforeAll(() => {
    voyage = structuredClone(findSampleVoyage("single-meoh-draft")!.voyage);
    voyage.parcels[0].quantityMt = 30_000;
    delete voyage.parcels[0].intake;
    voyage.calls = voyage.calls.map(call => ({ ...call, maxDraftM: 12 }));
    const result = solvePrestow(ship, voyage, { maxPlans: 1 });
    if (result.status === "invalid" || !result.plans.length) throw new Error("测试航次未找到方案");
    plan = result.plans[0];
    stage = plan.stages[0];
    original = stage.floating!;
    voyage.calls[0].maxDraftM = deepest(original) - 0.01;
    relaxed = stageFloating(ship, voyage, stage, voyage.calls[0], false, stage.consumables!.departure);
    precise = precisePlanStages(ship, voyage, plan).L1.floating!;
  });

  it("原窗口临界超限时放宽生效，最深吃水下降且窗口校核通过", () => {
    const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
    const lightship = lightshipSummary();
    const { fuelMt, freshWaterMt } = stage.consumables!.departure;
    const weight = lightship.weight + fuelMt + freshWaterMt + constants.constantsMt + stage.totalWeight;
    const moment = lightship.weight * lightship.lcg + fuelMt * constants.bunkersLcg
      + freshWaterMt * constants.freshWaterLcg + constants.constantsMt * constants.constantsLcg + stage.totalWeight * stage.lcgM;
    let vertical = lightship.weight * lightship.vcg + fuelMt * constants.bunkersVcg
      + freshWaterMt * constants.freshWaterVcg + constants.constantsMt * constants.constantsVcg;
    for (const tank of ship.tanks) {
      const load = stage.tanks[tank.id];
      if (!load) continue;
      vertical += load.weight * tank.vcg;
      if (load.volume / tank.cap100 < 0.98) {
        const capacity = tankCapacity(tank.id);
        vertical += tankAtLevel(tank.id, (capacity.bottom + capacity.top) / 2).iT * load.weight / load.volume;
      }
    }
    const window = stageBallastTargets(ship, voyage, stage, voyage.calls[0]);
    const before = fastAutoBallast(weight, moment / weight, vertical / weight, original.waterDensity, solverBallastTargets(window));
    expect(deepest(before)).toBeCloseTo(deepest(original), 10);
    expect(voyage.calls[0].maxDraftM! - deepest(before)).toBeLessThan(DRAFT_RELIEF_TRIGGER_M);
    expect(relaxed.trimRelaxed).toBe(true);
    expect(relaxed.trim).toBeGreaterThanOrEqual(RELAXED_TRIM_MIN_M);
    expect(relaxed.trim).toBeLessThanOrEqual(window.trimMax);
    expect(deepest(relaxed)).toBeLessThan(deepest(before));
    expect(relaxed.ballastRule).toMatchObject({ trimMin: RELAXED_TRIM_MIN_M, trimTarget: 0, trimMax: window.trimMax, ok: true });
  });

  it("港限抬高一米后不放宽，艏艉吃水及各舱压载与改动前逐项相等", () => {
    const raised = stageFloating(ship, voyage, stage, { ...voyage.calls[0], maxDraftM: voyage.calls[0].maxDraftM! + 1 }, false, stage.consumables!.departure);
    expect(raised.trimRelaxed).toBe(false);
    expect(raised.draftAft).toBe(9.844697880153621);
    expect(raised.draftFwd).toBe(9.594697819928186);
    expect(raised.ballastMt).toBe(1091.6143676433676);
    expect(raised.ballastTanks.map(tank => [tank.id, tank.weight])).toEqual([
      ["WB2P", 498.9559807478283], ["WB2S", 498.9559807478283], ["APT", 93.70240614771096],
    ]);
  });

  it("空船压载态在低港限下不放宽", () => {
    const empty = plan.stages[1];
    const call = { ...voyage.calls[1], maxDraftM: 4 };
    expect(draftRelaxedTargets(stageBallastTargets(ship, voyage, empty, call))).toBeUndefined();
    expect(stageFloating(ship, voyage, empty, call, false).trimRelaxed).toBe(false);
  });

  it("精算也采用放宽窗口，两模型吃水差不超过旧差值加五厘米", () => {
    expect(precise.trimRelaxed).toBe(true);
    expect(precise.ballastRule).toMatchObject({ trimMin: RELAXED_TRIM_MIN_M, trimTarget: 0, ok: true });
    const oldDifference = 10.043620994669098 - 9.844697880153621;
    expect(Math.abs(deepest(precise) - deepest(relaxed))).toBeLessThanOrEqual(oldDifference + 0.05);
  });

  it("可换裕量非负且符合艏艉最大吃水减中吃水，放宽后明显下降", () => {
    for (const floating of [original, relaxed, precise, ...plan.stages.flatMap(item => [item.floating!, ...(item.arrival ? [item.arrival] : [])])]) {
      expect(floating.trimReliefM).toBeGreaterThanOrEqual(0);
      expect(floating.trimReliefM).toBeCloseTo(deepest(floating) - floating.draftMid, 6);
    }
    expect(relaxed.trimReliefM!).toBeLessThan(original.trimReliefM! / 2);
    expect(precise.trimReliefM!).toBeLessThan((10.043620994669098 - 9.93681198484273) / 2);
  });

  it("到港和离港展示均承接各自精算的放宽标记与可换裕量", () => {
    const views = planStageViews(plan, { L1: { floating: precise }, D1: { arrival: precise } });
    for (const floating of [views.L1.stage.floating!, views.D1.stage.arrival!]) {
      expect(floating.trimRelaxed).toBe(precise.trimRelaxed);
      expect(floating.trimReliefM).toBe(precise.trimReliefM);
    }
  });

  it("已放宽仍超限的无解诊断追加配平说明", () => {
    const limited = { ...voyage, calls: voyage.calls.map(call => ({ ...call, maxDraftM: 4 })) };
    const diagnosis = diagnoseInfeasibility({
      ship, voyage: limited, found: { rejectedByDraft: 1, firstRejected: plan.allocations },
      prepared: [], pair: { ok: {}, conflicts: [] }, adj: new Map(), groupsFor: () => [],
    });
    expect(diagnosis.reasons.find(reason => reason.code === "draft")?.message).toContain("(已按平吃水配平仍超限)");
  });

  it.each([
    { arrivalMargin: -0.2, departureMargin: 0.01, text: "调平吃水可换出 0.10 m · 仍差 0.10 m" },
    { arrivalMargin: 0.01, departureMargin: 0.01, text: "调平吃水可换出 0.10 m · 可解" },
    { arrivalMargin: 0.02, departureMargin: 0.01, text: "已放宽纵倾至平吃水" },
  ])("时间线取较小裕量时点，相等时取到港：$text", ({ arrivalMargin, departureMargin, text }) => {
    const html = renderToStaticMarkup(React.createElement(StageTimeline, {
      stages: [{ ...stage, arrival: { ...original, draftMargin: arrivalMargin, trimReliefM: 0.1 }, floating: { ...relaxed, draftMargin: departureMargin } }],
      calls: [voyage.calls[0]], selected: 0, onSelect: () => {}, minMarginStage: 0,
    }));
    expect(html).toContain(text);
  });
});

describe("调纵倾提示", () => {
  it("未提供裕量或裕量充足时不提示", () => {
    expect(trimReliefHint(undefined)).toBeNull();
    expect(trimReliefHint({ trimReliefM: 1 })).toBeNull();
    expect(trimReliefHint({ draftMargin: 0.06, trimReliefM: 0.2, trimRelaxed: true })).toBeNull();
    expect(trimReliefHint({ draftMargin: 0, trimReliefM: 0.019 })).toBeNull();
  });
  it("临界且可解时给出可换裕量", () => {
    expect(trimReliefHint({ draftMargin: 0.05, trimReliefM: 0.02 })).toEqual({ reliefM: 0.02, enough: true, relaxed: false });
  });
  it("超限且仍差时标记不可解", () => {
    expect(trimReliefHint({ draftMargin: -0.2, trimReliefM: 0.1 })).toEqual({ reliefM: 0.1, enough: false, relaxed: false });
  });
  it("已放宽时保留提示并按一厘米容差判定", () => {
    expect(trimReliefHint({ draftMargin: -0.01, trimRelaxed: true })).toEqual({ reliefM: 0, enough: true, relaxed: true });
    expect(trimReliefHint({ draftMargin: -0.02, trimReliefM: 0.01, trimRelaxed: true })).toEqual({ reliefM: 0, enough: false, relaxed: true });
    expect(trimReliefHint({ draftMargin: -0.1, trimReliefM: 0.1, trimRelaxed: true })).toEqual({ reliefM: 0.1, enough: true, relaxed: true });
  });
});
