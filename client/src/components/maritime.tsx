/**
 * Maritime design-system primitives.
 * Ported from the Claude Design "海事权威 / Maritime Authority" prototype
 * (DESIGN_CHANGES.md §3). Presentational only — no data logic.
 */
import { type ReactNode, type CSSProperties } from "react";
import {
  type LucideIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Check,
  Flame,
  Skull,
  Beaker,
  Activity,
  Layers,
  Droplet,
  Search,
  Sparkles,
  Loader2,
} from "lucide-react";

/* ---- Brand mark: hexagon (chemistry) + wave (maritime) + safety check ---- */
export function Logo({
  size = 34,
  mono = false,
}: {
  size?: number;
  mono?: boolean;
}) {
  const ink = mono ? "currentColor" : "var(--header-ink)";
  const teal = mono ? "currentColor" : "#5fd0c8";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 3.2 33.5 11v18L20 36.8 6.5 29V11z"
        fill={mono ? "none" : "rgba(95,208,200,.14)"}
        stroke={teal}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11 23.5c2.2-2.4 4-2.4 6 0s3.8 2.4 6 0 4-2.4 6 0"
        stroke={teal}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M14.6 16.4 19 20.6l6.8-7.4"
        stroke={ink}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Eyebrow({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="eyebrow">
      {Icon && <Icon size={13} />}
      {children}
    </span>
  );
}

export function SectionTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div>
      <div className="sec-title">
        <span className="bar" />
        <h2>{children}</h2>
      </div>
      {sub && (
        <p
          style={{
            margin: "8px 0 0 15px",
            color: "var(--ink-2)",
            fontSize: 14,
            maxWidth: 720,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function Code({
  children,
  primary,
  label,
}: {
  children: ReactNode;
  primary?: boolean;
  label?: string;
}) {
  return (
    <span className={"code" + (primary ? " code-primary" : "")}>
      {label && <span style={{ opacity: 0.6, fontWeight: 600 }}>{label}</span>}
      {children}
    </span>
  );
}

/* ---- permission / verdict semantic states ---- */
export type StatusState =
  | "safe"
  | "yes"
  | "warn"
  | "cond"
  | "danger"
  | "no"
  | "muted";

const STATE: Record<StatusState, { cls: string; ic: LucideIcon }> = {
  safe: { cls: "s-safe", ic: CheckCircle2 },
  yes: { cls: "s-safe", ic: CheckCircle2 },
  warn: { cls: "s-warn", ic: AlertTriangle },
  cond: { cls: "s-warn", ic: AlertTriangle },
  danger: { cls: "s-danger", ic: XCircle },
  no: { cls: "s-danger", ic: XCircle },
  muted: { cls: "s-muted", ic: Info },
};

export function StatusBadge({
  state = "muted",
  children,
  sub,
  icon,
  size = 14,
}: {
  state?: StatusState;
  children: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  size?: number;
}) {
  const s = STATE[state] || STATE.muted;
  const Ic = icon || s.ic;
  return (
    <span className={"sbadge " + s.cls}>
      <span className="sb-ic">
        <Ic size={size} />
      </span>
      <span>
        {children}
        {sub && (
          <>
            {" "}
            <small>{sub}</small>
          </>
        )}
      </span>
    </span>
  );
}
/* ---- hazard chips ---- */
export const HAZ: Record<
  string,
  { zh: string; en: string; ic: LucideIcon; c: string }
> = {
  F: { zh: "易燃", en: "Flammable", ic: Flame, c: "var(--warn)" },
  T: { zh: "有毒", en: "Toxic", ic: Skull, c: "var(--danger)" },
  C: { zh: "腐蚀", en: "Corrosive", ic: Beaker, c: "var(--danger)" },
  R: { zh: "反应性", en: "Reactive", ic: Activity, c: "var(--warn)" },
  P: { zh: "易聚合", en: "Polymerizes", ic: Layers, c: "var(--accent)" },
  Irr: { zh: "刺激性", en: "Irritant", ic: AlertTriangle, c: "var(--warn)" },
  W: { zh: "遇水反应", en: "Water-react", ic: Droplet, c: "var(--accent)" },
  Car: { zh: "致癌", en: "Carcinogen", ic: Skull, c: "var(--danger)" },
};

export function HazardChip({ code }: { code: string }) {
  const h = HAZ[code];
  if (!h) return null;
  const Ic = h.ic;
  return (
    <span
      className="pill"
      style={{
        color: h.c,
        borderColor: "color-mix(in oklch, currentColor 30%, transparent)",
        background: "color-mix(in oklch, currentColor 8%, transparent)",
      }}
    >
      <Ic size={13} />
      {h.zh}
      <span style={{ opacity: 0.6, fontWeight: 500, fontSize: 11 }}>
        {h.en}
      </span>
    </span>
  );
}
/**
 * 搜索下拉顶部固定的「AI 辅助搜索」按钮 —— 列表里没有目标物质时,
 * 一键转 AI 推测(支持中文/俗称/拼写错误)。各搜索模块统一复用。
 */
export function AiAssistBar({
  keyword,
  loading,
  onClick,
}: {
  keyword?: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dd-aibar"
      onClick={onClick}
      disabled={loading}
    >
      <span className="dd-aibar-ic">
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Sparkles size={15} />
        )}
      </span>
      <span className="dd-aibar-tx">
        <b>智能辅助搜索{keyword ? `「${keyword}」` : ""}</b>
        <em>列表里没有目标物质?让智能助手帮你找(支持中文 / 俗称 / 拼写错误)</em>
      </span>
    </button>
  );
}

export function Empty({
  icon: Icon = Search,
  title,
  sub,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "56px 24px",
        color: "var(--ink-3)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          margin: "0 auto 16px",
          display: "grid",
          placeItems: "center",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--ink-3)",
        }}
      >
        <Icon size={26} />
      </div>
      <div style={{ fontWeight: 620, fontSize: 15.5, color: "var(--ink-2)" }}>
        {title}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 6,
            fontSize: 13.5,
            maxWidth: 380,
            margin: "6px auto 0",
          }}
        >
          {sub}
        </div>
      )}
      {children && <div style={{ marginTop: 18 }}>{children}</div>}
    </div>
  );
}
/* ---- maritime card (semantic-CSS variant; distinct from shadcn Card) ---- */
export function MCard({
  hover,
  pad = true,
  className = "",
  style,
  children,
  ...rest
}: {
  hover?: boolean;
  pad?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const cls = ["card-m", pad && "card-pad", hover && "card-hover", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style} {...rest}>
      {children}
    </div>
  );
}

/* ---- maritime button (semantic-CSS variant) ---- */
export function MButton({
  variant = "primary",
  size,
  block,
  icon: Icon,
  iconRight: IconRight,
  children,
  className = "",
  ...rest
}: {
  variant?: "primary" | "ghost" | "soft";
  size?: "lg" | "sm";
  block?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  children: ReactNode;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    "btn",
    "btn-" + variant,
    size === "lg" && "btn-lg",
    size === "sm" && "btn-sm",
    block && "btn-block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const isz = size === "sm" ? 15 : 17;
  return (
    <button className={cls} {...rest}>
      {Icon && <Icon size={isz} />}
      {children}
      {IconRight && <IconRight size={isz} />}
    </button>
  );
}
