import type { CargoGrade, LoadingCondition } from "../loadcalc/types";

export const DEFAULT_CARGO_GRADES: readonly CargoGrade[] = [
  {
    id: "product",
    name: "成品油(演示)",
    abbr: "PROD",
    densityBase: 0.85,
    densityBasis: "air",
    method: "astm54b",
    color: "#3f6aa8",
  },
  {
    id: "methanol",
    name: "甲醇 Methanol",
    abbr: "MEOH",
    densityBase: 0.792,
    densityBasis: "vacuum",
    method: "tec",
    tec: 0.00119,
    color: "#2f7f8f",
  },
  {
    id: "caustic-50",
    name: "烧碱溶液 50%",
    abbr: "NAOH",
    densityBase: 1.525,
    densityBasis: "air",
    method: "none",
    color: "#a8763a",
  },
];

export function defaultCargoGrades(): CargoGrade[] {
  return DEFAULT_CARGO_GRADES.map(grade => ({ ...grade }));
}

export function cargoGrades(condition: Pick<LoadingCondition, "grades">): CargoGrade[] {
  return condition.grades ?? defaultCargoGrades();
}
