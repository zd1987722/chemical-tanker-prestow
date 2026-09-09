import { listCompartments, tankCapacity, tankFill } from "../hull";
import { defaultCargoGrades } from "../cargo/grades";
import type { FixedWeight, LoadingCondition, TankLoad } from "./types";

export const DEFAULT_CONSTANTS: FixedWeight[] = [
  { id: "const", name: "常数", weight: 200, lcg: 30, tcg: 0, vcg: 12 },
];

let nextId = 0;

function conditionId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `loadcalc-${Date.now()}-${nextId++}`;
}

function tankAtPct(compId: string, pct: number, density: number, cargoName?: string): TankLoad {
  const capacity = tankCapacity(compId).capacity100;
  return {
    compId,
    density,
    level: tankFill(compId, capacity * pct / 100).level,
    ...(cargoName ? { cargoName, gradeId: "product", temperature: 15 } : {}),
  };
}

function consumables(): TankLoad[] {
  return [
    ...listCompartments("fuel").map(compartment => tankAtPct(
      compartment.id,
      80,
      compartment.id.startsWith("HFO") ? 0.98 : 0.86,
    )),
    ...listCompartments("fresh").map(compartment => tankAtPct(compartment.id, 90, 1)),
  ];
}

function makeCondition(name: string, tanks: TankLoad[]): LoadingCondition {
  const timestamp = new Date().toISOString();
  return {
    id: conditionId(),
    name,
    waterDensity: 1.025,
    tanks,
    constants: DEFAULT_CONSTANTS.map(item => ({ ...item })),
    grades: defaultCargoGrades(),
    calcMode: "beforeLoading",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const APPROVED_CONDITION_IDS = [
  "approved-full",
  "approved-ballast",
  "approved-part",
] as const;

export function approvedConditions(): LoadingCondition[] {
  const kinds = ["fullLoad", "ballast", "partLoad"] as const;
  const names = ["满载出港", "压载到港", "半载"];
  return kinds.map((kind, index) => ({
    ...sampleCondition(kind),
    id: APPROVED_CONDITION_IDS[index],
    name: names[index],
    approved: true,
  }));
}

export function sampleCondition(kind: "fullLoad" | "ballast" | "partLoad"): LoadingCondition {
  if (kind === "fullLoad") {
    const cargo = listCompartments("cargo").map(compartment => {
      const station = Number.parseInt(compartment.id, 10);
      // 按 45 个破舱工况全通过与尾倾 ≤ 1.0 m 标定。
      const pct = station <= 7 ? 98 - 1e-9
        : station === 8 ? 61.4
          : station === 9 ? 83.8 : 50;
      return tankAtPct(compartment.id, pct, 0.85, "成品油(演示)");
    });
    return makeCondition("满载出港", [...cargo, ...consumables()]);
  }

  if (kind === "ballast") {
    const ballast = listCompartments("ballast").map(compartment => (
      tankAtPct(compartment.id, 100, 1.025)
    ));
    return makeCondition("压载出港", [...ballast, ...consumables()]);
  }

  const cargo = listCompartments("cargo")
    .filter(compartment => {
      const station = Number.parseInt(compartment.id, 10);
      return station >= 3 && station <= 7;
    })
    .map(compartment => tankAtPct(compartment.id, 90, 0.85, "成品油(演示)"));
  const ballast = ["FPT", "APT"].map(compId => tankAtPct(compId, 100, 1.025));
  return makeCondition("半载", [...cargo, ...ballast, ...consumables()]);
}

export function emptyCondition(name = "空船工况"): LoadingCondition {
  return makeCondition(name, []);
}
