// app/production — THE BUILD SURFACE.
//
// The operational layer of the same operating system, answering:
//   what is being built · where is it stuck · what needs to happen next.
//
// It reads the real production state (`listProductionStates`), the Health Engine's verdict via
// Mission Control, and the Decision Engine's ranked feed. It INVENTS NO PROJECT-MANAGEMENT METRIC:
// the old page's "avg progress" across builds was a number no producer owned and nobody acts on,
// and it is gone. Every figure below is either a count of rows a producer already classified, or a
// value copied straight off a ProductionState.
//
// The phase rail is the recognizable system element shared with the Client and Project views —
// the same object drawn the same way at three zoom levels.
//
// Builds open at `/clients/:slug/project` (the canonical project route). `/production/:slug`
// remains reachable as the CHECKLIST EDITOR — it owns the writes — and is linked as such.

import Link from "next/link";
import type { Metadata } from "next";
import { listProductionStates, type ProductionState } from "@/core/production";
import { assembleHealthOverview, assemblePriorityFeed } from "@/mission-control";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
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
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Production · Ascend OS" };

const TIER_TONE: Record<string, Tone> = {
  at_risk: "risk",
  on_track: "neutral",
  healthy: "good",
};

function openCount(state: ProductionState): number {
  return state.phases.reduce((n, p) => n + p.checklist.filter((c) => !c.done).length, 0);
}

async function ProductionPageContent() {
  const [states, healthTiles, priority] = await Promise.all([
    listProductionStates(),
    assembleHealthOverview(), // Mission Control invokes the Health Engine — never the surface
    assemblePriorityFeed(), // Decision's order, consumed verbatim
  ]);

  const healthBySlug = new Map(healthTiles.map((t) => [t.clientSlug, t.health]));

  // A build is "in flight" when core/production says it has an active phase. That determination is
  // the reader's, not this page's.
  // These previously split on `activePhaseIndex === null`, which cannot tell "every phase is
  // terminal" from "the phase history is unknown" — so a project nobody knows anything about was
  // rendered under the heading "Launched · N live". `phaseState` is core/production's authoritative
  // answer (H4 §2.3); this page classifies nothing itself.
  const inFlight = states.filter((s) => s.phaseState === "in_flight");
  const launched = states.filter((s) => s.phaseState === "launched");
  const indeterminate = states.filter((s) => s.phaseState === "indeterminate");

  // V1 is 1:1 client:project, so a build's ranked attention is the feed entry for its slug.
  const buildSlugs = new Set(states.map((s) => s.clientSlug));
  const ranked = priority.filter((item) => buildSlugs.has(item.subject.id));
  const rankedBySlug = new Map<string, number>();
  for (const item of ranked) {
    rankedBySlug.set(item.subject.id, (rankedBySlug.get(item.subject.id) ?? 0) + 1);
  }

  const totalOpen = states.reduce((n, s) => n + openCount(s), 0);
  const atRisk = states.filter((s) => healthBySlug.get(s.clientSlug)?.tier === "at_risk");

  return (
    <PageShell hue={NODE_VISUAL.project.color}>
      <SurfaceHeader
        eyebrow="Work"
        title="Production"
        lede="Every build Ascend has in the vault — where each one stands, and what is holding it up."
      />

      {states.length === 0 ? (
        <QuietEmpty>
          Nothing in production. Drop a <span className="t-mono">production_state.md</span> into any
          client folder under <span className="t-mono">01 - CRM &amp; Clients/</span> — industry
          templates live in <span className="t-mono">03 - SOP Library/production-templates/</span>.
        </QuietEmpty>
      ) : (
        <>
          {/* ── STATE ────────────────────────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <FactGrid
              lead={
                <FactRow
                  lead
                  value={String(inFlight.length)}
                  label={inFlight.length === 1 ? "Build in flight" : "Builds in flight"}
                  detail={
                    `${launched.length} launched · ` +
                    (indeterminate.length > 0 ? `${indeterminate.length} unknown · ` : "") +
                    `${states.length} tracked`
                  }
                />
              }
            >
              <FactRow
                value={String(totalOpen)}
                label="Open tasks"
                detail="across every phase"
              />
              {/* Names are deliberately not listed: a two-name string is wider than every figure
                  beside it and skewed the cluster. Each build states its own tier in the list. */}
              <FactRow
                value={String(atRisk.length)}
                label="At risk"
                detail={`of ${healthTiles.length} scored`}
                attribution="Health Engine"
                tone={atRisk.length > 0 ? "risk" : undefined}
              />
              <FactRow
                value={String(ranked.length)}
                label="Flagged"
                detail={ranked.length === 0 ? "nothing ranked" : "ranked below"}
                attribution="Decision Engine"
                tone={ranked.length > 0 ? "accent" : undefined}
              />
            </FactGrid>
          </section>

          {/* ── WHAT NEEDS TO HAPPEN NEXT ────────────────────────────────────────────────────
              The engine's answer, not the page's. Verbatim explanations, Decision's order.

              The heading is "Needs a decision", not "Where it is stuck", and that wording is
              load-bearing: Decision's feed mixes health risks with opportunities, so a LAUNCHED
              project can appear here for a care-plan pitch. Calling that "stuck" would be the
              surface reinterpreting the engine's output — the exact thing it must not do. Every
              item here genuinely does need a decision; not every item is a blockage. */}
          {ranked.length > 0 && (
            <section className="mb-14">
              <SectionLabel tier="decision" aside={`${ranked.length} ranked`}>
                Needs a decision
              </SectionLabel>
              {ranked.map((item) => (
                <AttentionItem
                  key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
                  rank={item.rank}
                  subject={item.subject.name}
                  explanation={item.explanation.replace(/^because:\s*/i, "")}
                  actions={
                    <Link href={`/clients/${item.subject.id}/project`} className="contents">
                      <Button variant="ghost">Open build →</Button>
                    </Link>
                  }
                />
              ))}
            </section>
          )}

          {/* ── IN FLIGHT ────────────────────────────────────────────────────────────────────── */}
          {inFlight.length > 0 && (
            <section className="mb-14">
              <SectionLabel tier="primary" aside={`${inFlight.length} building`}>
                In flight
              </SectionLabel>
              <ul className="flex flex-col">
                {inFlight.map((state) => (
                  <BuildRow
                    key={state.clientSlug}
                    state={state}
                    health={healthBySlug.get(state.clientSlug) ?? null}
                    rankedItems={rankedBySlug.get(state.clientSlug) ?? 0}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* ── INDETERMINATE ────────────────────────────────────────────────────────────────
              Projects whose phase history Ascend cannot establish. Their own section because they
              are neither in flight nor launched, and folding them into either would be the OS
              asserting something it does not know. */}
          {indeterminate.length > 0 && (
            <section className="mb-14">
              <SectionLabel tier="quiet" aside={`${indeterminate.length} unresolved`}>
                Phase history unknown
              </SectionLabel>
              <ul className="flex flex-col">
                {indeterminate.map((state) => (
                  <BuildRow
                    key={state.clientSlug}
                    state={state}
                    health={healthBySlug.get(state.clientSlug) ?? null}
                    rankedItems={rankedBySlug.get(state.clientSlug) ?? 0}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* ── LAUNCHED ─────────────────────────────────────────────────────────────────────
              Finished work recedes: same row, lower contrast, no emphasis competing with the
              builds that still need decisions. */}
          {launched.length > 0 && (
            <section>
              <SectionLabel tier="quiet" aside={`${launched.length} live`}>
                Launched
              </SectionLabel>
              <ul className="flex flex-col opacity-75">
                {launched.map((state) => (
                  <BuildRow
                    key={state.clientSlug}
                    state={state}
                    health={healthBySlug.get(state.clientSlug) ?? null}
                    rankedItems={rankedBySlug.get(state.clientSlug) ?? 0}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

/** `score`/`tier` are null when health is uncomputable; the outer null means "no health at all". */
type HealthView = { score: number | null; tier: string | null } | null;

/**
 * One build in the index. Identity and position first, condition to the right, the phase rail
 * spanning the row beneath — so "where is it" is answerable before a single word is read.
 */
function BuildRow({
  state,
  health,
  rankedItems,
}: {
  state: ProductionState;
  health: HealthView;
  rankedItems: number;
}) {
  const activePhase =
    state.activePhaseIndex !== null ? state.phases[state.activePhaseIndex] : null;
  const open = openCount(state);

  const meta: string[] = [];
  // Three states, never two. "launched" is claimed only when phaseState says so — an indeterminate
  // project says so plainly rather than borrowing the launched label.
  if (activePhase) {
    meta.push(
      activePhase.progress !== null
        ? `${activePhase.label} phase · ${activePhase.progress}%`
        : `${activePhase.label} phase`
    );
  } else {
    meta.push(state.phaseState === "launched" ? "launched" : "phase history unknown");
  }
  meta.push(state.overallProgress !== null ? `${state.overallProgress}% overall` : "overall progress unknown");
  if (open > 0) meta.push(`${open} open`);
  if (state.industryTemplate) meta.push(`${state.industryTemplate} template`);
  meta.push(state.launchTarget ? `target ${state.launchTarget}` : "no launch target");

  return (
    <IndexRow
      href={`/clients/${state.clientSlug}/project`}
      name={state.clientName}
      markerColor={NODE_VISUAL.project.color}
      meta={meta.join(" · ")}
      state={
        <>
          {rankedItems > 0 && (
            <Badge tone="accent">{rankedItems === 1 ? "1 ranked" : `${rankedItems} ranked`}</Badge>
          )}
          {health && health.tier !== null ? (
            <span className="flex items-baseline gap-2">
              <Status tone={TIER_TONE[health.tier] ?? "neutral"}>
                {health.tier.replace("_", " ")}
              </Status>
              <span className="t-metric tabular-nums text-[var(--color-t2)]">{health.score}</span>
            </span>
          ) : health ? (
            // Health exists but is uncomputable — distinct from "no health at all", and never
            // silently blank: absence must be legible as absence.
            <Status tone="neutral">health unknown</Status>
          ) : (
            <span className="t-mono text-[var(--color-t3)]">not scored</span>
          )}
        </>
      }
      rail={
        <PhaseRail
          phases={state.phases}
          activeIndex={state.activePhaseIndex}
          interactive={false}
        />
      }
    />
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `ProductionPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function ProductionPage(...props: Parameters<typeof ProductionPageContent>) {
  return renderOrDenied("Production", () => ProductionPageContent(...props));
}
