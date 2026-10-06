import type { ConditionResult } from "../loadcalc/types";

export interface LoadCalcPort {
  id: string;
  name: string;
  maxDraft?: number;
  density: number;
  airDraftLimit?: number;
}

export interface PortLimitStatus {
  port: LoadCalcPort;
  deepestDraft: number;
  draftMargin?: number;
  airDraft?: number;
  airDraftMargin?: number;
  state: "ok" | "bad" | "na";
}

export const PORTS_STORAGE_KEY = "loadcalc.ports.v1";

export const DEFAULT_PORTS: readonly LoadCalcPort[] = [
  { id: "ulsan", name: "蔚山", density: 1.025 },
  { id: "rotterdam", name: "鹿特丹", maxDraft: 11.8, density: 1 },
  { id: "antwerp", name: "安特卫普", maxDraft: 12.5, density: 1.025 },
];

export function defaultPorts(): LoadCalcPort[] {
  return DEFAULT_PORTS.map(port => ({ ...port }));
}

export function parsePorts(raw: string | null): LoadCalcPort[] {
  if (!raw) return defaultPorts();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPorts();
    const valid = parsed.every(value => {
      if (!value || typeof value !== "object") return false;
      const port = value as Record<string, unknown>;
      return typeof port.id === "string"
        && typeof port.name === "string"
        && typeof port.density === "number"
        && Number.isFinite(port.density)
        && port.density > 0
        && (port.maxDraft === undefined || (typeof port.maxDraft === "number" && Number.isFinite(port.maxDraft)))
        && (port.airDraftLimit === undefined || (typeof port.airDraftLimit === "number" && Number.isFinite(port.airDraftLimit)));
    });
    return valid ? parsed as LoadCalcPort[] : defaultPorts();
  } catch {
    return defaultPorts();
  }
}

export function portLimitStatus(
  port: LoadCalcPort,
  result: ConditionResult,
  airDraft?: number,
): PortLimitStatus {
  const deepestDraft = Math.max(result.floating.draftMarkFwd, result.floating.draftMarkAft);
  const draftMargin = port.maxDraft === undefined ? undefined : port.maxDraft - deepestDraft;
  const airDraftMargin = port.airDraftLimit === undefined || airDraft === undefined
    ? undefined
    : port.airDraftLimit - airDraft;
  const margins = [draftMargin, airDraftMargin].filter((value): value is number => value !== undefined);
  return {
    port,
    deepestDraft,
    ...(draftMargin === undefined ? {} : { draftMargin }),
    ...(airDraft === undefined ? {} : { airDraft }),
    ...(airDraftMargin === undefined ? {} : { airDraftMargin }),
    state: margins.length === 0 ? "na" : margins.every(margin => margin >= 0) ? "ok" : "bad",
  };
}
