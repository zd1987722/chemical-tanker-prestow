import knData from "../hull/data/kn.json";
import { generalCriteria } from "../stability";
import type { GzPoint } from "../stability";
import { fastFloating } from "./hydro-fast";

const DEG_TO_RAD = Math.PI / 180;
const HEELS = Array.from({ length: 17 }, (_, index) => index * 5);

function bracket(values: number[], value: number): [number, number, number] {
  if (value <= values[0]) return [0, 0, 0];
  const last = values.length - 1;
  if (value >= values[last]) return [last, last, 0];

  let lower = 0;
  let upper = last;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (values[middle] <= value) lower = middle;
    else upper = middle;
  }
  return [lower, upper, (value - values[lower]) / (values[upper] - values[lower])];
}

function knAt(weight: number, heel: number): number {
  const [dispLower, dispUpper, dispFraction] = bracket(knData.disp, weight);
  const [heelLower, heelUpper, heelFraction] = bracket(knData.heel, heel);
  const atHeel = (dispIndex: number) => {
    const lower = knData.kn[dispIndex][heelLower];
    const upper = knData.kn[dispIndex][heelUpper];
    return lower + heelFraction * (upper - lower);
  };
  const lower = atHeel(dispLower);
  const upper = atHeel(dispUpper);
  return lower + dispFraction * (upper - lower);
}

export function fastStability(
  weight: number,
  kgCorrected: number,
  tcg: number,
  rho: number,
  kmT = fastFloating(weight, 0, rho).kmT,
): { gmCorrected: number; pass: boolean; note?: string; curve: GzPoint[] } {
  const gmCorrected = kmT - kgCorrected;
  const referenceDisplacement = (weight * 1.025) / rho;
  const curve = HEELS.map(heel => {
    const radians = heel * DEG_TO_RAD;
    const kn = knAt(referenceDisplacement, heel);
    return {
      heel,
      kn,
      // 只算向重心偏移一侧倾斜的不利曲线:|tcg| 保证 P/S 镜像配载得到同一判定(枚举按镜像去重)
      gz: kn - kgCorrected * Math.sin(radians) - Math.abs(tcg) * Math.cos(radians),
    };
  });
  const failed = generalCriteria(curve, gmCorrected, null).find(item => !item.pass);
  return {
    gmCorrected,
    pass: failed == null,
    note: failed?.name,
    curve,
  };
}
