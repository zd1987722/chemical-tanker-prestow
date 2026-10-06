import { describe, it, expect } from "vitest";
import { SAMPLE_SHIP } from "./sample-ship";
import { scorePlan, comparePlans } from "./rank";
import type { StowPlan, StageState } from "./types";

const stage = (over: Partial<StageState>): StageState => ({ callId: "x", tanks: {}, totalWeight: 1, heelMomentTm: 0, lcgM: SAMPLE_SHIP.refLcg, ...over });
const plan = (tanks: string[][], stages: StageState[] = [stage({})], advisories = 0, stabilityOk = true, strengthOk = true): StowPlan => {
  const p: StowPlan = {
    key: tanks.map(t => t.join("+")).join("|"),
    allocations: tanks.map((t, i) => ({ parcelId: `p${i}`, tanks: t, fillRatio: 0.5 })),
    stages, advisories: Array.from({ length: advisories }, () => ({ code: "ballast-cooling" as const, tankId: "1P", ballastId: "WB1P", parcelId: "p0", callIds: [], message: "" })),
    score: { tanksUsed: 0, unpairedTanks: 0, maxHeelMoment: 0, maxLcgShift: 0, advisoryCount: 0, minGm: 0, maxBmPct: 0 },
    consumablesOk: true,
    stabilityOk,
    strengthOk,
    strengthChecked: true,
  };
  p.score = scorePlan(p, SAMPLE_SHIP);
  return p;
};

describe("scorePlan", () => {
  it("tanksUsed、unpairedTanks", () => {
    const s = plan([["1P", "1S"], ["3P"]]).score;
    expect(s.tanksUsed).toBe(3);
    expect(s.unpairedTanks).toBe(1);
  });
  it("maxHeelMoment / maxLcgShift 取非空阶段最大绝对值;空阶段忽略", () => {
    const s = plan([["1P"]], [stage({ heelMomentTm: -300 }), stage({ heelMomentTm: 120, lcgM: SAMPLE_SHIP.refLcg + 4 }), stage({ totalWeight: 0, heelMomentTm: 9999 })]).score;
    expect(s.maxHeelMoment).toBe(300);
    expect(s.maxLcgShift).toBeCloseTo(4);
  });
});

describe("comparePlans(字典序)", () => {
  it("稳性合格键优先于用舱数", () => {
    const stable = plan([["1P", "1S"]]);
    const unstable = plan([["2P"]], [stage({})], 0, false);
    expect(comparePlans(stable, unstable)).toBeLessThan(0);
  });
  it("强度不合格与稳性不合格同级后置", () => {
    const passing = plan([["1P", "1S"]]);
    const strengthFailed = plan([["2P"]], [stage({})], 0, true, false);
    const stabilityFailed = plan([["2P"]], [stage({})], 0, false, true);
    expect(comparePlans(passing, strengthFailed)).toBeLessThan(0);
    expect(comparePlans(passing, stabilityFailed)).toBeLessThan(0);
    expect(comparePlans(strengthFailed, stabilityFailed)).toBe(0);
  });
  it("用舱少者在前", () => {
    expect(comparePlans(plan([["1P", "1S"]]), plan([["1P", "1S", "2P"]]))).toBeLessThan(0);
  });
  it("同舱数:成对者在前", () => {
    expect(comparePlans(plan([["1P", "1S"]]), plan([["1P", "2P"]]))).toBeLessThan(0);
  });
  it("同舱数同成对:横倾分桶(100 t·m)小者在前;桶内相同看提示数,再看 key", () => {
    const a = plan([["1P"]], [stage({ heelMomentTm: 40 })]);
    const b = plan([["2P"]], [stage({ heelMomentTm: 260 })]);
    expect(comparePlans(a, b)).toBeLessThan(0);
    const c = plan([["1P"]], [stage({ heelMomentTm: 40 })], 1);
    expect(comparePlans(a, c)).toBeLessThan(0);
    const d = plan([["1P"]], [stage({ heelMomentTm: 120 })]);
    const e = plan([["1S"]], [stage({ heelMomentTm: 140 })]);
    expect(comparePlans(d, e)).toBe(d.key.localeCompare(e.key));
  });
  it("提示数相同时,吃水裕量按 0.1 m 分桶降序", () => {
    const a = plan([["1P"]]);
    const b = plan([["2P"]]);
    a.score.minDraftMargin = 0.24;
    b.score.minDraftMargin = 0.11;
    expect(comparePlans(a, b)).toBeLessThan(0);
  });
});


it("consumables failures rank alongside stability failures", () => {
  const passing = plan([["1P", "1S"]]);
  const shortage = { ...plan([["2P"]]), consumablesOk: false };
  const unstable = { ...shortage, consumablesOk: true, stabilityOk: false };
  expect(comparePlans(passing, shortage)).toBeLessThan(0);
  expect(comparePlans(shortage, unstable)).toBe(0);
});
