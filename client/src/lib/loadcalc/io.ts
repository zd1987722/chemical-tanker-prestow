import { isLoadingCondition } from "./storage";
import type { LoadingCondition } from "./types";

export function exportConditionJson(condition: LoadingCondition): string {
  return JSON.stringify(condition, null, 2);
}

export function importConditionJson(raw: string): LoadingCondition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("工况 JSON 格式无效");
  }
  if (!isLoadingCondition(parsed)) {
    throw new Error("工况数据缺少必填字段或字段类型无效");
  }
  const entries = new Set(["level", "pct", "volume", "weight"]);
  if (parsed.tanks.some(tank => tank.entry !== undefined && !entries.has(tank.entry))) {
    throw new Error("工况数据的录入口径无效");
  }
  const fsmModes = new Set(["actual", "max", "zero"]);
  if (parsed.tanks.some(tank => tank.fsmMode !== undefined && !fsmModes.has(tank.fsmMode))) {
    throw new Error("工况数据的 FSM 模式无效");
  }
  if (parsed.tanks.some(tank => tank.gradeId !== undefined && typeof tank.gradeId !== "string")) {
    throw new Error("工况数据的货物属性引用无效");
  }
  if (parsed.tanks.some(tank => tank.temperature !== undefined && (typeof tank.temperature !== "number" || !Number.isFinite(tank.temperature)))) {
    throw new Error("工况数据的货物温度无效");
  }
  const calcModes = new Set(["beforeLoading", "afterLoading"]);
  if (parsed.calcMode !== undefined && !calcModes.has(parsed.calcMode)) {
    throw new Error("工况数据的货物计算模式无效");
  }
  if (parsed.grades !== undefined) {
    const bases = new Set(["air", "vacuum"]);
    const methods = new Set(["none", "astm54b", "tec"]);
    const validGrades = Array.isArray(parsed.grades) && parsed.grades.every(grade => (
      grade !== null
      && typeof grade === "object"
      && typeof grade.id === "string"
      && typeof grade.name === "string"
      && typeof grade.abbr === "string"
      && typeof grade.densityBase === "number"
      && Number.isFinite(grade.densityBase)
      && bases.has(grade.densityBasis)
      && methods.has(grade.method)
      && (grade.tec === undefined || (typeof grade.tec === "number" && Number.isFinite(grade.tec)))
      && (grade.color === undefined || typeof grade.color === "string")
    ));
    if (!validGrades) throw new Error("工况数据的货物属性表无效");
  }
  if (parsed.approved !== undefined && typeof parsed.approved !== "boolean") {
    throw new Error("工况数据的批准状态无效");
  }
  const voyage: unknown = parsed.voyage;
  if (voyage !== undefined) {
    if (voyage === null || typeof voyage !== "object" || Array.isArray(voyage)) {
      throw new Error("工况数据的航次描述无效");
    }
    const values = Object.values(voyage);
    if (values.some(value => value !== undefined && typeof value !== "string")) {
      throw new Error("工况数据的航次描述无效");
    }
  }
  return parsed;
}
