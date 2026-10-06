/**
 * 样船(合成数据)—— MR 型化学品船。
 * 数据来源于一条真实船的舱容图经匿名化与合成:舱容取整到 10 m³ 并 P/S 对称化,
 * LCG/TCG/VCG 取整到 0.1 m,肋位号删除改用邻接关系,涂层改为不锈钢。
 * 真实船名、IMO、船厂编号、图号不进入本仓库。
 */
import type { StowShip, StowTank, BallastTank } from "./types";

// [站, cap100, lcg, |tcg|, vcg]
const STATIONS: [number, number, number, number, number][] = [
  [1, 2980, 151.7, 4.6, 11.3],
  [2, 2790, 135.5, 6.6, 11.0],
  [3, 2960, 122.4, 7.0, 11.0],
  [4, 2970, 109.2, 7.0, 11.0],
  [5, 2970, 96.0, 7.0, 11.0],
  [6, 2970, 82.8, 7.0, 11.0],
  [7, 2970, 69.6, 7.0, 11.0],
  [8, 2920, 56.5, 7.0, 11.1],
  [9, 2510, 43.9, 6.7, 11.5],
  [10, 545, 36.2, 6.4, 11.8], // Slop
];

function tankLabel(station: number, side: "P" | "S") {
  return station === 10 ? `SLOP ${side}` : `CT${station}${side}`;
}

const tanks: StowTank[] = STATIONS.flatMap(([station, cap100, lcg, tcg, vcg]) =>
  (["P", "S"] as const).map(side => ({
    id: `${station}${side}`,
    label: tankLabel(station, side),
    station,
    side,
    cap100,
    lcg,
    tcg: side === "S" ? tcg : -tcg,
    vcg,
  }))
);

// [编号, cap100, 相邻货舱站号]
const BALLAST: [number, number, number[]][] = [
  [1, 1930, [1]],
  [2, 1090, [2]],
  [3, 2090, [3, 4]],
  [4, 2100, [5, 6]],
  [5, 2030, [7, 8]],
  [6, 1320, [9, 10]],
];

const ballast: BallastTank[] = BALLAST.flatMap(([n, cap100, stations]) =>
  (["P", "S"] as const).map(side => ({
    id: `WB${n}${side}`,
    label: `No.${n} WB ${side}`,
    cap100,
    adjacentCargoTanks: stations.map(st => `${st}${side}`),
  }))
);

export function computeRefLcg(ts: StowTank[]): number {
  const cap = ts.reduce((a, t) => a + t.cap100, 0);
  return ts.reduce((a, t) => a + t.cap100 * t.lcg, 0) / cap;
}

export const SAMPLE_SHIP: StowShip = {
  id: "sample-mr",
  label: "样船(合成数据)· MR 型化学品船",
  synthetic: true,
  lbp: 175,
  breadth: 32,
  ibcType: 2,
  coating: "stainless",
  maxCargoTempC: 90,
  maxDraftM: 13,
  refLcg: computeRefLcg(tanks),
  tanks,
  ballast,
  cofferdams: [],
};
