// app/tasks — THE EXECUTION SURFACE.
//
// A DELIBERATELY MINIMAL redesign, because of what the audit found:
//
//   THERE IS NO OPERATOR-LEVEL TASK DOMAIN. `ChecklistItem` lives in @/domain and is owned by
//   core/production; every task in Ascend belongs to a project phase. This page is a PROJECTION of
//   production checklists, not a second task model, and it must not become one — inventing a
//   standalone task entity here would create exactly the duplicate source of truth the architecture
//   forbids. The page says so on itself rather than pretending otherwise.
//
// What this surface DOES uniquely own is TIME: starting a timer against a checklist item and
// logging time manually. That is the reason it exists as a route at all, and it is what the
// hierarchy now leads with.
//
// EHR is profitability INTERPRETATION and belongs to `computeEhr` (lib/ehr). The previous page
// called it per client but then recomputed the PORTFOLIO figure inline as
// `totalRevenue / (totalTrackedSeconds / 3600)` — the same formula, written twice, one of them on
// the surface. That second copy is gone: the portfolio figure now calls the same owner.

import Link from "next/link";
import type { Metadata } from "next";
import { listProductionStates, type Phase, type ProductionState } from "@/core/production";
import { summarizeByClient, formatDuration } from "@/lib/timeLog";
import { getClientRevenue, computeEhr, formatUsd, formatHours } from "@/lib/ehr";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { TaskStartButton } from "@/components/TaskStartButton";
import { LogTimeForm, type LogClientOption } from "@/components/LogTimeForm";
import {
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

export const metadata: Metadata = { title: "Tasks · Ascend OS" };

type OpenTask = { phase: Phase; text: string };

/** Selection: the not-done items of phases that are still live. Derives nothing. */
function openTasks(state: ProductionState): OpenTask[] {
  const out: OpenTask[] = [];
  for (const phase of state.phases) {
    if (phase.status === "complete" || phase.status === "skipped") continue;
    for (const item of phase.checklist) {
      if (!item.done) out.push({ phase, text: item.text });
    }
  }
  return out;
}

async function TasksPageContent() {
  const [states, summaries] = await Promise.all([listProductionStates(), summarizeByClient()]);

  const enriched = await Promise.all(
    states.map(async (state) => {
      const totalSeconds = summaries[state.clientSlug]?.total_seconds ?? 0;
      const revenue = await getClientRevenue(state.clientSlug); // contracted-revenue FACT (core/finance)
      return {
        state,
        totalSeconds,
        revenue,
        ehr: computeEhr(revenue, totalSeconds), // the owner computes it; this page never does
        tasks: openTasks(state),
      };
    })
  );

  // Presentation order: work that is open comes before work that is not, then alphabetical. This
  // orders one read-model family by its own field (open-task count) — it ranks nothing across
  // families, which remains Decision's exclusive job.
  enriched.sort((a, b) => {
    const aOpen = a.tasks.length > 0 ? 0 : 1;
    const bOpen = b.tasks.length > 0 ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return a.state.clientName.localeCompare(b.state.clientName);
  });

  const totalTrackedSeconds = enriched.reduce((sum, e) => sum + e.totalSeconds, 0);
  const totalRevenue = enriched.reduce((sum, e) => sum + (e.revenue ?? 0), 0);
  const portfolioEhr = computeEhr(totalRevenue, totalTrackedSeconds);
  const totalOpen = enriched.reduce((sum, e) => sum + e.tasks.length, 0);

  const logClients: LogClientOption[] = states.map((s) => ({
    slug: s.clientSlug,
    name: s.clientName,
    phases: s.phases.map((p) => ({
      key: p.key,
      label: p.label,
      tasks: p.checklist.map((c) => c.text),
    })),
  }));

  return (
    <PageShell hue={NODE_VISUAL.task.color}>
      <SurfaceHeader
        eyebrow="Work"
        title="Tasks"
        lede="Open work across every build, and the time logged against it. Tasks belong to project phases — Ascend has no standalone task list."
      />

      {enriched.length === 0 ? (
        <QuietEmpty>
          No builds are tracked yet, so there is no open work. Add a{" "}
          <span className="t-mono">production_state.md</span> to a client folder and its checklist
          appears here.
        </QuietEmpty>
      ) : (
        <>
          {/* ── EFFORT ───────────────────────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <FactGrid
              lead={
                <FactRow
                  lead
                  value={String(totalOpen)}
                  label={totalOpen === 1 ? "Open task" : "Open tasks"}
                  detail={`across ${enriched.filter((e) => e.tasks.length > 0).length} of ${
                    enriched.length
                  } builds`}
                />
              }
            >
              <FactRow
                value={formatHours(totalTrackedSeconds)}
                label="Tracked"
                detail="all time"
              />
              <FactRow
                value={totalRevenue > 0 ? formatUsd(totalRevenue) : "—"}
                label="Project revenue"
                detail="contracted"
              />
              <FactRow
                value={portfolioEhr !== null ? `${formatUsd(portfolioEhr)}/hr` : "—"}
                label="Portfolio EHR"
                detail={
                  portfolioEhr === null ? "needs revenue and tracked time" : "revenue ÷ tracked hours"
                }
                attribution="computeEhr"
              />
            </FactGrid>
          </section>

          {/* ── ACTION — the manual log. The only write on this surface. ───────────────────── */}
          {logClients.length > 0 && (
            <section className="mb-14">
              <SectionLabel tier="primary">Log time</SectionLabel>
              <LogTimeForm clients={logClients} />
            </section>
          )}

          {/* ── OPEN WORK ─────────────────────────────────────────────────────────────────────
              Grouped by the build that owns it, because ownership is the point: there is no such
              thing here as a task without a project. */}
          <section>
            <SectionLabel tier="primary" aside={`${totalOpen} open · ${enriched.length} builds`}>
              Open work
            </SectionLabel>
            <ul className="flex flex-col">
              {enriched.map(({ state, totalSeconds, ehr, tasks }) => (
                <IndexRow
                  key={state.clientSlug}
                  // The row carries its own buttons, so it is NOT a stretched link — the name
                  // stays the only navigation and the timers stay independently clickable.
                  stretch={false}
                  href={`/clients/${state.clientSlug}/project`}
                  name={state.clientName}
                  markerColor={NODE_VISUAL.project.color}
                  meta={[
                    tasks.length === 0
                      ? "nothing open"
                      : `${tasks.length} open task${tasks.length === 1 ? "" : "s"}`,
                    totalSeconds > 0 ? `${formatDuration(totalSeconds, "compact")} logged` : "no time logged",
                    ehr !== null ? `${formatUsd(ehr)}/hr` : "EHR unavailable",
                  ].join(" · ")}
                >
                  {tasks.length > 0 && (
                    <ul className="mt-3.5 flex flex-col border-t border-[var(--color-line)]">
                      {tasks.map((t, i) => (
                        <li
                          key={`${t.phase.key}-${i}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
                        >
                          <span className="t-label w-[86px] shrink-0 text-[var(--color-t3)]">
                            {t.phase.label}
                          </span>
                          {/* Task text wraps rather than truncating — a truncated task is not a
                              task you can act on. */}
                          <span className="t-body min-w-0 flex-1 text-[var(--color-t1)]">
                            {t.text}
                          </span>
                          <TaskStartButton
                            client={state.clientSlug}
                            phase={t.phase.key}
                            task={t.text}
                            size="sm"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </IndexRow>
              ))}
            </ul>
          </section>

          <p className="t-mono mt-10 text-[var(--color-t3)]">
            Tasks are checklist items inside each build&rsquo;s{" "}
            <span className="text-[var(--color-t2)]">production_state.md</span>. Edit them on the{" "}
            <Link href="/production" className="hover:text-[var(--color-accent)]">
              build
            </Link>{" "}
            they belong to.
          </p>
        </>
      )}
    </PageShell>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `TasksPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function TasksPage(...props: Parameters<typeof TasksPageContent>) {
  return renderOrDenied("Tasks", () => TasksPageContent(...props));
}
