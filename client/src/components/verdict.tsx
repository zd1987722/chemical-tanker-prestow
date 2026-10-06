import type { ReactNode } from "react";

export type Verdict = "pass" | "warn" | "fail" | "none";

export const VERDICT_TEXT: Record<Verdict, string> = {
  pass: "通过",
  warn: "注意",
  fail: "不通过",
  none: "未计算",
};

export function VerdictBadge({
  verdict,
  children,
  size = "sm",
}: {
  verdict: Verdict;
  children?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span className={`vb vb-${verdict} vb-${size}`}>
      {children ?? VERDICT_TEXT[verdict]}
    </span>
  );
}

export function VerdictCard({
  title,
  verdict,
  value,
  unit,
  note,
  aside,
}: {
  title: string;
  verdict: Verdict;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div
      className={`vc vc-${verdict}`}
      aria-label={`${title} ${VERDICT_TEXT[verdict]}`}
    >
      <div className="vc-head">
        <span className="vc-title">{title}</span>
        {aside ?? (verdict !== "none" && <VerdictBadge verdict={verdict} />)}
      </div>
      <div className="vc-value">
        <span className="mono">{value}</span>
        {unit && <span className="vc-unit">{unit}</span>}
      </div>
      {note && <div className="vc-note">{note}</div>}
    </div>
  );
}
