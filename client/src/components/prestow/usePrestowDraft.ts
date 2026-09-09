import { useCallback, useState } from "react";
import { safeGet, safeSet } from "@/lib/safe-storage";
import type { StowVoyage } from "@/lib/prestow/types";
import { SAMPLE_SHIP } from "@/lib/prestow/sample-ship";

const KEY = "prestow.voyage.v1";

export const EMPTY_VOYAGE: StowVoyage = {
  shipId: SAMPLE_SHIP.id,
  voyageNo: "",
  calls: [],
  parcels: [],
};

function load(): StowVoyage {
  try {
    const raw = safeGet(KEY);
    if (!raw) return EMPTY_VOYAGE;
    const voyage = JSON.parse(raw);
    if (!Array.isArray(voyage.calls) || !Array.isArray(voyage.parcels)) {
      return EMPTY_VOYAGE;
    }
    // 保留已存航次的字段顺序，让返回页面后的内容指纹保持一致。
    return { ...voyage, shipId: voyage.shipId ?? EMPTY_VOYAGE.shipId, voyageNo: voyage.voyageNo ?? EMPTY_VOYAGE.voyageNo };
  } catch {
    return EMPTY_VOYAGE;
  }
}

export function usePrestowDraft() {
  const [voyage, set] = useState<StowVoyage>(load);
  const setVoyage = useCallback(
    (next: StowVoyage | ((voyage: StowVoyage) => StowVoyage)) => {
      set(previous => {
        const value = typeof next === "function" ? next(previous) : next;
        safeSet(KEY, JSON.stringify(value));
        return value;
      });
    },
    []
  );
  const reset = useCallback(() => setVoyage(EMPTY_VOYAGE), [setVoyage]);
  return { voyage, setVoyage, reset };
}
