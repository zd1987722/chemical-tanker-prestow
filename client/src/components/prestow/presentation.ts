import type { Verdict } from "@/components/verdict";
import { cargoColorMap } from "@/lib/cargo-colors";
import type { Parcel, StageFloating } from "@/lib/prestow/types";

export type ParcelVisuals = Record<string, { color: string; label: string }>;

export function parcelVisualMap(parcels: Pick<Parcel, "id" | "display">[]): ParcelVisuals {
  const colors = cargoColorMap(parcels.map(parcel => parcel.display));
  return Object.fromEntries(parcels.map((parcel, index) => [parcel.id, {
    color: colors[parcel.display] ?? "#3f6aa8",
    label: `票${String(index + 1).padStart(2, "0")}`,
  }]));
}

export function draftMarginVerdict(margin: number | null | undefined): Verdict {
  if (margin == null || !Number.isFinite(margin)) return "none";
  if (margin < -0.01) return "fail";
  return margin <= 0.05 ? "warn" : "none";
}

export interface TrimReliefHint { reliefM: number; enough: boolean; relaxed: boolean; }

/** 裕量临界或超限、且调纵倾还能换出 ≥ 0.02 m 时给提示;否则 null。 */
export function trimReliefHint(
  floating: Pick<StageFloating, "draftMargin" | "trimReliefM" | "trimRelaxed"> | undefined,
): TrimReliefHint | null {
  const margin = floating?.draftMargin;
  if (margin == null || draftMarginVerdict(margin) === "none") return null;
  const reliefM = floating?.trimReliefM ?? 0;
  if (reliefM < 0.02) return floating?.trimRelaxed
    ? { reliefM: 0, enough: margin >= -0.01, relaxed: true }
    : null;
  return { reliefM, enough: margin + reliefM >= -0.01, relaxed: floating?.trimRelaxed === true };
}

export function scrollToStowSection(id: string) {
  if (!window.matchMedia("(max-width: 620px)").matches) return;
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
}
