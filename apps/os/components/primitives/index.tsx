// components/primitives — the Deep Field primitive layer.
//
// Built against design tokens only. No feature knowledge, no data fetching, no business rules.
// Hierarchy comes from scale, weight, and color — NOT from wrapping everything in a rounded card.

import type { ReactNode } from "react";

// ─── Button ────────────────────────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/12 text-[var(--color-accent-hi)] hover:bg-[var(--color-accent)]/20 hover:border-[var(--color-accent)]/70",
  ghost:
    "border-[var(--color-line-strong)] text-[var(--color-t2)] hover:text-[var(--color-t1)] hover:border-[var(--color-t3)] hover:bg-[var(--color-surface-2)]",
  quiet:
    "border-transparent text-[var(--color-t3)] hover:text-[var(--color-t1)] hover:bg-[var(--color-surface-2)]",
  danger:
    "border-[var(--color-risk)]/40 text-[var(--color-risk)] hover:bg-[var(--color-risk)]/12 hover:border-[var(--color-risk)]/70",
};

export function Button({
  variant = "ghost",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      className={`t-label inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Status ────────────────────────────────────────────────────────────────────────────────────

export type Tone = "good" | "risk" | "accent" | "neutral" | "neural";

const TONE_COLOR: Record<Tone, string> = {
  good: "var(--color-good)",
  risk: "var(--color-risk)",
  accent: "var(--color-accent)",
  neutral: "var(--color-t3)",
  neural: "var(--color-neural)",
};

/**
 * A status indicator that never relies on color alone: the dot carries the hue, the adjacent text
 * carries the meaning. Callers must always supply the label (accessibility §17).
 */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      <span className="t-label" style={{ color: tone === "neutral" ? "var(--color-t3)" : TONE_COLOR[tone] }}>
        {children}
      </span>
    </span>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className="t-label inline-flex items-center rounded-[var(--radius-xs)] border px-1.5 py-0.5"
      style={{
        color: TONE_COLOR[tone],
        borderColor: `color-mix(in srgb, ${TONE_COLOR[tone]} 35%, transparent)`,
        background: `color-mix(in srgb, ${TONE_COLOR[tone]} 8%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

// ─── Metric ────────────────────────────────────────────────────────────────────────────────────

/**
 * The number is the object; the label is the caption. No box, no border — a metric earns its
 * presence through typographic scale, not through a card around it.
 */
export function Metric({
  label,
  value,
  sub,
  size = "md",
}: {
  label: string;
  value: string;
  sub?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`${size === "lg" ? "t-metric-xl" : "t-metric"} text-[var(--color-t1)]`}>{value}</span>
      <span className="t-label text-[var(--color-t3)]">{label}</span>
      {sub && <span className="t-mono text-[var(--color-t3)]">{sub}</span>}
    </div>
  );
}

// ─── Section ───────────────────────────────────────────────────────────────────────────────────

/** A titled region separated by a hairline — the alternative to a rounded card. */
export function Section({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <header className="mb-3 flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-2">
        <h2 className="t-section text-[var(--color-t3)]">{title}</h2>
        {aside && <div className="t-mono shrink-0 text-[var(--color-t3)]">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Divider() {
  return <hr className="border-0 border-t border-[var(--color-line)]" />;
}

// ─── Empty state ───────────────────────────────────────────────────────────────────────────────

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 py-6">
      <p className="t-body text-[var(--color-t2)]">{title}</p>
      {hint && <p className="t-meta text-[var(--color-t3)]">{hint}</p>}
    </div>
  );
}

// ─── Key/value row ─────────────────────────────────────────────────────────────────────────────

export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="t-label shrink-0 text-[var(--color-t3)]">{label}</span>
      <span className="t-meta min-w-0 text-right text-[var(--color-t1)]">{value}</span>
    </div>
  );
}