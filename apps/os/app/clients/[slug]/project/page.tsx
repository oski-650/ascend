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
import { Badge, Button } from "@/components/primitives";
import {
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
import { eventLabel, eventQualifier, getClientDossier, relativeTime } from "../dossier";

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

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
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

  const graphHref = `/?focus=${encodeURIComponent(`project:${slug}`)}`;

  return (
    <PageShell>
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
            <Link href={graphHref} className="contents">
              <Button variant="ghost">Focus in Neural Core</Button>
            </Link>
            <Link href={`/production/${slug}`} className="contents">
              <Button variant="ghost">Edit checklist</Button>
            </Link>
          </>
        }
      />

      {/* ── WHERE IS IT ──────────────────────────────────────────────────────────────────────
          The rail answers the positional question before any number is read. */}
      <section className="mb-12">
        <PhaseRail phases={production.phases} activeIndex={activeIndex} />
      </section>

      {/* ── STATE ────────────────────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <FactGrid>
          <FactRow
            value={`${production.overallProgress}%`}
            label="Overall progress"
            detail={`${completePhases} of ${production.phases.length} phases complete`}
          />
          {health ? (
            <FactRow
              value={String(health.score)}
              label="Health"
              detail={health.tier.replace("_", " ")}
              attribution="Health Engine"
              tone={health.tier === "at_risk" ? "risk" : health.tier === "healthy" ? "good" : undefined}
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
            detail={activePhase ? `${activePhase.progress}% through` : "all phases resolved"}
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
        <section className="mb-12">
          <SectionLabel aside={`${attention.length} ranked`}>Needs attention</SectionLabel>
          {attention.map((item) => (
            <AttentionItem
              key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
              rank={item.rank}
              explanation={item.explanation.replace(/^because:\s*/i, "")}
              actions={
                <Link href={graphHref} className="contents">
                  <Button variant="ghost">Focus in graph</Button>
                </Link>
              }
            />
          ))}
        </section>
      )}

      {/* ── PHASES + OPEN WORK ───────────────────────────────────────────────────────────────
          What is complete recedes; what is open and current is what the eye lands on. */}
      <section className="mb-12">
        <SectionLabel
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
      <section className="mb-12">
        <SectionLabel aside={audits.length > 0 ? `${audits.length} recorded` : undefined}>
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

      {/* ── ACTIVITY ─────────────────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Recent activity</SectionLabel>
        {activity.length === 0 ? (
          <QuietEmpty>No recorded events for this project yet.</QuietEmpty>
        ) : (
          <ul className="flex flex-col">
            {activity.map((event) => (
              <li
                key={event.event_id}
                className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
              >
                <span className="t-body min-w-0 text-[var(--color-t2)]">
                  {eventLabel(event.type)}
                  {eventQualifier(event) && (
                    <span className="text-[var(--color-t3)]"> · {eventQualifier(event)}</span>
                  )}
                </span>
                <span className="t-mono shrink-0 text-[var(--color-t3)]">
                  {relativeTime(event.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

/** One component of the Health Engine's score, rendered exactly as the engine reported it. */
function Breakdown({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-4">
      <span className="t-label w-[76px] shrink-0 text-[var(--color-t3)]">{label}</span>
      <div className="min-w-0 flex-1">
        <ProgressRail value={value} tone={value < 40 ? "risk" : value >= 75 ? "good" : "accent"} label={label} />
      </div>
    </div>
  );
}