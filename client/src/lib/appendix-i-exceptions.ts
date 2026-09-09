import { loadStaticAppendixIExceptions } from "./appendix-i-static";

export interface AllowedException {
  substance1: string;
  group1: number;
  substance2: string;
  group2: number;
  notes?: string;
}

export interface ProhibitedException {
  substance: string;
  group: number;
  incompatibleWith?: string | string[];
  incompatibleGroups?: number[];
  notes?: string;
}

export type AppendixIExceptionStatus = "not-loaded" | "loading" | "loaded" | "failed";
const snapshot = loadStaticAppendixIExceptions();
let activeAllowed = snapshot.allowed;
let activeProhibited = snapshot.prohibited;

export function getAppendixIExceptionStatus(): AppendixIExceptionStatus { return "loaded"; }
export function useAppendixIExceptionStatus(): AppendixIExceptionStatus { return "loaded"; }
export function setRuntimeExceptionLoadStatus(_status: AppendixIExceptionStatus): void {}
export function subscribeAppendixIExceptionStatus(_listener: () => void): () => void { return () => {}; }
export function setRuntimeExceptions(allowed?: AllowedException[] | null, prohibited?: ProhibitedException[] | null): void {
  activeAllowed = allowed ?? [];
  activeProhibited = prohibited ?? [];
}
export function resetRuntimeExceptionsForTest(): void {
  activeAllowed = [];
  activeProhibited = [];
}
export function getRuntimeExceptions(): { allowed: AllowedException[]; prohibited: ProhibitedException[] } {
  return { allowed: activeAllowed, prohibited: activeProhibited };
}

// Matching rules mirror the main application; keep both implementations in sync.
export function normName(s: string | undefined | null): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9一-龥]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalToken(token: string): string {
  return token
    .replace(/sulph/g, "sulf")
    .replace(/^glycerine$/, "glycerin")
    .replace(/^triodium$/, "trisodium")
    .replace(/^ethyleaneamine$/, "ethyleneamine");
}

function tokenMatch(a: string, b: string): boolean {
  const x = canonicalToken(a);
  const y = canonicalToken(b);
  if (x === y) return true;
  return x.length >= 4 && y.length >= 4 && (x === `${y}s` || y === `${x}s`);
}

/** 从候选名称中逐个消费例外名词元;同一个候选词元不能重复命中。 */
function unmatchedCargoTokens(
  exceptionName: string,
  cargoName: string
): string[] | null {
  const required = normName(exceptionName).split(" ").filter(Boolean);
  const available = normName(cargoName).split(" ").filter(Boolean);
  if (!required.length || !available.length) return null;
  for (const token of required) {
    const index = available.findIndex(candidate => tokenMatch(token, candidate));
    if (index < 0) return null;
    available.splice(index, 1);
  }
  return available;
}

/**
 * 例外名是否命中货名。方向固定:a = Appendix I 表内名称,b = 航次货名。
 * 例外名的每个词元须在货名中一一对应;仅容忍单复数及法规中的固定拼写变体。
 */
export function nameMatch(a?: string | null, b?: string | null): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return unmatchedCargoTokens(x, y) !== null;
}

const SPECIFIC_NAME_QUALIFIERS = new Set([
  "and",
  "mixture",
  "mixtures",
  "solution",
  "solutions",
  "nos",
]);

/** 禁止例外中的具体物质只允许多出浓度、溶液、混合物等限定词。 */
function specificNameMatch(exceptionName: string, cargoName?: string): boolean {
  if (!cargoName) return false;
  const remaining = unmatchedCargoTokens(exceptionName, cargoName);
  return (
    remaining !== null &&
    remaining.every(
      token =>
        SPECIFIC_NAME_QUALIFIERS.has(token) ||
        /^\d+(?:\.\d+)?$/.test(token) ||
        /^c\d+$/.test(token)
    )
  );
}

function annotatedGroup(name: string): number | null {
  const match = name.match(/\(\s*(?:group\s+)?(\d{1,2})\s*\)\s*$/i);
  return match ? Number(match[1]) : null;
}

/**
 * 对官方导入记录,以原始条款重新识别整组引用。
 * 这样即使数据库仍含旧解析结果,括号内的具体物质组号也不会被当成整组禁配。
 */
function groupsFromImportedNotes(notes?: string): number[] | null {
  if (!notes || !/^not compatible with\b/i.test(notes.trim())) return null;
  const text = notes.replace(/\([^)]*\)/g, " ");
  const groups = new Set<number>();
  const clause =
    /\bGroups?\s+(\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:(?:\s*,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+)\d{1,2}(?:\s*[-–]\s*\d{1,2})?)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = clause.exec(text)) !== null) {
    const numbers = /(\d{1,2})\s*[-–]\s*(\d{1,2})|(\d{1,2})/g;
    let part: RegExpExecArray | null;
    while ((part = numbers.exec(match[1])) !== null) {
      if (part[1] && part[2]) {
        for (let group = Number(part[1]); group <= Number(part[2]); group++)
          groups.add(group);
      } else if (part[3]) {
        groups.add(Number(part[3]));
      }
    }
  }
  return Array.from(groups);
}

export function findAllowedException(
  group1: number,
  group2: number,
  _substance1?: string,
  _substance2?: string
): AllowedException | null {
  return (
    activeAllowed.find(
      exc =>
        (exc.group1 === group1 && exc.group2 === group2) ||
        (exc.group1 === group2 && exc.group2 === group1)
    ) || null
  );
}

/** 某一侧物质命中禁止例外,且另一侧按分组或物质名不相容 → 返回该例外。 */
export function findProhibitedException(
  group1: number,
  group2: number,
  substance1?: string,
  substance2?: string
): ProhibitedException | null {
  const check = (
    ownGroup: number,
    sName: string | undefined,
    otherName: string | undefined,
    otherGroup: number
  ): ProhibitedException | null => {
    if (!sName) return null;
    return (
      activeProhibited.find(exc => {
        if (exc.group !== ownGroup) return false;

        // Appendix I(b) 中唯一写成 “(Group N)” 的主体条款。
        const wholeGroupSubject =
          exc.group === 40 && normName(exc.substance) === "glycol ethers";
        if (!wholeGroupSubject && !specificNameMatch(exc.substance, sName))
          return false;

        const incNames = Array.isArray(exc.incompatibleWith)
          ? exc.incompatibleWith
          : exc.incompatibleWith
            ? [exc.incompatibleWith]
            : [];
        const effectiveGroups =
          groupsFromImportedNotes(exc.notes) ?? exc.incompatibleGroups ?? [];
        const groupHit = effectiveGroups.includes(otherGroup);
        const nameHit = incNames.some(name => {
          const group = annotatedGroup(name);
          return (
            (group == null || group === otherGroup) &&
            specificNameMatch(name, otherName)
          );
        });
        return groupHit || nameHit;
      }) || null
    );
  };

  return (
    check(group1, substance1, substance2, group2) ||
    check(group2, substance2, substance1, group1) ||
    null
  );
}
