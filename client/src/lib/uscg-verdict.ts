/**
 * USCG 相容性判定(含 46 CFR Appendix I 例外覆盖)—— 单对检查与航次相邻共用。
 * 规则:
 *   - 基线:Figure 1 矩阵(INCOMPATIBLE_PAIRS)。
 *   - 禁止例外(b):矩阵相容但禁止 → 改判不相容(更保守优先)。
 *   - 允许例外(a):矩阵不相容但已测试允许 → 改判相容。
 */
import { INCOMPATIBLE_PAIRS, USCG_GROUPS } from "./uscg-compatibility-data";
import {
  findAllowedException,
  findProhibitedException,
  getAppendixIExceptionStatus,
  nameMatch,
} from "./appendix-i-exceptions";

export type PairException = "allowed" | "prohibited" | null;

/** 是否为官方有效反应族(1-22, 30-43)。group 0/未归类/非法均 false。 */
export function isValidGroup(g: number | null | undefined): boolean {
  return g != null && USCG_GROUPS[g] !== undefined;
}

export function chartIncompatible(g1: number, g2: number): boolean {
  if (g1 === g2) return false;
  const key = g1 < g2 ? `${g1}-${g2}` : `${g2}-${g1}`;
  return INCOMPATIBLE_PAIRS.has(key);
}

export interface PairVerdict {
  known: boolean; // 是否两侧分组齐全可判定
  isCompatible: boolean;
  exception: PairException;
  reference?: string;
}

export function evaluateCompat(
  g1: number | null | undefined,
  g2: number | null | undefined,
  name1?: string,
  name2?: string
): PairVerdict {
  if (g1 == null || g2 == null)
    return { known: false, isCompatible: false, exception: null };

  const prohibited = findProhibitedException(g1, g2, name1, name2);
  const allowed = findAllowedException(g1, g2, name1, name2);

  // group 0 / 未归类 / 非官方有效组:不可按矩阵判定,
  // 仅当有 Appendix I 例外时判定,否则视为「未知·须个别评估」(不默认相容)。
  if (!isValidGroup(g1) || !isValidGroup(g2)) {
    // 禁止例外已按物质名匹配,可直接采信
    if (prohibited)
      return {
        known: true,
        isCompatible: false,
        exception: "prohibited",
        reference: "46 CFR 150.170 Appendix I (b)",
      };
    // 允许例外是按分组对匹配的;group 0 是 catch-all,须额外校验物质名相符才采信
    if (allowed) {
      const namesOk =
        (nameMatch(allowed.substance1, name1) &&
          nameMatch(allowed.substance2, name2)) ||
        (nameMatch(allowed.substance1, name2) &&
          nameMatch(allowed.substance2, name1));
      if (namesOk)
        return {
          known: true,
          isCompatible: true,
          exception: "allowed",
          reference: "46 CFR 150.170 Appendix I (a)",
        };
    }
    return { known: false, isCompatible: false, exception: null };
  }

  const chartInc = chartIncompatible(g1, g2);
  const exceptionsLoaded = getAppendixIExceptionStatus() === "loaded";

  if (!exceptionsLoaded && !chartInc) {
    return {
      known: false,
      isCompatible: false,
      exception: null,
      reference: "Appendix I exception data unavailable",
    };
  }

  // 禁止例外优先(安全保守):矩阵相容 + 禁止例外 → 不相容
  if (!chartInc && prohibited) {
    return {
      known: true,
      isCompatible: false,
      exception: "prohibited",
      reference: "46 CFR 150.170 Appendix I (b)",
    };
  }
  // 允许例外:矩阵不相容 + 允许例外 → 相容
  if (chartInc && allowed) {
    return {
      known: true,
      isCompatible: true,
      exception: "allowed",
      reference: "46 CFR 150.170 Appendix I (a)",
    };
  }
  return { known: true, isCompatible: !chartInc, exception: null };
}
