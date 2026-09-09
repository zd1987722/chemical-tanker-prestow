import { tankCapacity } from "../hull";
import { computeStrength } from "../strength";
import type { StrengthInput } from "../strength";

export interface FastStrengthResult {
  sfPct: number;
  bmPct: number;
  pass: boolean;
}

export function fastStrength(
  stageWeights: { compId: string; weight: number; level?: number }[],
  constants: StrengthInput["constants"],
  floating: StrengthInput["floating"]
): FastStrengthResult {
  const result = computeStrength(
    {
      tanks: stageWeights.map(item => ({
        compId: item.compId,
        weight: item.weight,
        level: item.level ?? tankCapacity(item.compId).top,
      })),
      constants,
      floating,
    },
    "sea"
  );

  return {
    sfPct: result.maxSfPct.pct,
    bmPct: result.maxBmPct.pct,
    pass: result.pass,
  };
}
