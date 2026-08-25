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

/**
 * A SURFACE header — for the operator surfaces (Signals, Documents, Finance) as opposed to a
 * single entity. Same typographic system as EntityHeader, but it carries no node identity: a
 * surface is a lens over many objects, not one object.
 *
 * Extracted because three surfaces need the identical arrangement. It is not a generic framework.
 */
export function SurfaceHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  /** One sentence stating what this surface is FOR. Quiet — it is orientation, not content. */
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10">
      <p className="t-label text-[var(--color-t3)]">{eyebrow}</p>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="t-display min-w-0 text-[var(--color-t1)]">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {lede && <p className="t-body mt-3 max-w-[60ch] text-[var(--color-t2)]">{lede}</p>}
    </header>
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
            {/* Wraps rather than truncates. A document called "Phase 2 SOW Portfolio expansion v1"
                was cut mid-title at 1024px, and the truncated remainder is exactly the part that
                distinguishes it from its siblings. Variable row height is the cheaper cost. */}
            <span className="t-body min-w-0 flex-1 text-[var(--color-t1)]">{item.label}</span>
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
/**
 * A progress rail. `value: null` means the progress is not computable — rendered as a visibly
 * indeterminate rail reading "unknown", NEVER as an empty rail, which is pixel-identical to a
 * genuine 0% and would restore the exact confusion the nullable model removes (H2 §11.3).
 *
 * The ARIA node drops `aria-valuenow` when indeterminate, which is how the platform already
 * expresses "in progress, amount unknown" — so assistive tech is told the same thing as the eye.
 */
export function ProgressRail({
  value,
  tone = "accent",
  label,
}: {
  value: number | null;
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
        {...(value !== null ? { "aria-valuenow": value } : {})}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        {value === null ? (
          <span className="block h-full w-full rounded-full bg-[repeating-linear-gradient(45deg,var(--color-line-strong)_0px,var(--color-line-strong)_3px,transparent_3px,transparent_6px)]" />
        ) : (
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
          />
        )}
      </span>
      <span className="t-mono w-14 shrink-0 text-right text-[var(--color-t2)]">
        {value === null ? "unknown" : `${value}%`}
      </span>
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

// ─── Activity (EVENT) ──────────────────────────────────────────────────────────────────────────

export type ActivityItem = {
  id: string;
  /** What happened, in plain language. Phrasing only — the caller derives nothing. */
  label: string;
  /** A qualifier copied from the event's own payload (which phase, which document). */
  qualifier?: string | null;
  /** The transition this event records, e.g. `sent → draft`. Read from the payload, never inferred. */
  detail?: string | null;
  /** Which part of the business recorded it — the event's own log domain. */
  attribution?: string | null;
  when: string;
  /** ISO timestamp, used only for day grouping. */
  occurredAt?: string;
  /** The subject's canonical route, from navigation/routing. `null` ⇒ the row stays inert. */
  href?: string | null;
  /** The subject's Neural Core href, from the graph contract. `null` ⇒ not representable as a node. */
  focusHref?: string | null;
  /** Node-type color, so an event agrees with the graph about what kind of thing it touched. */
  dotColor?: string;
};

/**
 * The event log for one entity — and the RETURN PATH of the product's loop.
 *
 * Before this existed, activity rendered as inert text on every surface: the loop ran
 * Graph → Entity → Intelligence → Decision → Action → Event and then stopped dead. Yet every
 * `EventEnvelope` carries `subject: { entity, entity_id }`, which is precisely what
 * `routeForEntity` and `graphNodeIdFor` consume — the destinations were already in the envelope,
 * simply unused. No new data, reader, or engine was needed to close it.
 *
 * Both hrefs are resolved by the CALLER through the canonical owners and passed in, so this
 * component knows nothing about routes or graph identity. An event whose subject resolves to
 * neither renders exactly as it did before: readable, and honestly non-navigable.
 */
export function ActivityList({
  items,
  empty,
  groupByDay = false,
}: {
  items: ActivityItem[];
  empty: string;
  /**
   * Group consecutive items under their date.
   *
   * "What changed" is read as a chronology, so the date is the structure rather than a value on
   * each row — one date heading beats eight repeated timestamps. Flat lists (the project view)
   * keep the relative time inline instead.
   */
  groupByDay?: boolean;
}) {
  if (items.length === 0) return <QuietEmpty>{empty}</QuietEmpty>;

  if (groupByDay) {
    const days: { key: string; label: string; items: ActivityItem[] }[] = [];
    for (const item of items) {
      const key = (item.occurredAt ?? "").slice(0, 10);
      const last = days[days.length - 1];
      if (last && last.key === key) last.items.push(item);
      else
        days.push({
          key,
          label: key
            ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : "—",
          items: [item],
        });
    }
    return (
      <div className="flex flex-col">
        {days.map((day) => (
          <div key={day.key} className="flex flex-col gap-x-6 sm:flex-row">
            <p className="t-mono shrink-0 pt-3.5 text-[var(--color-t3)] sm:w-[64px]">{day.label}</p>
            <ul className="min-w-0 flex-1">
              {day.items.map((item) => (
                <ChangeRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const body = (
          <>
            {item.dotColor && (
              <span
                aria-hidden
                className="size-1.5 shrink-0 translate-y-[-1px] rounded-full"
                style={{ background: item.dotColor }}
              />
            )}
            <span className="t-body min-w-0 text-[var(--color-t2)]">
              {item.label}
              {item.qualifier && <span className="text-[var(--color-t3)]"> · {item.qualifier}</span>}
            </span>
          </>
        );

        return (
          <li
            key={item.id}
            className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 items-baseline gap-2.5">
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex min-w-0 items-baseline gap-2.5 transition-colors duration-[120ms] hover:[&_span]:text-[var(--color-accent)]"
                >
                  {body}
                </Link>
              ) : (
                body
              )}
            </span>

            <span className="flex shrink-0 items-baseline gap-3">
              {/* Event → Graph. Quiet by design: it is a way back to the spatial view, not an
                  action, so it never competes with the Decision tier above it. */}
              {item.focusHref && (
                <Link
                  href={item.focusHref}
                  aria-label={`Focus ${item.label} in the Neural Core`}
                  className="t-mono text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-neural)]"
                >
                  ◎
                </Link>
              )}
              <span className="t-mono text-[var(--color-t3)]">{item.when}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One recorded change.
 *
 * FACT grammar, deliberately: a change is something that happened, not something inferred, so it
 * stays quiet. The transition is shown exactly as the event stored it, the source names which part
 * of the business recorded it, and both destinations come from the event's own subject. Nothing is
 * summarised and no narrative is generated — if the stored event cannot answer what happened, to
 * what, and when, there is nothing here to render.
 */
function ChangeRow({ item }: { item: ActivityItem }) {
  const body = (
    <>
      {/* The marker slot is ALWAYS occupied, transparent when the subject's kind has no node color
          (a portal invite is not a graph node). Rendering it conditionally shifted those rows'
          text left and broke the column the chronology reads down. */}
      <span
        aria-hidden
        className="mt-[7px] size-1.5 shrink-0 rounded-full"
        style={{ background: item.dotColor ?? "transparent" }}
      />
      <span className="min-w-0">
        <span className="t-body text-[var(--color-t1)]">{item.label}</span>
        {item.qualifier && (
          <span className="t-body text-[var(--color-t3)]"> · {item.qualifier}</span>
        )}
      </span>
    </>
  );

  return (
    <li className="border-b border-[var(--color-line)] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        {item.href ? (
          <Link
            href={item.href}
            className="flex min-w-0 items-start gap-2.5 transition-colors duration-[120ms] hover:[&_span]:text-[var(--color-accent)]"
          >
            {body}
          </Link>
        ) : (
          <span className="flex min-w-0 items-start gap-2.5">{body}</span>
        )}
        {item.focusHref && (
          <Link
            href={item.focusHref}
            aria-label={`Focus ${item.label} in the Neural Core`}
            className="t-mono shrink-0 text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-neural)]"
          >
            ◎
          </Link>
        )}
      </div>
      {item.detail && (
        <p className="t-mono mt-1 text-[var(--color-t2)]">{item.detail}</p>
      )}
      {item.attribution && (
        <p className="t-mono mt-1 text-[var(--color-t3)]">↳ {item.attribution}</p>
      )}
    </li>
  );
}

// ─── Index row ─────────────────────────────────────────────────────────────────────────────────

/**
 * One entity in an INDEX — the operator surfaces that list many objects of one kind
 * (Clients, Production, Tasks, Maintenance).
 *
 * An index is not a grid of cards. It is an editorial list: identity is the largest thing in the
 * row, its state sits to the right where the eye finishes, and structure comes from a hairline
 * between rows. The entity's TYPE color appears only as a small marker beside the name — identity,
 * not decoration.
 *
 * `stretch` makes the whole row clickable using a single stretched anchor rather than wrapping the
 * row in a link. That keeps exactly ONE interactive element in the row: no nested anchors, and
 * screen readers announce one link with the entity's name rather than the row's entire contents.
 * A row that carries its own buttons must pass `stretch={false}` (or no `href`) — an overlay would
 * otherwise sit on top of them.
 */
export function IndexRow({
  href,
  name,
  markerColor,
  meta,
  state,
  rail,
  stretch = true,
  children,
}: {
  href?: string;
  name: string;
  /** The node-type color used in the graph, so index and graph agree on what kind of thing this is. */
  markerColor?: string;
  /** Mono metadata beneath the name — slug, phase, template. Facts, kept quiet. */
  meta?: ReactNode;
  /** Right-aligned condition cluster. On mobile it wraps beneath the name rather than truncating. */
  state?: ReactNode;
  /** Full-width band below the identity line — a progress rail or phase rail. */
  rail?: ReactNode;
  stretch?: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      className={`relative border-b border-[var(--color-line)] py-4 last:border-b-0 ${
        href && stretch
          ? "-mx-3 rounded-[var(--radius-sm)] px-3 transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)]"
          : ""
      }`}
    >
      <div className="flex flex-col gap-x-6 gap-y-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="flex min-w-0 items-baseline gap-2.5">
          {markerColor && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 translate-y-[-2px] rounded-full"
              style={{ background: markerColor }}
            />
          )}
          <div className="min-w-0">
            {/* Long business names are real and wrap rather than truncate — the name is identity. */}
            {href ? (
              <Link
                href={href}
                className={`t-h2 text-[var(--color-t1)] transition-colors duration-[120ms] hover:text-[var(--color-accent)] ${
                  stretch ? "after:absolute after:inset-0 after:content-['']" : ""
                }`}
              >
                {name}
              </Link>
            ) : (
              <span className="t-h2 text-[var(--color-t1)]">{name}</span>
            )}
            {meta && <p className="t-mono mt-1 text-[var(--color-t3)]">{meta}</p>}
          </div>
        </div>

        {state && (
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 sm:justify-end">
            {state}
          </div>
        )}
      </div>

      {rail && <div className="mt-3.5">{rail}</div>}
      {children}
    </li>
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