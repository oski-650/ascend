// app/clients/[slug]/project — THE PROJECT VIEW. One layer deeper into the same object.
//
// Project identity IS the client in V1 (core/production, Decision 3), so this is a child route of
// the client rather than a sibling — the URL states the containment the domain already asserts.
//
// It reuses the existing production data shape (`getProductionState`) and the existing Health /
// Decision outputs. It rebuilds no project state and computes nothing; the old PhaseLadder /
// PhaseChecklist styling is deliberately not carried over, only their data shape.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { focusHrefFor } from "@/graph-view/contract";
import { Badge, Button } from "@/components/primitives";
import {
  ActivityList,
  AttentionItem,
  Breadcrumb,
  EntityHeader,
  FactGrid,
  FactRow,
  PageShell,
  ProgressRail,
  QuietEmpty,
  RelationshipList,
  SectionLabel,
  type RelationItem,
} from "@/components/primitives/entity";
import { PhaseRail, PhaseRow } from "@/components/primitives/phase";
import { getClientDossier, toActivityItems } from "../dossier";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dossier = await getClientDossier(slug);
  return { title: dossier ? `${dossier.client.name} · Project · Ascend OS` : "Project · Ascend OS" };
}

async function ProjectPageContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dossier = await getClientDossier(slug);
  if (!dossier) notFound();

  const { client, production, health, audits, attention, activity } = dossier;
  // A client can exist without a production_state.md — that is a real vault state, not an error.
  if (!production) notFound();

  const activeIndex = production.activePhaseIndex;
  const activePhase = activeIndex !== null ? production.phases[activeIndex] : null;
  const openTasks = production.phases.reduce(
    (n, p) => n + p.checklist.filter((c) => !c.done).length,
    0
  );
  const totalTasks = production.phases.reduce((n, p) => n + p.checklist.length, 0);
  const completePhases = production.phases.filter((p) => p.status === "complete").length;

  // Graph identity comes from the contract that defines it, never a hand-built string (F19).
  const graphHref = focusHrefFor("project", slug);

  return (
    <PageShell hue={NODE_VISUAL.project.color}>
      <Breadcrumb
        items={[
          { label: "Neural Core", href: "/" },
          { label: client.name, href: `/clients/${slug}` },
          { label: "Project" },
        ]}
      />

      <EntityHeader
        kind="Project"
        kindColor={NODE_VISUAL.project.color}
        name={`${production.clientName} · Build`}
        facts={
          <>
            <Badge tone={activePhase ? "accent" : "good"}>
              {activePhase ? `${activePhase.label} phase` : "launched"}
            </Badge>
            {production.industryTemplate && <Badge>{production.industryTemplate} template</Badge>}
            <span className="t-mono text-[var(--color-t3)]">
              {production.launchTarget ? `launch target ${production.launchTarget}` : "no launch target"}
            </span>
          </>
        }
        actions={
          <>
            {graphHref && (
              <Link href={graphHref} className="contents">
                <Button variant="ghost">Focus in Neural Core</Button>
              </Link>
            )}
            <Link href={`/production/${slug}`} className="contents">
              <Button variant="ghost">Edit checklist</Button>
            </Link>
          </>
        }
      />

      {/* ── WHERE IS IT ──────────────────────────────────────────────────────────────────────
          The rail answers the positional question before any number is read. */}
      <section className="mb-11">
        <PhaseRail phases={production.phases} activeIndex={activeIndex} />
      </section>

      {/* ── STATE ────────────────────────────────────────────────────────────────────────── */}
      <section className="mb-11">
        <FactGrid
          lead={
            <FactRow
              lead
              value={production.overallProgress !== null ? `${production.overallProgress}%` : "?"}
              label="Overall progress"
              detail={
                production.overallProgress !== null
                  ? `${completePhases} of ${production.phases.length} phases complete`
                  : `phase history unknown · ${completePhases} of ${production.phases.length} confirmed complete`
              }
            />
          }
        >
          {health && health.tier !== null ? (
            <FactRow
              value={String(health.score)}
              label="Health"
              detail={health.tier.replace("_", " ")}
              attribution="Health Engine"
              tone={health.tier === "at_risk" ? "risk" : health.tier === "healthy" ? "good" : undefined}
            />
          ) : health ? (
            <FactRow
              value="?"
              label="Health"
              detail="cannot be determined"
              attribution="Health Engine"
            />
          ) : (
            <FactRow value="—" label="Health" detail="not scored" />
          )}
          <FactRow
            value={String(openTasks)}
            label="Open tasks"
            detail={`${totalTasks - openTasks} of ${totalTasks} done`}
          />
          <FactRow
            value={activePhase ? activePhase.label : "—"}
            label="Current phase"
            detail={
              activePhase
                ? activePhase.progress !== null
                  ? `${activePhase.progress}% through`
                  : "progress unknown"
                : production.phaseState === "launched"
                  ? "all phases resolved"
                  : "phase history unknown"
            }
            tone={activePhase ? "accent" : undefined}
          />
        </FactGrid>

        {health && (
          <div className="mt-8 max-w-[520px]">
            {/* Health's own breakdown, rendered as the engine produced it. */}
            <p className="t-label mb-2.5 text-[var(--color-t3)]">Health breakdown ↳ Health Engine</p>
            <div className="flex flex-col gap-2">
              <Breakdown label="Progress" value={health.breakdown.progress} />
              <Breakdown label="Momentum" value={health.breakdown.momentum} />
              <Breakdown label="Schedule" value={health.breakdown.schedule} />
            </div>
            {health.daysToLaunch !== null && (
              <p className="t-meta mt-3 text-[var(--color-t3)]">
                {health.daysToLaunch < 0
                  ? `${Math.abs(health.daysToLaunch)} days past launch target`
                  : `${health.daysToLaunch} days to launch target`}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── ATTENTION ────────────────────────────────────────────────────────────────────── */}
      {attention.length > 0 && (
        <section className="mb-11">
          <SectionLabel tier="decision" aside={`${attention.length} ranked`}>Needs attention</SectionLabel>
          {attention.map((item) => (
            <AttentionItem
              key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
              rank={item.rank}
              explanation={item.explanation.replace(/^because:\s*/i, "")}
              actions={
                graphHref ? (
                  <Link href={graphHref} className="contents">
                    <Button variant="ghost">Focus in graph</Button>
                  </Link>
                ) : null
              }
            />
          ))}
        </section>
      )}

      {/* ── PHASES + OPEN WORK ───────────────────────────────────────────────────────────────
          What is complete recedes; what is open and current is what the eye lands on. */}
      <section className="mb-11">
        <SectionLabel
          tier="primary"
          aside={openTasks === 0 ? "nothing open" : `${openTasks} open of ${totalTasks}`}
        >
          Phases
        </SectionLabel>
        {production.phases.length === 0 ? (
          <QuietEmpty>This project has no phases defined.</QuietEmpty>
        ) : (
          production.phases.map((phase, i) => (
            <PhaseRow key={phase.key} phase={phase} isActive={i === activeIndex} />
          ))
        )}
      </section>

      {/* ── AUDITS ───────────────────────────────────────────────────────────────────────── */}
      <section className="mb-11">
        <SectionLabel tier="quiet" aside={audits.length > 0 ? `${audits.length} recorded` : undefined}>
          Site audits
        </SectionLabel>
        <RelationshipList
          hidden={Math.max(0, audits.length - 8)}
          items={audits.slice(0, 8).map<RelationItem>((a) => ({
            id: a.id,
            label: `Site audit · ${a.strategy}`,
            detail: a.runAt.slice(0, 10),
            status: a.performance === null ? "no score" : `perf ${a.performance}`,
            tone:
              a.performance === null ? "neutral" : a.performance >= 90 ? "good" : a.performance < 50 ? "risk" : "neutral",
            dotColor: NODE_VISUAL.audit.color,
            href: "/maintenance",
          }))}
          empty="No audits recorded for this site."
        />
      </section>

      {/* ── ACTIVITY ─────────────────────────────────────────────────────────────────────────
          Each event links to its own subject and to that subject in the graph — the return path
          that closes Action → Event → Entity → Graph. */}
      <section>
        <SectionLabel tier="quiet">Recent activity</SectionLabel>
        <ActivityList
          items={toActivityItems(activity)}
          empty="No recorded events for this project yet."
        />
      </section>
    </PageShell>
  );
}

/** One component of the Health Engine's score, rendered exactly as the engine reported it. */
function Breakdown({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-4">
      <span className="t-label w-[76px] shrink-0 text-[var(--color-t3)]">{label}</span>
      <div className="min-w-0 flex-1">
        {/* No tone for an unknown subscore — a risk/good color would be a verdict on absent evidence. */}
        <ProgressRail
          value={value}
          tone={value === null ? "neutral" : value < 40 ? "risk" : value >= 75 ? "good" : "accent"}
          label={label}
        />
      </div>
    </div>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `ProjectPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function ProjectPage(...props: Parameters<typeof ProjectPageContent>) {
  return renderOrDenied("Client projects", () => ProjectPageContent(...props));
}
