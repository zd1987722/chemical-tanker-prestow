import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resetRuntimeExceptionsForTest,
  setRuntimeExceptions,
} from "../appendix-i-exceptions";
import { computeCondition } from "../loadcalc/engine";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { solvePrestow } from "./engine";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { stageToCondition } from "./to-condition";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

describe("预配载方案送到装载计算", () => {
  it("首方案 D1 站生成工况的船中吃水与预配载浮态相差小于 0.1 m", () => {
    const result = solvePrestow(DEMO_STOW_SHIP, SAMPLE_VOYAGE, { maxPlans: 1 });
    if (result.status === "invalid") throw new Error(result.errors.join("；"));
    const plan = result.plans[0];
    const stageIndex = plan.stages.findIndex(stage => stage.callId === "D1");
    const expectedDraft = plan.stages[stageIndex].floating?.draftMid;
    expect(expectedDraft).toBeTypeOf("number");

    const condition = stageToCondition(
      DEMO_STOW_SHIP,
      SAMPLE_VOYAGE,
      plan,
      stageIndex,
      "样例航次 D1"
    );
    const computed = computeCondition(condition);
    const rob = plan.stages[stageIndex].consumables!.departure;
    expect(computed.tanks.filter(tank => /^HFO/.test(tank.compId)).reduce((sum, tank) => sum + tank.weight, 0)).toBeCloseTo(rob.fuelMt, 3);
    expect(computed.tanks.filter(tank => /^FW/.test(tank.compId)).reduce((sum, tank) => sum + tank.weight, 0)).toBeCloseTo(rob.freshWaterMt, 3);
    const actualDraft = computed.floating.draftMid;

    expect(condition.note).not.toContain("未提供压载舱结果");
    expect(Math.abs(actualDraft - expectedDraft!)).toBeLessThan(0.1);
  });
});
