import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductionState } from "@/lib/production";
import { compileProductionSnapshot } from "@/lib/compileProductionSnapshot";
import { PhaseLadder, OverallProgressBar } from "@/components/PhaseLadder";
import { PhaseChecklist } from "@/components/PhaseChecklist";
import { CopySnapshotButton } from "./CopySnapshotButton";

export const dynamic = "force-dynamic";

export default async function ProductionDetailPage({
  params,
}: {
  params: Promise<{ client: string }>;
}) {
  const { client: slug } = await params;
  const state = await getProductionState(slug);
  if (!state) notFound();

  const payload = compileProductionSnapshot(state);
  const active = state.activePhaseIndex !== null ? state.phases[state.activePhaseIndex] : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Link href="/production" className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          ← production
        </Link>
        <Link href={`/crm/${state.clientSlug}`} className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          · crm profile
        </Link>
      </div>

      <div className="sticky top-[57px] z-40 -mx-4 mb-6 border-b border-[var(--color-border-hi)] bg-[var(--color-bg)]/85 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">production · {state.clientSlug}</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{state.clientName}</h1>
            <p className="mt-1 font-mono text-xs text-[var(--color-fg-dim)]">
              {state.industryTemplate ? `${state.industryTemplate} template · ` : ""}
              {state.launchTarget ? `launch target ${state.launchTarget}` : "no launch target"}
              {active ? ` · active: ${active.label}` : " · all phases resolved"}
            </p>
          </div>
          <CopySnapshotButton payload={payload} />
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[var(--color-fg-mute)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Phase Ladder
          </h2>
          <OverallProgressBar progress={state.overallProgress} />
        </div>
        <PhaseLadder phases={state.phases} size="md" />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {state.phases.map((p) => (
          <PhaseChecklist key={p.key} phase={p} clientSlug={state.clientSlug} />
        ))}
      </div>
    </div>
  );
}
