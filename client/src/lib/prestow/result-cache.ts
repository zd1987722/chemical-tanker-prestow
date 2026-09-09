import type { RepairReport, StowResult, StowVoyage } from "./types";

export interface CachedSolve {
  voyageKey: string;
  result: StowResult;
  selectedKey: string | null;
  selectedCallId: string | null;
  showRejected: boolean;
  exportN: number;
  repairs: RepairReport | null;
}

let cachedSolve: CachedSolve | null = null;

/** 航次内容指纹：航次是纯数据对象，字段顺序由表单固定，足够稳定。 */
export function voyageKey(voyage: StowVoyage): string {
  return JSON.stringify(voyage);
}

/** 只有指纹一致才返回缓存，否则返回空值。 */
export function readSolveCache(voyage: StowVoyage): CachedSolve | null {
  return cachedSolve?.voyageKey === voyageKey(voyage) ? cachedSolve : null;
}

export function writeSolveCache(entry: CachedSolve): void {
  cachedSolve = entry;
}

export function clearSolveCache(): void {
  cachedSolve = null;
}
