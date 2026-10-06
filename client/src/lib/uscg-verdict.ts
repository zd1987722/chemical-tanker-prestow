/**
 * USCG 相容性判定(含 46 CFR Appendix I 例外覆盖)—— 单对检查与航次相邻共用。
 * 规则:
 *   - 基线:Figure 1 矩阵(INCOMPATIBLE_PAIRS)。
 *   - 点名禁止例外(b)优先；点名允许例外(a)覆盖整族禁止例外(b)。
 *   - 其余有效分组按 Figure 1 矩阵判定。
 */
import { INCOMPATIBLE_PAIRS, USCG_GROUPS } from "./uscg-compatibility-data";
import {
  findProhibitedExceptionDetailed,
  getAppendixIExceptionStatus,
  getRuntimeExceptions,
  normName,
  unmatchedCargoTokens,
  type AllowedException,
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

const ALLOWED_SYNONYMS: [string, string][] = [
  ["caustic soda", "sodium hydroxide"],
  ["sodium hydroxide", "sodium hydroxide"],
  ["caustic potash", "potassium hydroxide"],
  ["potassium hydroxide", "potassium hydroxide"],
  ["methyl alcohol", "methanol"],
  ["methanol", "methanol"],
  ["ethyl alcohol", "ethanol"],
  ["ethanol", "ethanol"],
  ["tert butyl alcohol", "tert butanol"],
  ["tert butanol", "tert butanol"],
  ["t butanol", "tert butanol"],
  ["isobutyl alcohol", "isobutanol"],
  ["isobutanol", "isobutanol"],
  ["n butyl alcohol", "butanol"],
  ["butyl alcohol", "butanol"],
  ["n butanol", "butanol"],
  ["1 butanol", "butanol"],
  ["butanol", "butanol"],
  ["isopropyl alcohol", "isopropanol"],
  ["isopropanol", "isopropanol"],
  ["2 propanol", "isopropanol"],
  ["n propyl alcohol", "propanol"],
  ["propyl alcohol", "propanol"],
  ["n propanol", "propanol"],
  ["1 propanol", "propanol"],
  ["1 2 propylene glycol", "propylene glycol"],
  ["propylene glycol", "propylene glycol"],
  ["1 2 propanediol", "propylene glycol"],
  ["monoethylene glycol", "ethylene glycol"],
  ["meg", "ethylene glycol"],
];

const ALLOWED_EXTRA_TOKENS = new Set([
  "solution", "solutions", "mixture", "mixtures", "and", "nos",
]);

// 从现有同义短语生成紧凑同义表，仅用于整串替换。
const ALLOWED_COMPACT_SYNONYMS = new Map(
  ALLOWED_SYNONYMS.map(([phrase, canonical]) => [
    phrase.replace(/ /g, ""), canonical.replace(/ /g, ""),
  ])
);

function canonicalAllowedName(name: string): string {
  for (const [phrase, canonical] of ALLOWED_SYNONYMS) {
    name = name.replace(
      new RegExp(`(^| )${phrase}(?= |$)`, "g"),
      (_, prefix: string) => `${prefix}${canonical}`
    );
  }
  return name;
}

/** 允许例外专用：核对同义名、浓度上限和货名中额外的限定词。 */
export function allowedNameMatch(exceptionName: string, cargoName?: string): boolean {
  if (!cargoName) return false;
  const limit = exceptionName.match(/\b(\d+(?:\.\d+)?)\s*%?\s*or\s+less\b/i);
  const limitPct = limit ? Number(limit[1]) : undefined;
  let exception = normName(exceptionName);
  for (const match of Array.from(exceptionName.matchAll(/\b\d+(?:\.\d+)?\s*%?\s*or\s+less\b|\bor\s+less\b|\b\d+(?:\.\d+)?\s*%/gi))) {
    const words = normName(match[0]);
    exception = exception.replace(new RegExp(`(^| )${words.replace(/ /g, "\\s+")}(?= |$)`, "g"), " ");
  }
  exception = canonicalAllowedName(exception.replace(/\s+/g, " ").trim());
  const cargo = canonicalAllowedName(normName(cargoName));
  if (!exception || !cargo) return false;
  if (
    limitPct !== undefined &&
    Array.from(cargoName.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g))
      .some(match => Number(match[1]) > limitPct)
  ) return false;
  if (normName(exceptionName) === normName(cargoName)) return true;
  const remaining = unmatchedCargoTokens(exception, cargo);
  if (remaining !== null && remaining.every(token =>
    ALLOWED_EXTRA_TOKENS.has(token) ||
    /^\d+(?:\.\d+)?$/.test(token) ||
    /^c\d+$/.test(token) ||
    /^[一-龥]+$/.test(token)
  )) return true;

  // 词元匹配失败后再核对连写名称；保留顺序并要求整串相等，避免命中相近物质。
  const excCompact = exception.replace(/ /g, "");
  const cargoCompact = normName(cargoName).split(" ").filter(token =>
    !ALLOWED_EXTRA_TOKENS.has(token) &&
    !/^\d+(?:\.\d+)?$/.test(token) &&
    !/^c\d+$/.test(token) &&
    !/^[一-龥]+$/.test(token) &&
    token !== "or" && token !== "less"
  ).join("");
  return (ALLOWED_COMPACT_SYNONYMS.get(cargoCompact) ?? cargoCompact) ===
    (ALLOWED_COMPACT_SYNONYMS.get(excCompact) ?? excCompact);
}

/** 两侧物质名均须命中同一条允许例外，顺序可以互换。 */
export function allowedPairMatches(
  exc: AllowedException,
  name1?: string,
  name2?: string
): boolean {
  if (!name1 || !name2) return false;
  return (
    (allowedNameMatch(exc.substance1, name1) && allowedNameMatch(exc.substance2, name2)) ||
    (allowedNameMatch(exc.substance1, name2) && allowedNameMatch(exc.substance2, name1))
  );
}

/** 遍历同族对的所有允许例外，返回实际命中物质对的一条。 */
export function findMatchingAllowedException(
  g1: number,
  g2: number,
  name1?: string,
  name2?: string
): AllowedException | null {
  if (!name1 || !name2) return null;
  return (
    getRuntimeExceptions().allowed.find(
      exc =>
        ((exc.group1 === g1 && exc.group2 === g2) ||
          (exc.group1 === g2 && exc.group2 === g1)) &&
        allowedPairMatches(exc, name1, name2)
    ) || null
  );
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

  const prohibited = findProhibitedExceptionDetailed(g1, g2, name1, name2);
  const allowed = findMatchingAllowedException(g1, g2, name1, name2);

  // group 0 / 未归类 / 非官方有效组:不可按矩阵判定,
  // 仅当有 Appendix I 例外时判定,否则视为「未知·须个别评估」(不默认相容)。
  if (!isValidGroup(g1) || !isValidGroup(g2)) {
    // 点名禁止先于允许例外。
    if (prohibited?.kind === "named")
      return {
        known: true,
        isCompatible: false,
        exception: "prohibited",
        reference: "46 CFR 150.170 Appendix I (b)",
      };
    // 允许例外须核对具体物质对；group 0 不能仅凭分组采信。
    if (allowed)
      return {
        known: true,
        isCompatible: true,
        exception: "allowed",
        reference: "46 CFR 150.170 Appendix I (a)",
      };
    if (prohibited?.kind === "group")
      return {
        known: true,
        isCompatible: false,
        exception: "prohibited",
        reference: "46 CFR 150.170 Appendix I (b)",
      };
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

  // 点名禁止优先于点名允许和整族禁止。
  if (prohibited?.kind === "named") {
    return {
      known: true,
      isCompatible: false,
      exception: "prohibited",
      reference: "46 CFR 150.170 Appendix I (b)",
    };
  }
  // 矩阵本已相容时沿用矩阵结果；其余允许例外覆盖整族禁止。
  if (allowed && (chartInc || prohibited?.kind === "group")) {
    return {
      known: true,
      isCompatible: true,
      exception: "allowed",
      reference: "46 CFR 150.170 Appendix I (a)",
    };
  }
  if (prohibited?.kind === "group") {
    return {
      known: true,
      isCompatible: false,
      exception: "prohibited",
      reference: "46 CFR 150.170 Appendix I (b)",
    };
  }
  return { known: true, isCompatible: !chartInc, exception: null };
}
