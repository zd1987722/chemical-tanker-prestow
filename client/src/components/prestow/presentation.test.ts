import { describe, expect, it } from "vitest";
import { draftMarginVerdict, parcelVisualMap } from "./presentation";

describe("吃水裕量显示边界", () => {
  it.each([
    [undefined, "none"], [null, "none"], [NaN, "none"], [Infinity, "none"],
    [-0.0101, "fail"], [-0.01, "warn"], [0, "warn"], [0.05, "warn"], [0.0501, "none"],
  ] as const)("%s 显示为 %s", (margin, verdict) => {
    expect(draftMarginVerdict(margin)).toBe(verdict);
  });
});

it("同名分票保留独立票号，不依赖颜色区分", () => {
  const visuals = parcelVisualMap([{ id: "a", display: "甲醇" }, { id: "b", display: "甲醇" }]);
  expect(visuals.a.color).toBe(visuals.b.color);
  expect(visuals.a.label).toBe("票01");
  expect(visuals.b.label).toBe("票02");
});
