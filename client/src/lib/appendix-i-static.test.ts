import { afterEach, describe, expect, it } from "vitest";
import snapshot from "@shared/appendix-i-exceptions.json";
import { loadStaticAppendixIExceptions } from "./appendix-i-static";
import {
  getAppendixIExceptionStatus,
  setRuntimeExceptions,
} from "./appendix-i-exceptions";
import { chartIncompatible, evaluateCompat } from "./uscg-verdict";

afterEach(() => {
  const data = loadStaticAppendixIExceptions();
  setRuntimeExceptions(data.allowed, data.prohibited);
});

describe("Appendix I static snapshot", () => {
  it("contains the exported public fields and typed exception arrays", () => {
    expect(snapshot.source).toContain("46 CFR Part 150 Appendix I");
    expect(snapshot.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.allowed.length).toBeGreaterThanOrEqual(150);
    expect(snapshot.prohibited.length).toBeGreaterThanOrEqual(70);
    for (const row of snapshot.allowed) {
      expect(Object.keys(row).sort()).toEqual(["group1", "group2", "notes", "substance1", "substance2"]);
      expect(typeof row.substance1).toBe("string");
      expect(typeof row.substance2).toBe("string");
      expect(Number.isInteger(row.group1)).toBe(true);
      expect(Number.isInteger(row.group2)).toBe(true);
      expect(row.notes === null || typeof row.notes === "string").toBe(true);
    }
    for (const row of snapshot.prohibited) {
      expect(Object.keys(row).sort()).toEqual(["group", "incompatibleGroups", "incompatibleWith", "notes", "substance"]);
      expect(typeof row.substance).toBe("string");
      expect(Number.isInteger(row.group)).toBe(true);
      expect(Array.isArray(row.incompatibleWith)).toBe(true);
      expect(row.incompatibleWith.every(value => typeof value === "string")).toBe(true);
      expect(Array.isArray(row.incompatibleGroups)).toBe(true);
      expect(row.incompatibleGroups.every(Number.isInteger)).toBe(true);
      expect(row.notes === null || typeof row.notes === "string").toBe(true);
    }
  });

  it("normalizes null notes without changing the snapshot", () => {
    const data = loadStaticAppendixIExceptions();
    expect(data.exportedAt).toBe(snapshot.exportedAt);
    for (const kind of ["allowed", "prohibited"] as const) {
      data[kind].forEach((row, index) => {
        expect(row.notes).toBe(snapshot[kind][index].notes ?? undefined);
      });
    }
    expect(snapshot.allowed.some(row => row.notes === null)).toBe(true);
  });

  it("overrides Figure 1 with an allowed exception, and uses the matrix when cleared", () => {
    const data = loadStaticAppendixIExceptions();
    // Stable exported first pair: Figure 1 marks groups 20 / 7 incompatible.
    const pair = data.allowed.find(row =>
      row.substance1 === "1,2-Propylene glycol" && row.substance2 === "Diethylenetriamine"
    )!;
    expect(pair).toBeDefined();
    expect(chartIncompatible(pair.group1, pair.group2)).toBe(true);
    setRuntimeExceptions(data.allowed, data.prohibited);
    expect(getAppendixIExceptionStatus()).toBe("loaded");
    expect(evaluateCompat(pair.group1, pair.group2, pair.substance1, pair.substance2))
      .toMatchObject({ known: true, isCompatible: true, exception: "allowed" });
    setRuntimeExceptions([], []);
    expect(evaluateCompat(pair.group1, pair.group2, pair.substance1, pair.substance2))
      .toMatchObject({ known: true, isCompatible: false, exception: null });
  });

  it("retains named prohibited exceptions for unclassified cargo", () => {
    const data = loadStaticAppendixIExceptions();
    setRuntimeExceptions(data.allowed, data.prohibited);
    expect(evaluateCompat(0, 1, "Acetone cyanohydrin", "Acid"))
      .toMatchObject({ known: true, isCompatible: false, exception: "prohibited" });
    expect(evaluateCompat(0, 1, "Unrelated cargo", "Acid"))
      .toMatchObject({ known: false, exception: null });
  });
});
