import { describe, expect, it } from "vitest";
import { solveEquilibrium } from "../loadcalc/engine";
import { fastFloating } from "./hydro-fast";

describe("fastFloating", () => {
  it.each([[30000, 90], [45000, 86], [57000, 88.5]])(
    "W=%d LCG=%d:与精算差 < 0.05 m",
    (weight, lcg) => {
      const fast = fastFloating(weight, lcg, 1.025);
      const exact = solveEquilibrium(weight, lcg, 0, 10, 1.025);
      expect(Math.abs(fast.draftAft - exact.props.draftAft)).toBeLessThan(0.05);
      expect(Math.abs(fast.draftFwd - exact.props.draftFwd)).toBeLessThan(0.05);
    },
  );

  it("淡水更深;LCG 后移 → 尾倾增大", () => {
    expect(fastFloating(45000, 88, 1).draftMid).toBeGreaterThan(
      fastFloating(45000, 88, 1.025).draftMid,
    );
    expect(fastFloating(45000, 84, 1.025).trim).toBeGreaterThan(
      fastFloating(45000, 88, 1.025).trim,
    );
  });

  it("性能:1000 次 < 100 ms(表已建)", () => {
    fastFloating(40000, 88);
    const startedAt = performance.now();
    for (let i = 0; i < 1000; i++) {
      fastFloating(30000 + i * 20, 85 + (i % 7), 1.02);
    }
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
