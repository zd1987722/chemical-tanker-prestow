import { DEMO_STOW_SHIP } from "@/lib/prestow/demo-ship";
import { validateVoyageIssues } from "@/lib/prestow/engine";
import type { StowVoyage, ValidationIssue, ValidationTarget } from "@/lib/prestow/types";

export type ScenarioMode = "ai" | "rules" | "checking";

/** 有 AI 只用 AI;查询失败或明确未配置回退规则解析;查询中先不允许解析。 */
export function scenarioMode(status: { available: boolean } | undefined, isLoading: boolean): ScenarioMode {
  if (isLoading && status === undefined) return "checking";
  return status?.available === true ? "ai" : "rules";
}

/** 解析得到的航次草稿在确认覆盖前先做一遍引擎输入校验，让访客在解析面板里就看到缺什么。 */
export function draftIssues(voyage: StowVoyage): ValidationIssue[] {
  return validateVoyageIssues(DEMO_STOW_SHIP, { ...voyage, shipId: DEMO_STOW_SHIP.id });
}

export function validationTargetId(target: ValidationTarget): string {
  return `stow-input-${target.section}-${target.index ?? "all"}-${target.field ?? "row"}`;
}

export function validationAttrs(issues: ValidationIssue[], target: ValidationTarget) {
  const id = validationTargetId(target);
  const descriptions = issues.flatMap((issue, index) =>
    validationTargetId(issue.target) === id ? [`stow-error-${index}`] : [],
  );
  return {
    id,
    "aria-invalid": descriptions.length ? true : undefined,
    "aria-describedby": descriptions.length ? descriptions.join(" ") : undefined,
  };
}

export function focusValidationTarget(target: ValidationTarget) {
  const row = document.getElementById(validationTargetId({ ...target, field: undefined }));
  if (!document.getElementById(validationTargetId(target))) {
    row?.querySelector<HTMLButtonElement>('.stow-parcel-toggle[aria-expanded="false"]')?.click();
  }
  requestAnimationFrame(() => {
    const element = document.getElementById(validationTargetId(target)) ?? row ??
      document.getElementById(validationTargetId({ section: target.section }));
    if (!element) return;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });
}
