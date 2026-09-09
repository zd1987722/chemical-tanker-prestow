import { areaUnder, gzMaxOf } from "./engine";
import type { Criterion, GzPoint } from "./types";

function criterion(
  id: string,
  name: string,
  required: string,
  value: number,
  limit: number,
  pass: boolean,
  unit: string,
): Criterion {
  return {
    id,
    name,
    required,
    actual: `${value.toFixed(3)}${unit}`,
    value,
    limit,
    pass,
  };
}

export function generalCriteria(
  curve: GzPoint[],
  gmCorrected: number,
  floodAngle: number | null,
): Criterion[] {
  const upper = Math.min(40, floodAngle ?? 40);
  const area0to30 = areaUnder(curve, 0, 30);
  const area0to40 = areaUnder(curve, 0, upper);
  const area30to40 = areaUnder(curve, 30, upper);
  const eligibleGz = curve.filter(point => point.heel >= 30 && point.heel <= upper);
  const gzAtOrAbove30 = eligibleGz.length > 0
    ? Math.max(...eligibleGz.map(point => point.gz))
    : Number.NEGATIVE_INFINITY;
  const maximum = gzMaxOf(curve);

  return [
    criterion("2.2.1a", "0–30° 稳性面积", "≥ 0.055 m·rad", area0to30, 0.055, area0to30 >= 0.055, " m·rad"),
    criterion("2.2.1b", `0–${upper.toFixed(1)}° 稳性面积`, "≥ 0.090 m·rad", area0to40, 0.09, area0to40 >= 0.09, " m·rad"),
    criterion("2.2.1c", `30–${upper.toFixed(1)}° 稳性面积`, "≥ 0.030 m·rad", area30to40, 0.03, area30to40 >= 0.03, " m·rad"),
    criterion("2.2.2", "30°以上复原力臂", "≥ 0.20 m", gzAtOrAbove30, 0.2, gzAtOrAbove30 >= 0.2, " m"),
    criterion("2.2.3", "最大 GZ 角", "≥ 25°", maximum.angle, 25, maximum.angle >= 25, "°"),
    criterion("2.2.4", "自由液面修正后 GM", "≥ 0.15 m", gmCorrected, 0.15, gmCorrected >= 0.15, " m"),
  ];
}
