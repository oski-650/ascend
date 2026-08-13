import { detectOpportunities, severityLabel, type Severity } from "@/lib/opportunities";
import { compileOpportunityBrief } from "@/lib/compileOpportunityBrief";
import { compileOperatorBrief } from "@/lib/compileOperatorBrief";
import { OpportunityCard } from "@/components/OpportunityCard";
import { CopyTextButton } from "@/components/CopyTextButton";

export const dynamic = "force-dynamic";

const SECTION_ORDER: Severity[] = ["urgent", "suggest", "info"];

export default async function SignalsPage() {
  const [opportunities, operatorPayload] = await Promise.all([
    detectOpportunities(),
    compileOperatorBrief(),
  ]);

  // Compile per-opp payloads server-side so we can pass strings to client buttons.
  const opportunitiesWithPayload = await Promise.all(
    opportunities.map(async (o) => ({ opp: o, payload: await compileOpportunityBrief(o) }))
  );

  const grouped: Record<Severity, typeof opportunitiesWithPayload> = {
    urgent: [],
    suggest: [],
    info: [],
  };
  for (const x of opportunitiesWithPayload) grouped[x.opp.severity].push(x);

  const counts = {
    urgent: grouped.urgent.length,
    suggest: grouped.suggest.length,
    info: grouped.info.length,
    total: opportunitiesWithPayload.length,
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 11 · AI layer</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Signals</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          {counts.total} signal{counts.total === 1 ? "" : "s"} firing
          {counts.urgent > 0 && <span className="ml-2 text-[var(--color-danger)]">· {counts.urgent} urgent</span>}
        </p>
      </div>

      {/* Operator Brief (Ascend Copilot) */}
      <section className="mb-8 rounded-lg border border-[var(--color-accent)]/30 bg-gradient-to-br from-[var(--color-accent)]/5 to-transparent p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">ascend copilot</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--color-fg)] sm:text-xl">
              What should I work on today?
            </h2>
            <p className="mt-2 text-sm text-[var(--color-fg-mute)]">
              One-shot context payload: active projects, top prospects, every open signal — plus a directive asking Claude to recommend the 3–5 highest-leverage actions for today, in order.
            </p>
          </div>
          <CopyTextButton
            payload={operatorPayload}
            label="Copy Operator Brief"
            variant="primary"
            icon="🧭"
          />
        </div>
      </section>

      {counts.total === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
          <p className="font-semibold text-[var(--color-fg)]">System is quiet — no signals firing.</p>
          <p className="mt-2">
            No urgent projects, no cold proposals, no untouched hot leads. Either you&apos;re caught up, or you need more clients in the system.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {SECTION_ORDER.map((sev) => {
          const items = grouped[sev];
          if (items.length === 0) return null;
          return (
            <section key={sev}>
              <h2 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                <span
                  className={`size-1.5 rounded-full ${
                    sev === "urgent"
                      ? "bg-[var(--color-danger)]"
                      : sev === "suggest"
                        ? "bg-amber-400"
                        : "bg-sky-400"
                  }`}
                />
                {severityLabel(sev)} ({items.length})
              </h2>
              <div className="flex flex-col gap-3">
                {items.map(({ opp, payload }) => (
                  <OpportunityCard key={opp.id} opportunity={opp} payload={payload} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
