import type { FixedWeight, LoadingCondition, TankLoad } from "./types";

export const CONDITIONS_STORAGE_KEY = "loadcalc.conditions.v1";
export const CURRENT_CONDITION_STORAGE_KEY = "loadcalc.currentId.v1";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTankLoad(value: unknown): value is TankLoad {
  if (!value || typeof value !== "object") return false;
  const tank = value as Record<string, unknown>;
  return (
    typeof tank.compId === "string" &&
    isFiniteNumber(tank.density) &&
    isFiniteNumber(tank.level) &&
    (tank.cargoName === undefined || typeof tank.cargoName === "string") &&
    (tank.tempC === undefined || isFiniteNumber(tank.tempC))
  );
}

function isFixedWeight(value: unknown): value is FixedWeight {
  if (!value || typeof value !== "object") return false;
  const fixed = value as Record<string, unknown>;
  return (
    typeof fixed.id === "string" &&
    typeof fixed.name === "string" &&
    isFiniteNumber(fixed.weight) &&
    isFiniteNumber(fixed.lcg) &&
    isFiniteNumber(fixed.tcg) &&
    isFiniteNumber(fixed.vcg)
  );
}

function isConditionPort(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const port = value as Record<string, unknown>;
  return typeof port.name === "string" && isFiniteNumber(port.density) && port.density > 0
    && (port.maxDraft === undefined || (isFiniteNumber(port.maxDraft) && port.maxDraft > 0))
    && (port.airDraftLimit === undefined || (isFiniteNumber(port.airDraftLimit) && port.airDraftLimit > 0));
}

export function isLoadingCondition(value: unknown): value is LoadingCondition {
  if (!value || typeof value !== "object") return false;
  const condition = value as Record<string, unknown>;
  return (
    typeof condition.id === "string" &&
    typeof condition.name === "string" &&
    (condition.note === undefined || typeof condition.note === "string") &&
    (condition.port === undefined || isConditionPort(condition.port)) &&
    isFiniteNumber(condition.waterDensity) &&
    Array.isArray(condition.tanks) &&
    condition.tanks.every(isTankLoad) &&
    Array.isArray(condition.constants) &&
    condition.constants.every(isFixedWeight) &&
    typeof condition.createdAt === "string" &&
    typeof condition.updatedAt === "string"
  );
}

export function serializeConditions(list: LoadingCondition[]): string {
  return JSON.stringify(list);
}

export function parseConditions(raw: string | null): LoadingCondition[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isLoadingCondition)
      ? parsed
      : [];
  } catch {
    return [];
  }
}
