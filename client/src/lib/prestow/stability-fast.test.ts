import { describe, expect, it } from "vitest";
import knData from "../hull/data/kn.json";
import { computeCondition } from "../loadcalc/engine";
import { sampleCondition } from "../loadcalc/samples";
import { areaUnder, computeStability } from "../stability";
import { fastStability } from "./stability-fast";

describe("fastStability", () => {
  it("同工况与完整稳性 GM 差 < 0.05 m、面积差 < 10%", () => {
    const condition = computeCondition(sampleCondition("fullLoad"));
    const total = condition.groups.total;
    const exact = computeStability({
      weight: total.weight,
      lcg: total.lcg,
      tcg: total.tcg,
      vcg: total.vcg,
      fsmTotal: condition.fsmTotal,
      rho: condition.floating.waterDensity,
      trim: condition.floating.trim,
      draftMid: condition.floating.draftMid,
    });
    const fast = fastStability(
      total.weight,
      exact.kgCorrected,
      total.tcg,
      condition.floating.waterDensity,
    );

    expect(Math.abs(fast.gmCorrected - exact.gmCorrected)).toBeLessThan(0.05);
    expect(
      Math.abs(
        areaUnder(fast.curve, 0, 40) - areaUnder(exact.curve, 0, 40),
      ) / areaUnder(exact.curve, 0, 40),
    ).toBeLessThan(0.1);
  });

  it("KN 对排水量与横倾角作双线性插值", () => {
    const result = fastStability(56_250, 0, 0, 1.025);
    const point = result.curve.find(item => item.heel === 35)!;
    const dispLower = knData.disp.indexOf(55_000);
    const dispUpper = knData.disp.indexOf(57_500);
    const heelLower = knData.heel.indexOf(30);
    const heelUpper = knData.heel.indexOf(40);
    const expected =
      (knData.kn[dispLower][heelLower] +
        knData.kn[dispLower][heelUpper] +
        knData.kn[dispUpper][heelLower] +
        knData.kn[dispUpper][heelUpper]) /
      4;

    expect(point.kn).toBeCloseTo(expected, 8);
  });

  it("相同排水体积在海水与淡水中得到相同 KN", () => {
    const sea = fastStability(50_000, 0, 0, 1.025);
    const fresh = fastStability(50_000 / 1.025, 0, 0, 1);
    expect(fresh.curve.map(point => point.kn)).toEqual(
      sea.curve.map(point => point.kn),
    );
  });
});
