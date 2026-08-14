// components/primitives/entity — the entity-surface primitives.
//
// Descendants of the Neural Core's visual language: hierarchy comes from typographic scale and
// whitespace, borders are hairlines used as structure rather than decoration, and a card is EARNED
// (a genuinely floating overlay) rather than the default container.
//
// These encode the FACT / SIGNAL / DECISION / ACTION grammar (see docs/UI-REDESIGN-PROPOSAL.md):
//   FACT     — plain authoritative value, no attribution, no affordance.
//   SIGNAL   — same value shape plus a quiet engine attribution line.
//   DECISION — carries a rank and the Decision Engine's own explanation.
//   ACTION   — the only thing that looks interactive.
// The distinction is expressed through typography and metadata, never through four colored boxes.

import Link from "next/link";
import type { ReactNode } from "react";
import { Status, type Tone } from "./index";

// ─── Page shell ────────────────────────────────────────────────────────────────────────────────

/**
 * An entity surface: a ZOOM INTO a graph node.
 *
 * It takes the full width (`data-fullbleed` opts out of the shell's legacy column) so the deep
 * canvas ground runs edge to edge exactly as it does in the Neural Core, then holds its own
 * editorial measure inside. `hue` is the node's TYPE color — the same value the graph draws that
 * node with — so the ambient field is data-driven, not decoration.
 *
 * `pt-14` below `md` clears the fixed nav-drawer button, which otherwise sits on the breadcrumb.
 */
export function PageShell({ hue, children }: { hue?: string; children: ReactNode }) {
  return (
    <div
      data-fullbleed
      className="node-field min-h-full w-full"
      style={hue ? ({ "--node-hue": hue } as React.CSSProperties) : undefined}
    >
      <div className="anim-descend mx-auto w-full max-w-[960px] px-5 pb-28 pt-14 sm:px-8 md:pt-8">
        {children}
      </div>
    </div>
  );
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────────────────────────

export type Crumb = { label: string; href?: string };

/**
 * The trail back up the hierarchy: Neural Core → Client → Project. Always rooted at the graph, so
 * the spatial overview is never more than one click away from any depth.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="t-mono text-[var(--color-t3)]">
                ›
              </span>
            )}
            {item.href ? (
              <Link
                href={item.href}
                className="t-label text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
              >
                {item.label}
              </Link>
            ) : (
              <span className="t-label text-[var(--color-t2)]" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ─── Entity header ─────────────────────────────────────────────────────────────────────────────

/**
 * Identity. The name is the largest thing on the page and is allowed to wrap — long business names
 * are real (`Tile & Marble Installation in Bay Area`) and must never be truncated at this level.
 */
export function EntityHeader({
  kind,
  kindColor,
  name,
  facts,
  actions,
}: {
  kind: string;
  kindColor?: string;
  name: string;
  /** Identity metadata — plain FACTS, rendered as a single quiet line. */
  facts?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex items-center gap-1.5">
        {kindColor && (
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: kindColor }} />
        )}
        <span className="t-label text-[var(--color-t3)]">{kind}</span>
      </div>

      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="t-display min-w-0 max-w-[22ch] text-balance text-[var(--color-t1)]">{name}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {facts && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{facts}</div>}
    </header>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────────────────────

/**
 * A section heading, weighted by TIER rather than styled uniformly.
 *
 * This is where the FACT / SIGNAL / DECISION grammar becomes hierarchy instead of just metadata:
 *   "decision" — the ranked layer the product is organised around. Brightest label, an accent
 *                marker, and a full-strength rule. It should be the second thing you read.
 *   "primary"  — the entity's own state (its project).
 *   "quiet"    — reference material (relationships, activity). Recedes deliberately.
 * Nothing here uses a card; emphasis is type weight, color, and rule strength.
 */
export function SectionLabel({
  children,
  aside,
  tier = "primary",
}: {
  children: ReactNode;
  aside?: ReactNode;
  tier?: "decision" | "primary" | "quiet";
}) {
  const isDecision = tier === "decision";
  const border = isDecision ? "border-[var(--color-line-strong)]" : "border-[var(--color-line)]";
  const color = isDecision
    ? "text-[var(--color-t1)]"
    : tier === "primary"
      ? "text-[var(--color-t2)]"
      : "text-[var(--color-t3)]";

  return (
    <div className={`mb-4 flex items-baseline justify-between gap-4 border-b ${border} pb-2`}>
      <h2 className={`t-section flex items-center gap-2 ${color}`}>
        {isDecision && (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
        )}
        {children}
      </h2>
      {aside && <div className="t-mono shrink-0 text-[var(--color-t3)]">{aside}</div>}
    </div>
  );
}

// ─── Facts and signals ─────────────────────────────────────────────────────────────────────────

/**
 * A headline number.
 *
 * `attribution` is what separates a SIGNAL from a FACT: a fact stands on its own (`13 open tasks`),
 * a signal names the engine that derived it (`35 · Health Engine`). Callers must not invent an
 * attribution for a value the vault simply contains.
 */
export function FactRow({
  value,
  label,
  detail,
  attribution,
  tone,
  lead = false,
}: {
  value: string;
  label: string;
  detail?: string;
  attribution?: string;
  tone?: Tone;
  /** The one figure that carries the entity's condition. Everything else is subordinate to it. */
  lead?: boolean;
}) {
  const color =
    tone === "risk"
      ? "var(--color-risk)"
      : tone === "good"
        ? "var(--color-good)"
        : tone === "accent"
          ? "var(--color-accent)"
          : "var(--color-t1)";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={lead ? "t-display tabular-nums" : "t-metric"}
        style={{ color, lineHeight: lead ? 0.92 : undefined }}
      >
        {value}
      </span>
      <span className={`t-label ${lead ? "text-[var(--color-t2)]" : "text-[var(--color-t3)]"}`}>
        {label}
      </span>
      {detail && (
        <span className={`t-meta ${lead ? "text-[var(--color-t1)]" : "text-[var(--color-t2)]"}`}>
          {detail}
        </span>
      )}
      {attribution && (
        <span className="t-mono text-[var(--color-t3)]" title="Derived by an Ascend engine">
          ↳ {attribution}
        </span>
      )}
    </div>
  );
}

/**
 * State layout: ONE dominant figure, then a subordinate cluster.
 *
 * The previous four-equal-columns arrangement was a KPI strip with the cards removed — health 35
 * (at risk) carried the same weight as $0 outstanding. Splitting the row gives the page a single
 * clear entry point and stops it reading as a dashboard.
 */
export function FactGrid({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  if (!lead) {
    return <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">{children}</div>;
  }
  return (
    // Left-aligned cluster rather than a stretched grid: the lead and its supporting figures must
    // read as ONE state row. Whitespace is left deliberately at the right instead of being filled.
    <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-11">
      <div className="shrink-0 sm:w-[172px]">{lead}</div>
      <div className="grid min-w-0 grid-cols-2 gap-x-9 gap-y-7 sm:flex sm:flex-wrap sm:gap-x-11">
        {children}
      </div>
    </div>
  );
}

// ─── Relationships ─────────────────────────────────────────────────────────────────────────────

export type RelationItem = {
  id: string;
  /** Primary text — what the thing is. */
  label: string;
  /** Secondary text — its state, amount, date. */
  detail?: string;
  /** Lifecycle word. Rendered as text, never as color alone. */
  status?: string;
  tone?: Tone;
  href?: string;
  /** Dot color — mirrors the node-type color in the graph, so the two views agree. */
  dotColor?: string;
};

/**
 * A relationship group. Deliberately a LIST, not a card grid: a client's invoices are a set of
 * peers, and the density of a list is what makes "9 invoices, one overdue" scannable at a glance.
 */
export function RelationshipList({
  items,
  empty,
  hidden = 0,
}: {
  items: RelationItem[];
  /** Honest empty state — an absent relationship stays absent; it is never padded with a placeholder. */
  empty: string;
  /** How many further items exist beyond those passed in. Truncation must always be stated. */
  hidden?: number;
}) {
  if (items.length === 0) {
    return <p className="t-meta py-1 text-[var(--color-t3)]">{empty}</p>;
  }

  return (
    <>
    <ul className="flex flex-col">
      {items.map((item) => {
        const inner = (
          <>
            {item.dotColor && (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: item.dotColor }}
              />
            )}
            <span className="t-body min-w-0 flex-1 truncate text-[var(--color-t1)]">{item.label}</span>
            {item.detail && (
              <span className="t-mono hidden shrink-0 text-[var(--color-t2)] sm:block">{item.detail}</span>
            )}
            {item.status && (
              <span className="w-[92px] shrink-0 text-right">
                <Status tone={item.tone ?? "neutral"}>{item.status}</Status>
              </span>
            )}
          </>
        );

        const base =
          "flex items-center gap-3 border-b border-[var(--color-line)] py-2.5 last:border-b-0";

        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                className={`${base} -mx-2 rounded-[var(--radius-sm)] px-2 transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)]`}
              >
                {inner}
              </Link>
            ) : (
              <div className={base}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
    {hidden > 0 && (
      <p className="t-mono pt-1.5 text-[var(--color-t3)]">
        +{hidden} more not shown
      </p>
    )}
    </>
  );
}

// ─── Progress ──────────────────────────────────────────────────────────────────────────────────

/** A thin progress rail. One bar, no chrome, no percentage badge stuck on the end. */
export function ProgressRail({
  value,
  tone = "accent",
  label,
}: {
  value: number;
  tone?: Tone;
  label?: string;
}) {
  const color =
    tone === "risk" ? "var(--color-risk)" : tone === "good" ? "var(--color-good)" : "var(--color-accent)";
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-line-strong)]"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
        />
      </span>
      <span className="t-mono w-10 shrink-0 text-right text-[var(--color-t2)]">{value}%</span>
    </div>
  );
}

// ─── Attention (DECISION) ──────────────────────────────────────────────────────────────────────

/**
 * A Decision Engine item.
 *
 * This is the DECISION tier of the grammar, and the only place a rank appears. The rank number and
 * the engine's own `explanation` are rendered verbatim — the surface never re-orders, re-weights, or
 * re-words them. Actions are the affordances; everything above them is read-only.
 */
export function AttentionItem({
  rank,
  subject,
  explanation,
  actions,
}: {
  rank: number;
  /** Omit on a page that already IS this subject — repeating the name there is pure noise. */
  subject?: string;
  explanation: string;
  actions?: ReactNode;
}) {
  return (
    // A left accent rule, not a card: it gives the ranked layer physical presence and a clear
    // reading edge while keeping the surface card-free.
    <article className="relative border-b border-[var(--color-line)] py-5 pl-5 last:border-b-0">
      <span
        aria-hidden
        className="absolute bottom-5 left-0 top-5 w-px bg-[var(--color-accent)] opacity-45"
      />
      <div className="flex items-baseline gap-3">
        <span className="t-mono shrink-0 text-[var(--color-accent)]">{String(rank).padStart(2, "0")}</span>
        {subject ? (
          <h3 className="t-h2 min-w-0 text-[var(--color-t1)]">{subject}</h3>
        ) : (
          // No subject heading: the explanation becomes the headline, set at reading measure so a
          // long engine sentence wraps into a paragraph instead of one run-on line.
          <p className="t-h2 min-w-0 max-w-[62ch] font-normal leading-[1.4] text-[var(--color-t1)]">
            {explanation}
          </p>
        )}
      </div>
      {subject && (
        <p className="t-body ml-8 mt-1.5 max-w-[62ch] text-[var(--color-t2)]">{explanation}</p>
      )}
      <p className="t-mono ml-8 mt-2 text-[var(--color-t3)]">↳ Decision Engine · rank {rank}</p>
      {actions && <div className="ml-8 mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
    </article>
  );
}

// ─── Empty ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A calm empty state. It states what is absent as a fact, without apology and without inventing a
 * call to action for data the operator may simply not have yet.
 */
export function QuietEmpty({ children }: { children: ReactNode }) {
  return <p className="t-meta py-3 text-[var(--color-t3)]">{children}</p>;
}