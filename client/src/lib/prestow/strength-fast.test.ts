import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resetRuntimeExceptionsForTest,
  setRuntimeExceptions,
} from "../appendix-i-exceptions";
import { tankFill } from "../hull";
import { computeStrength } from "../strength";
import type { StrengthInput } from "../strength";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { DEFAULT_CONSTANTS, solvePrestow } from "./engine";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { fastStrength } from "./strength-fast";

beforeAll(() => setRuntimeExceptions([], []));
afterAll(() => resetRuntimeExceptionsForTest());

describe("fastStrength", () => {
  it("样例首方案 L1/L2/D1 与 computeStrength 相差不超过 10 个百分点，且每站小于 15 ms", () => {
    const result = solvePrestow(DEMO_STOW_SHIP, SAMPLE_VOYAGE, {
      maxPlans: 20,
    });
    if (result.status === "invalid") throw new Error(result.errors.join("；"));

    const voyageConstants = {
      ...DEFAULT_CONSTANTS,
      ...SAMPLE_VOYAGE.constants,
    };
    const constants: StrengthInput["constants"] = [
      {
        weight: voyageConstants.bunkersMt,
        lcg: voyageConstants.bunkersLcg,
      },
      {
        weight: voyageConstants.freshWaterMt,
        lcg: voyageConstants.freshWaterLcg,
      },
      {
        weight: voyageConstants.constantsMt,
        lcg: voyageConstants.constantsLcg,
      },
    ];

    const plan = result.plans[0];
    for (const callId of ["L1", "L2", "D1"]) {
      const stage = plan.stages.find(item => item.callId === callId);
      if (!stage?.floating) throw new Error(`样例首方案缺少 ${callId} 浮态`);
      const { floating } = stage;
      const tanks: StrengthInput["tanks"] = [
        ...Object.entries(stage.tanks).flatMap(([compId, load]) =>
          load
            ? [{
                compId,
                weight: load.weight,
                level: tankFill(compId, load.volume).level,
              }]
            : []
        ),
        ...floating.ballastTanks.map(tank => ({
          compId: tank.id,
          weight: tank.weight,
          level: tankFill(
            tank.id,
            tank.weight / floating.waterDensity
          ).level,
        })),
      ];
      const inputFloating: StrengthInput["floating"] = {
        draftMid: floating.draftMid,
        trim: floating.trim,
        waterDensity: floating.waterDensity,
      };

      const startedAt = performance.now();
      const fast = fastStrength(tanks, constants, inputFloating);
      const elapsedMs = performance.now() - startedAt;
      const exact = computeStrength(
        { tanks, constants, floating: inputFloating },
        "sea"
      );

      expect(Math.abs(fast.sfPct - exact.maxSfPct.pct)).toBeLessThanOrEqual(10);
      expect(Math.abs(fast.bmPct - exact.maxBmPct.pct)).toBeLessThanOrEqual(10);
      expect(elapsedMs).toBeLessThan(15);
      expect(fast.pass).toBe(exact.pass);
    }
  });
});
