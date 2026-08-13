import Link from "next/link";
import { listProductionStates, type ProductionState, type Phase } from "@/lib/production";
import { summarizeByClient, formatDuration } from "@/lib/timeLog";
import { getClientRevenue, computeEhr, formatUsd, formatHours } from "@/lib/ehr";
import { TaskStartButton } from "@/components/TaskStartButton";
import { LogTimeForm, type LogClientOption } from "@/components/LogTimeForm";

export const dynamic = "force-dynamic";

type OpenTask = { phase: Phase; text: string };

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

export default async function TasksPage() {
  const [states, summaries] = await Promise.all([
    listProductionStates(),
    summarizeByClient(),
  ]);

  // Per-client revenue + EHR
  const enriched = await Promise.all(
    states.map(async (s) => {
      const summary = summaries[s.clientSlug];
      const revenue = await getClientRevenue(s.clientSlug);
      const totalSeconds = summary?.total_seconds ?? 0;
      const ehr = computeEhr(revenue, totalSeconds);
      return { state: s, totalSeconds, revenue, ehr, tasks: openTasks(s) };
    })
  );

  // Sort: in-flight clients first (have open tasks), then by name
  enriched.sort((a, b) => {
    const aOpen = a.tasks.length > 0 ? 0 : 1;
    const bOpen = b.tasks.length > 0 ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return a.state.clientName.localeCompare(b.state.clientName);
  });

  const totalTrackedSeconds = enriched.reduce((sum, e) => sum + e.totalSeconds, 0);
  const totalRevenue = enriched.reduce((sum, e) => sum + (e.revenue ?? 0), 0);

  // Shape data for the manual log form (all tasks, done or not).
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
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 05</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Tasks · Execution Layer</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          {formatHours(totalTrackedSeconds)} tracked across {enriched.length} client{enriched.length === 1 ? "" : "s"}
          {totalRevenue > 0 && (
            <span className="block opacity-80">
              {formatUsd(totalRevenue)} project revenue · portfolio EHR{" "}
              {totalTrackedSeconds > 0
                ? formatUsd(totalRevenue / (totalTrackedSeconds / 3600)) + "/hr"
                : "—"}
            </span>
          )}
        </p>
      </div>

      {logClients.length > 0 && <LogTimeForm clients={logClients} />}

      {enriched.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
          <p className="font-semibold text-[var(--color-fg)]">No clients with production tracking yet.</p>
          <p className="mt-2">
            Add a <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">production_state.md</code> to a client folder, then come back.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {enriched.map(({ state, totalSeconds, revenue, ehr, tasks }) => (
          <article
            key={state.clientSlug}
            className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5"
          >
            <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/production/${state.clientSlug}`}
                    className="text-base font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] sm:text-lg"
                  >
                    {state.clientName}
                  </Link>
                  <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">{state.clientSlug}</span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">
                  {tasks.length === 0
                    ? "no open tasks — all phases resolved or empty"
                    : `${tasks.length} open task${tasks.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                <Stat label="Tracked" value={totalSeconds > 0 ? formatDuration(totalSeconds, "compact") : "—"} />
                <Stat label="Revenue" value={revenue !== null ? formatUsd(revenue) : "—"} />
                <Stat
                  label="EHR"
                  value={ehr !== null ? `${formatUsd(ehr)}/hr` : "—"}
                  accent={ehr !== null}
                />
              </div>
            </header>

            {tasks.length > 0 && (
              <ul className="flex flex-col divide-y divide-[var(--color-border-hi)]">
                {tasks.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)] w-20 shrink-0">
                      {t.phase.label}
                    </span>
                    <span className="flex-1 truncate text-sm text-[var(--color-fg)]">{t.text}</span>
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
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
          accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
