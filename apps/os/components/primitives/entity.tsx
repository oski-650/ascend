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
 * A max-width editorial column. Entity surfaces are documents, not canvases.
 * `pt-10` below `md` clears the fixed nav-drawer button, which otherwise sits on the breadcrumb.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="anim-enter mx-auto w-full max-w-[1100px] pb-24 pt-10 md:pt-0">{children}</div>;
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

/** A hairline-ruled section heading. The alternative to wrapping every group in a card. */
export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-2">
      <h2 className="t-section text-[var(--color-t3)]">{children}</h2>
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
}: {
  value: string;
  label: string;
  detail?: string;
  attribution?: string;
  tone?: Tone;
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
      <span className="t-metric-xl" style={{ color }}>
        {value}
      </span>
      <span className="t-label text-[var(--color-t3)]">{label}</span>
      {detail && <span className="t-meta text-[var(--color-t2)]">{detail}</span>}
      {attribution && (
        <span className="t-mono text-[var(--color-t3)]" title="Derived by an Ascend engine">
          ↳ {attribution}
        </span>
      )}
    </div>
  );
}

/** A row of headline numbers, separated by whitespace rather than card borders. */
export function FactGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">{children}</div>;
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
    <article className="border-b border-[var(--color-line)] py-4 last:border-b-0">
      <div className="flex items-baseline gap-2.5">
        <span className="t-mono shrink-0 text-[var(--color-accent)]">{String(rank).padStart(2, "0")}</span>
        {subject ? (
          <h3 className="t-h2 min-w-0 text-[var(--color-t1)]">{subject}</h3>
        ) : (
          // No subject heading: the explanation becomes the headline, at heading weight.
          <p className="t-h2 min-w-0 font-normal text-[var(--color-t1)]">{explanation}</p>
        )}
      </div>
      {subject && <p className="t-body mt-1.5 pl-8 text-[var(--color-t2)]">{explanation}</p>}
      <p className="t-mono mt-1.5 pl-8 text-[var(--color-t3)]">↳ Decision Engine · rank {rank}</p>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">{actions}</div>}
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