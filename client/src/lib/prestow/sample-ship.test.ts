import { describe, it, expect } from "vitest";
import { SAMPLE_SHIP, computeRefLcg } from "./sample-ship";
import { deriveAdjacency } from "../voyage";

describe("SAMPLE_SHIP(样船·合成数据)", () => {
  it("20 个货舱、12 个压载舱,P/S 对称", () => {
    expect(SAMPLE_SHIP.tanks).toHaveLength(20);
    expect(SAMPLE_SHIP.ballast).toHaveLength(12);
    for (let st = 1; st <= 10; st++) {
      const p = SAMPLE_SHIP.tanks.find(t => t.id === `${st}P`)!;
      const s = SAMPLE_SHIP.tanks.find(t => t.id === `${st}S`)!;
      expect(p.cap100).toBe(s.cap100);
      expect(p.tcg).toBe(-s.tcg);
      expect(s.tcg).toBeGreaterThan(0);
    }
  });
  it("总舱容约 53,170 m³;Slop 舱 545 m³", () => {
    const total = SAMPLE_SHIP.tanks.reduce((a, t) => a + t.cap100, 0);
    expect(total).toBe(53170);
    expect(SAMPLE_SHIP.tanks.find(t => t.id === "10P")!.cap100).toBe(545);
  });
  it("refLcg 为舱容加权 LCG,落在 90–100 m", () => {
    expect(SAMPLE_SHIP.refLcg).toBe(computeRefLcg(SAMPLE_SHIP.tanks));
    expect(SAMPLE_SHIP.refLcg).toBeGreaterThan(90);
    expect(SAMPLE_SHIP.refLcg).toBeLessThan(100);
  });
  it("舱号兼容 deriveAdjacency(8 向,斜对角也算相邻):1P-1S、1P-2P、1P-2S 相邻,1P-3P 不相邻", () => {
    const adj = deriveAdjacency(SAMPLE_SHIP.tanks.map(t => t.id), SAMPLE_SHIP.cofferdams);
    const has = (a: string, b: string) => adj.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    expect(has("1P", "1S")).toBe(true);
    expect(has("1P", "2P")).toBe(true);
    expect(has("9S", "10S")).toBe(true);
    expect(has("1P", "2S")).toBe(true);
    expect(has("1P", "3P")).toBe(false);
  });
  it("压载舱邻接引用的货舱都存在,且每个压载舱同侧", () => {
    const ids = new Set(SAMPLE_SHIP.tanks.map(t => t.id));
    for (const wb of SAMPLE_SHIP.ballast) {
      expect(wb.adjacentCargoTanks.length).toBeGreaterThan(0);
      for (const t of wb.adjacentCargoTanks) {
        expect(ids.has(t)).toBe(true);
        expect(t.endsWith(wb.id.slice(-1))).toBe(true);
      }
    }
    expect(SAMPLE_SHIP.synthetic).toBe(true);
    expect(SAMPLE_SHIP.label).toContain("样船(合成数据)");
  });
});
