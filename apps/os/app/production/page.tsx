import Link from "next/link";
import { listProductionStates } from "@/lib/production";
import { vaultPath } from "@/lib/paths";
import { PhaseLadder, OverallProgressBar } from "@/components/PhaseLadder";

export const dynamic = "force-dynamic";

export default async function ProductionPage() {
  let states: Awaited<ReturnType<typeof listProductionStates>> = [];
  let error: string | null = null;
  let resolvedPath = "";

  try {
    resolvedPath = vaultPath();
    states = await listProductionStates();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const active = states.filter((s) => s.activePhaseIndex !== null);
  const launched = states.filter((s) => s.activePhaseIndex === null);
  const avgProgress =
    active.length > 0
      ? Math.round(active.reduce((sum, s) => sum + s.overallProgress, 0) / active.length)
      : 0;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 04</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Website Production</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          {active.length} active · {launched.length} launched · avg {avgProgress}%
          {resolvedPath && <span className="block opacity-60">vault: {resolvedPath}</span>}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)]">
          <p className="font-semibold">Vault unreachable</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      )}

      {!error && states.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
          <p className="font-semibold text-[var(--color-fg)]">No production tracking yet.</p>
          <p className="mt-2">
            Drop a <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">production_state.md</code> into any client folder under{" "}
            <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">01 - CRM &amp; Clients/</code>.
          </p>
          <p className="mt-2">
            Industry-specific templates live in{" "}
            <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">03 - SOP Library/production-templates/</code> — copy one in and edit. Run{" "}
            <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">npm run scaffold:vault</code> to seed them.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">in flight</h2>
          <div className="flex flex-col gap-3">
            {active.map((s) => (
              <ProductionRow key={s.clientSlug} state={s} />
            ))}
          </div>
        </section>
      )}

      {launched.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">launched · maintenance</h2>
          <div className="flex flex-col gap-3 opacity-90">
            {launched.map((s) => (
              <ProductionRow key={s.clientSlug} state={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ProductionRow({ state }: { state: Awaited<ReturnType<typeof listProductionStates>>[number] }) {
  return (
    <Link
      href={`/production/${state.clientSlug}`}
      className="group flex flex-col gap-3 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hi)]"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-fg)] sm:text-lg">{state.clientName}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">
            {state.industryTemplate ? `${state.industryTemplate} · ` : ""}
            {state.launchTarget ? `target ${state.launchTarget}` : "no target"}
          </p>
        </div>
        <OverallProgressBar progress={state.overallProgress} />
      </div>
      <PhaseLadder phases={state.phases} size="sm" />
    </Link>
  );
}
