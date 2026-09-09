import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeGet } from "@/lib/safe-storage";
import { readSolveCache, clearSolveCache, voyageKey, writeSolveCache } from "@/lib/prestow/result-cache";
import { SAMPLE_VOYAGES } from "@/lib/prestow/sample-voyages";
import { EMPTY_VOYAGE, usePrestowDraft } from "./usePrestowDraft";

vi.mock("@/lib/safe-storage", () => ({ safeGet: vi.fn(), safeSet: vi.fn() }));

describe("返回预配载页面时读取航次草稿", () => {
  afterEach(() => { vi.clearAllMocks(); clearSolveCache(); });

  it("八港示例重新挂载后字段顺序不变，可恢复原结果与选择", () => {
    const voyage = SAMPLE_VOYAGES.find(entry => entry.id === "far-east-europe-12")!.voyage;
    vi.mocked(safeGet).mockReturnValue(JSON.stringify(voyage));
    const entry = { voyageKey: voyageKey(voyage), result: { status: "invalid" as const, errors: [] }, selectedKey: "方案二", selectedCallId: voyage.calls[2].id, showRejected: false, exportN: 20, repairs: null };
    writeSolveCache(entry);
    function ReadDraft() {
      const { voyage: restored } = usePrestowDraft();
      expect(voyageKey(restored)).toBe(voyageKey(voyage));
      expect(readSolveCache(restored)).toBe(entry);
      return null;
    }
    renderToString(createElement(ReadDraft));
  });

  it("旧草稿缺少航次头信息时仍补入默认值", () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ calls: [], parcels: [] }));
    function ReadDraft() {
      expect(usePrestowDraft().voyage).toEqual(EMPTY_VOYAGE);
      return null;
    }
    renderToString(createElement(ReadDraft));
  });
});
