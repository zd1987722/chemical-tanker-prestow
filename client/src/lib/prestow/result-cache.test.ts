import { afterEach, describe, expect, it } from "vitest";
import { clearSolveCache, readSolveCache, voyageKey, writeSolveCache, type CachedSolve } from "./result-cache";
import { SAMPLE_VOYAGE } from "./sample-voyage";

const cached: CachedSolve = {
  voyageKey: voyageKey(SAMPLE_VOYAGE),
  result: { status: "invalid", errors: ["待补齐输入"] },
  selectedKey: "方案二",
  selectedCallId: SAMPLE_VOYAGE.calls[2].id,
  showRejected: true,
  exportN: 40,
  repairs: { proposals: [], tried: 1, elapsedMs: 10 },
};

describe("求解结果内存缓存", () => {
  afterEach(clearSolveCache);

  it("同一航次写后可读，保留结果与浏览选择", () => {
    writeSolveCache(cached);
    expect(readSolveCache(SAMPLE_VOYAGE)).toBe(cached);
  });

  it("修改一个货票数量后不返回旧结果", () => {
    writeSolveCache(cached);
    const changed = structuredClone(SAMPLE_VOYAGE);
    changed.parcels[0].quantityMt += 1;
    expect(readSolveCache(changed)).toBeNull();
  });

  it("清空后不再返回结果", () => {
    writeSolveCache(cached);
    clearSolveCache();
    expect(readSolveCache(SAMPLE_VOYAGE)).toBeNull();
  });

  it("航次结构化克隆后指纹相同", () => {
    expect(voyageKey(structuredClone(SAMPLE_VOYAGE))).toBe(voyageKey(SAMPLE_VOYAGE));
  });
});
