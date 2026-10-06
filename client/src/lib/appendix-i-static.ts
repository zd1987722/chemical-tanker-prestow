import snapshot from "@shared/appendix-i-exceptions.json";
import type { AllowedException, ProhibitedException } from "./appendix-i-exceptions";

export function loadStaticAppendixIExceptions(): {
  allowed: AllowedException[];
  prohibited: ProhibitedException[];
  exportedAt: string;
} {
  return {
    allowed: snapshot.allowed.map(row => ({ ...row, notes: row.notes ?? undefined })),
    prohibited: snapshot.prohibited.map(row => ({
      ...row,
      incompatibleWith: [...row.incompatibleWith],
      incompatibleGroups: [...row.incompatibleGroups],
      notes: row.notes ?? undefined,
    })),
    exportedAt: snapshot.exportedAt,
  };
}
