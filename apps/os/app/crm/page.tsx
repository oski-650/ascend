// app/crm — THE CLIENTS SURFACE.
//
// The roster of every relationship Ascend has, answering in order:
//   who needs my attention · what state is each one in · what happens if I open one.
//
// It is an editorial INDEX, not a grid of cards. The old page showed name + slug and nothing else;
// every fact here already existed in the system and was simply never surfaced.
//
// ORDERING IS NOT INVENTED. Two producers' orders are shown side by side and never blended:
//   • "Needs attention" is the Decision Engine's feed, verbatim, in its rank order.
//   • The index below is `listClients()`'s own alphabetical order — a stable directory.
// Nothing here re-sorts by health, money, or recency; a roster that silently reorders itself is
// a ranking, and ranking belongs to Decision.
//
// Every client opens at the canonical route `/clients/:slug` (via navigation/routing, the single
// owner). This surface creates no second client destination.

import Link from "next/link";
import type { Metadata } from "next";
import { getRoster, type ClientRow } from "./roster";
import { routeForEntity } from "@/navigation/routing";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { formatUsd } from "@/lib/ehr";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import { PhaseRail } from "@/components/primitives/phase";
import {
  AttentionItem,
  FactGrid,
  FactRow,
  IndexRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Clients · Ascend OS" };

/**
 * Health tier → tone. A lookup on the engine's own word (`healthy` | `on_track` | `at_risk`); it
 * classifies nothing. `on_track` is deliberately NEUTRAL, not accent: accent means the operator must
 * act, and a project that is on track does not.
 */
const TIER_TONE: Record<string, Tone> = {
  at_risk: "risk",
  on_track: "neutral",
  healthy: "good",
};

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

export default async function ClientsPage() {
  const { rows, ranked } = await getRoster();

  // Counting rows that already carry a producer's verdict is selection, not classification.
  const withProject = rows.filter((r) => r.production !== null);
  // `activePhaseIndex != null` counted an indeterminate project as NOT building — a claim about a
  // project whose state is unknown. `phaseState` is the producer's own verdict (H4 §2.3).
  const building = rows.filter((r) => r.production?.phaseState === "in_flight");
  const unknownState = rows.filter((r) => r.production?.phaseState === "indeterminate");
  const atRisk = rows.filter((r) => r.health?.tier === "at_risk");
  const owed = rows.reduce((sum, r) => sum + r.openInvoiceTotal, 0);

  return (
    <PageShell hue={NODE_VISUAL.client.color}>
      <SurfaceHeader
        eyebrow="Work"
        title="Clients"
        lede="Every relationship Ascend holds — who needs attention, what state they are in, and what is owed."
      />

      {/* ── STATE OF THE ROSTER ───────────────────────────────────────────────────────────────
          One dominant figure with a subordinate cluster, matching the Client and Finance views.
          Each value is a count of something a producer already decided, or a sum of amounts. */}
      <section className="mb-14">
        <FactGrid
          lead={
            <FactRow
              lead
              value={String(rows.length)}
              label={rows.length === 1 ? "Client" : "Clients"}
              detail={
                // NOT `withProject - building`: that subtraction assigned every non-building
                // project to "launched", including the ones whose phase history is unknown.
                `${building.length} building · ` +
                `${withProject.length - building.length - unknownState.length} launched` +
                (unknownState.length > 0 ? ` · ${unknownState.length} unknown` : "")
              }
            />
          }
        >
          {/* The at-risk names are NOT listed here: a two-name string is wider than the three
              figures beside it and skewed the whole cluster. Each at-risk client states its own
              tier in the index below, which is where you would act on it. */}
          <FactRow
            value={String(atRisk.length)}
            label="At risk"
            detail={`of ${rows.filter((r) => r.health !== null).length} scored`}
            attribution="Health Engine"
            tone={atRisk.length > 0 ? "risk" : undefined}
          />
          <FactRow
            value={formatUsd(owed)}
            label="Outstanding"
            detail={`across ${rows.filter((r) => r.openInvoiceCount > 0).length} client${
              rows.filter((r) => r.openInvoiceCount > 0).length === 1 ? "" : "s"
            }`}
          />
          <FactRow
            value={String(rows.filter((r) => r.retainerActive).length)}
            label="On retainer"
            detail="care plans running"
          />
        </FactGrid>
      </section>

      {/* ── DECISION ─────────────────────────────────────────────────────────────────────────
          The Decision Engine's own feed, restricted to client subjects. Order and wording are
          consumed verbatim; the surface neither re-ranks nor paraphrases. */}
      {ranked.length > 0 && (
        <section className="mb-14">
          <SectionLabel tier="decision" aside={`${ranked.length} ranked`}>
            Needs attention
          </SectionLabel>
          {ranked.map((item) => (
            <AttentionItem
              key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
              rank={item.rank}
              subject={item.subject.name}
              explanation={item.explanation.replace(/^because:\s*/i, "")}
              actions={
                <Link href={`/clients/${item.subject.id}`} className="contents">
                  <Button variant="ghost">Open client →</Button>
                </Link>
              }
            />
          ))}
        </section>
      )}

      {/* ── THE INDEX ────────────────────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel tier="primary" aside={`${rows.length} total · A–Z`}>
          All clients
        </SectionLabel>

        {rows.length === 0 ? (
          <QuietEmpty>
            No clients in the vault yet. Add a client folder under{" "}
            <span className="t-mono">01 - CRM &amp; Clients/</span> with its four profile files —{" "}
            <span className="t-mono">npm run scaffold:vault</span> creates one to copy.
          </QuietEmpty>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <ClientIndexRow key={row.slug} row={row} />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

/**
 * One client in the index.
 *
 * The row answers "what happens if I open this" before it is opened: identity, where the build is,
 * what it is worth, and whether anything is wrong. The phase rail is the same element used on the
 * Project view and on Production — one system element seen at three zoom levels.
 */
function ClientIndexRow({ row }: { row: ClientRow }) {
  const href = routeForEntity("client", row.slug) ?? `/clients/${row.slug}`;
  const production = row.production;
  const activePhase =
    production && production.activePhaseIndex !== null
      ? production.phases[production.activePhaseIndex]
      : null;
  const openTasks =
    production?.phases.reduce((n, p) => n + p.checklist.filter((c) => !c.done).length, 0) ?? 0;

  // Facts, in the order the eye should collect them. Joined by "·" as one quiet mono line.
  const meta: string[] = [];
  if (production) {
    meta.push(activePhase ? `${activePhase.label} phase` : "launched");
    if (openTasks > 0) meta.push(`${openTasks} open task${openTasks === 1 ? "" : "s"}`);
  } else {
    meta.push("no project");
  }
  if (row.openInvoiceCount > 0) meta.push(`${formatUsd(row.openInvoiceTotal)} outstanding`);
  if (row.retainerActive) meta.push("retainer active");
  if (row.lastEventAt) meta.push(relativeDay(row.lastEventAt));

  return (
    <IndexRow
      href={href}
      name={row.name}
      markerColor={NODE_VISUAL.client.color}
      meta={meta.join(" · ")}
      state={
        <>
          {/* ATTENTION — accent is earned here: this client is on the Decision feed. */}
          {row.attention.length > 0 && (
            <Badge tone="accent">
              {row.attention.length === 1
                ? "1 ranked item"
                : `${row.attention.length} ranked items`}
            </Badge>
          )}
          {row.overdueCount > 0 && (
            <Status tone="risk">
              {row.overdueCount} overdue
            </Status>
          )}
          {/* SIGNAL — health names the engine that derived it, and states the tier as a word so
              the marker color is never the only carrier. */}
          {row.health && row.health.tier !== null ? (
            <span className="flex items-baseline gap-2">
              <Status tone={TIER_TONE[row.health.tier] ?? "neutral"}>
                {row.health.tier.replace("_", " ")}
              </Status>
              <span className="t-metric tabular-nums text-[var(--color-t2)]">
                {row.health.score}
              </span>
            </span>
          ) : row.health ? (
            <Status tone="neutral">health unknown</Status>
          ) : (
            <span className="t-mono text-[var(--color-t3)]">not scored</span>
          )}
        </>
      }
      rail={
        production ? (
          // Non-interactive: the row is already one stretched link, and there is no phase detail
          // on this page to jump to.
          <PhaseRail
            phases={production.phases}
            activeIndex={production.activePhaseIndex}
            interactive={false}
          />
        ) : undefined
      }
    />
  );
}