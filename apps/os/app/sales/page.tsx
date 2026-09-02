// app/sales — THE PIPELINE SURFACE.
//
// The last primary operator surface still running a foreign visual system. It used `glass`,
// raw `zinc-*`, `ScrambleTitle` and `PageEntry` — a third language beside the Deep Field tokens and
// the transitional aliases. Worth recording why that mattered beyond taste: `.glass` was DELETED
// from globals.css during the Neural Core rewrite, so every panel on this page had been rendering
// as an unstyled transparent box ever since. That was a regression, not a style preference.
//
// COMPUTATION RETIRED: the page used to compute `avgScore` inline — an average across prospects
// that no producer owned — plus its own tier tallies. The frozen Pipeline Engine already produces
// exactly this funnel (per-stage count, share, avgScore, hotCount) and `assemblePipeline()` had
// ZERO consumers. The digest is now read from the engine and the invented aggregate is gone.
//
// ORDERING IS THE READER'S: `listProspects()` sorts score-desc with closed-lost last. The surface
// consumes that order and never re-sorts — scoring belongs to core/crm.computeScore, ranking to
// Decision, and neither is touched here.

import Link from "next/link";
import type { Metadata } from "next";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { listProspects, displayName, statusLabel, type Prospect } from "@/lib/sales";
import { assemblePipeline, type PipelineStage } from "@/mission-control";
import { routeForEntity } from "@/navigation/routing";
import { NODE_VISUAL, displayLabel } from "@/graph-view/taxonomy";
import { AddTargetForm } from "@/components/AddTargetForm";
import { Status, type Tone } from "@/components/primitives";
import {
  FactGrid,
  FactRow,
  IndexRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pipeline · Ascend OS" };

/**
 * Score tier → tone. A lookup on the scorer's own word (`cold` | `warm` | `hot` | `priority`); it
 * classifies nothing. Only `priority` earns accent — that is the tier that means "act now". `hot` is
 * notable but not yet an instruction, so it takes the neural teal instead.
 */
const TIER_TONE: Record<string, Tone> = {
  priority: "accent",
  hot: "neural",
  warm: "neutral",
  cold: "neutral",
};

/** Stage → tone. Terminal stages read as outcomes; open stages stay quiet. */
const STAGE_TONE: Record<string, Tone> = {
  "closed-won": "good",
  "closed-lost": "neutral",
};

async function SalesPageContent() {
  const [prospects, pipeline] = await Promise.all([
    listProspects(),
    assemblePipeline(), // Mission Control invokes the Pipeline Engine — never the surface
  ]);

  // Selection by the reader's own status field. No status is derived here.
  const open = prospects.filter((p) => p.frontmatter.status !== "closed-lost");
  const lost = prospects.filter((p) => p.frontmatter.status === "closed-lost");

  const stageBy = (status: string): PipelineStage | undefined =>
    pipeline.stages.find((s) => s.status === status);
  const won = stageBy("closed-won");

  const maxStageCount = Math.max(1, ...pipeline.stages.map((s) => s.count));

  return (
    <PageShell hue={NODE_VISUAL.prospect.color}>
      <SurfaceHeader
        eyebrow="Work"
        title="Pipeline"
        lede="Every target Ascend is tracking — where each one sits in the funnel, and what it scored."
      />

      {/* ── STATE ────────────────────────────────────────────────────────────────────────────
          Every figure is a field the Pipeline Engine produced. Nothing is averaged here. */}
      <section className="mb-14">
        <FactGrid
          lead={
            <FactRow
              lead
              value={String(pipeline.openCount)}
              label={pipeline.openCount === 1 ? "Open target" : "Open targets"}
              detail={`${pipeline.totalCount} tracked in total`}
            />
          }
        >
          <FactRow
            value={String(won?.count ?? 0)}
            label="Closed-won"
            detail="promoted or ready to promote"
            attribution="Pipeline Engine"
            tone={won && won.count > 0 ? "good" : undefined}
          />
          <FactRow
            value={String(stageBy("closed-lost")?.count ?? 0)}
            label="Closed-lost"
            detail="no longer pursued"
            attribution="Pipeline Engine"
          />
        </FactGrid>
      </section>

      {/* ── FUNNEL ───────────────────────────────────────────────────────────────────────────
          The engine's digest rendered as-is. Every stage is shown even at zero, because "0
          proposals" is the informative case — that is the engine's own decision (PL-5), not a
          presentation choice made here. */}
      <section className="mb-14">
        <SectionLabel tier="primary" aside="↳ Pipeline Engine">
          Funnel
        </SectionLabel>
        <ul className="flex flex-col">
          {pipeline.stages.map((stage) => (
            <li
              key={stage.status}
              className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-b border-[var(--color-line)] py-3 last:border-b-0"
            >
              <span className="w-[104px] shrink-0">
                <Status tone={STAGE_TONE[stage.status] ?? "neutral"}>{stage.label}</Status>
              </span>

              <span className="t-metric w-[42px] shrink-0 tabular-nums text-[var(--color-t1)]">
                {stage.count}
              </span>

              {/* Share bar — the engine's `share`, drawn relative to the largest stage so a funnel
                  of 3 / 1 / 0 is legible rather than three near-identical slivers. */}
              <span className="flex min-w-[120px] flex-1 items-center gap-3">
                <span
                  aria-hidden
                  className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-line-strong)]"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(stage.count / maxStageCount) * 100}%`,
                      background:
                        stage.status === "closed-won"
                          ? "var(--color-good)"
                          : stage.status === "closed-lost"
                            ? "var(--color-line-strong)"
                            : "var(--color-neural)",
                    }}
                  />
                </span>
                <span className="t-mono w-10 shrink-0 text-right text-[var(--color-t3)]">
                  {stage.share}%
                </span>
              </span>

              <span className="t-mono shrink-0 text-[var(--color-t3)]">
                {stage.avgScore === null ? "no scores" : `avg ${stage.avgScore}`}
                {stage.hotCount > 0 && ` · ${stage.hotCount} hot`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── ACTION ─────────────────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionLabel tier="primary">Add a target</SectionLabel>
        <AddTargetForm />
        {/* The bulk path, one link and no panel. It moved out of `/admin` at 2G.4.7 — it creates
            prospects, so it belongs to this surface — and without a link from here it would be a
            page nothing reaches: `/admin` is owner-only and does not list it any more. */}
        <p className="t-mono mt-3 text-[var(--color-t3)]">
          Many at once?{" "}
          <Link href="/sales/import" className="text-[var(--color-t2)] underline underline-offset-2">
            Import from CSV
          </Link>
        </p>
      </section>

      {/* ── THE INDEX ────────────────────────────────────────────────────────────────────────
          In the reader's order: highest score first. The surface does not re-sort. */}
      <section>
        {/* NOT "open": the engine's `openCount` means lead/contacted/proposal, while this list is
            everything that is not closed-lost. Using one word for two counts on the same page read
            as an inconsistency. The list says what it is showing. */}
        <SectionLabel tier="primary" aside={`${open.length} listed · by score`}>
          Targets
        </SectionLabel>

        {prospects.length === 0 ? (
          <QuietEmpty>
            No targets yet. Add one above, or drop markdown files into{" "}
            <span className="t-mono">02 - Sales &amp; Hit List/</span> — one file per target.
          </QuietEmpty>
        ) : (
          <>
            {open.length > 0 ? (
              <ul className="flex flex-col">
                {open.map((p) => (
                  <ProspectIndexRow key={p.slug} prospect={p} />
                ))}
              </ul>
            ) : (
              <QuietEmpty>Every tracked target is closed-lost.</QuietEmpty>
            )}

            {lost.length > 0 && (
              // Lost work recedes: present and reachable, never competing with live targets.
              <details className="group mt-8">
                <summary className="t-label cursor-pointer list-none text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
                  <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                    ▸
                  </span>{" "}
                  Closed-lost · {lost.length}
                </summary>
                <ul className="mt-2 flex flex-col opacity-70">
                  {lost.map((p) => (
                    <ProspectIndexRow key={p.slug} prospect={p} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </PageShell>
  );
}

/**
 * One target in the index. Score is the condition on the right — it is the number the operator
 * actually works from — with the scorer's tier stated as a word beside it so the tone is never the
 * only carrier.
 */
function ProspectIndexRow({ prospect }: { prospect: Prospect }) {
  const fm = prospect.frontmatter;
  const score = prospect.score;
  const href = routeForEntity("prospect", prospect.slug) ?? `/sales/${prospect.slug}`;

  const meta = [
    // Not `?? "lead"` — an unrecorded status renders as unknown, not as a pipeline position.
    typeof fm.status === "string" && fm.status.trim() ? statusLabel(fm.status) : "Unknown status",
    [fm.business_type, fm.location].filter(Boolean).join(" · "),
  ]
    .filter((s) => s && s.length > 0)
    .join(" · ");

  return (
    <IndexRow
      href={href}
      name={displayLabel(displayName(prospect))}
      markerColor={NODE_VISUAL.prospect.color}
      meta={meta}
      state={
        <span className="flex items-baseline gap-2.5">
          <Status tone={TIER_TONE[score.tier] ?? "neutral"}>{score.tier}</Status>
          <span className="t-metric tabular-nums text-[var(--color-t1)]">{score.score}</span>
          <span className="t-mono text-[var(--color-t3)]">/ {score.max}</span>
        </span>
      }
    />
  );
}

// ─── WRAPPED FOR THE REVOCATION SURFACE, NOT FOR A DENIAL (2G.4.5, STAGE2G §29.3 Ruling 3) ─────
//
// This page demands a capability a sales principal HOLDS, so it has no `CapabilityDenied` to
// convert and did not need `renderOrDenied` while the only convertible refusal was that one.
// `AccountRefused` changes that: a revoked, unmembered or unknown account reaches EVERY page that
// requests authority, and unwrapped it would reach `app/error.tsx` — which is parked finding 2
// itself, surviving in the four pages nobody had reason to wrap. Wrapping costs nothing for the
// principals who hold the capability and is the difference between a named surface and an outage
// message for the one who no longer does.

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function SalesPage(...props: Parameters<typeof SalesPageContent>) {
  return renderOrDenied("Pipeline", () => SalesPageContent(...props));
}
