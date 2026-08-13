import Link from "next/link";
import { detectFirings } from "@/lib/automations";
import { KpiCard } from "@/components/KpiCard";
import { PendingFiringCard } from "@/components/PendingFiringCard";

export const dynamic = "force-dynamic";

const TRIGGER_LABEL: Record<string, string> = {
  "invoice.paid": "invoice paid",
  "production.phase_completed": "phase completed",
  "production.launch_buffer_in": "launch buffer",
  "prospect.status_is": "prospect status",
};

export default async function AutomationsPage() {
  const { pending, fired, rules } = await detectFirings();

  const weekAgo = Date.now() - 7 * 86400_000;
  const firedThisWeek = fired.filter((f) => new Date(f.fired_at).getTime() >= weekAgo).length;

  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const recentFires = [...fired]
    .sort((a, b) => b.fired_at.localeCompare(a.fired_at))
    .slice(0, 10);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 10</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Automations</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          Rules live in <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5 font-mono text-[10px]">03 - SOP Library/automations/*.md</code>
        </p>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Rules loaded" value={String(rules.length)} sub={`${Object.keys(TRIGGER_LABEL).length} trigger types`} />
        <KpiCard label="Pending firings" value={String(pending.length)} sub="waiting on you" accent={pending.length > 0} />
        <KpiCard label="Fired · 7d" value={String(firedThisWeek)} sub={`${fired.length} all-time`} />
        <KpiCard label="Mode" value="DRY-RUN" sub="actions require approval" />
      </section>

      {/* Pending firings */}
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          pending firings ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
            <p className="font-semibold text-[var(--color-fg)]">No pending firings.</p>
            <p className="mt-2">
              Either no rule conditions match current state, or everything matching has been marked done.
              Add more rules to <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">03 - SOP Library/automations/</code>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((f) => (
              <PendingFiringCard
                key={f.firing_id}
                firing_id={f.firing_id}
                rule_id={f.rule.id}
                rule_name={f.rule.name}
                trigger_type={f.rule.trigger.type}
                clipboard_label={f.rule.clipboard_label}
                target_summary={f.targetSummary}
                payload={f.payload}
                context={f.context}
              />
            ))}
          </div>
        )}
      </section>

      {/* Rules browse */}
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          rules ({rules.length})
        </h2>
        {rules.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
            No rules yet. Add markdown files to <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">03 - SOP Library/automations/</code> with YAML frontmatter — see <code className="font-mono text-xs">_template.md</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rules.map((r) => {
              const fireCount = fired.filter((f) => f.rule_id === r.id).length;
              const lastFired = fired
                .filter((f) => f.rule_id === r.id)
                .sort((a, b) => b.fired_at.localeCompare(a.fired_at))[0];
              return (
                <article key={r.id} className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4">
                  <header className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                        {TRIGGER_LABEL[r.trigger.type] ?? r.trigger.type}
                      </p>
                      <h3 className="text-sm font-semibold text-[var(--color-fg)]">{r.name}</h3>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-fg-dim)]">
                      fired {fireCount}×
                    </span>
                  </header>
                  {r.description && (
                    <p className="mb-2 text-xs text-[var(--color-fg-mute)]">{r.description}</p>
                  )}
                  <p className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                    id: {r.id}
                    {lastFired && <> · last: {new Date(lastFired.fired_at).toLocaleString()}</>}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent fires */}
      {recentFires.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            recent fires ({recentFires.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-surface-hi)] text-left font-mono uppercase tracking-widest text-[10px] text-[var(--color-fg-dim)]">
                <tr>
                  <th className="px-3 py-2">when</th>
                  <th className="px-3 py-2">rule</th>
                  <th className="px-3 py-2">target</th>
                </tr>
              </thead>
              <tbody>
                {recentFires.map((f) => {
                  const rule = ruleById.get(f.rule_id);
                  const targetLabel =
                    (f.context.client_name as string | undefined) ??
                    (f.context.prospect_name as string | undefined) ??
                    f.firing_id.split("::")[1] ??
                    "—";
                  return (
                    <tr key={f.firing_id} className="border-t border-[var(--color-border-hi)]">
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
                        {new Date(f.fired_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-fg)]">{rule?.name ?? f.rule_id}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-fg-mute)]">{targetLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
