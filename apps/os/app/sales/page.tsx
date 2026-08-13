import { Target } from "lucide-react";
import { listProspects } from "@/lib/sales";
import { vaultPath } from "@/lib/paths";
import { ProspectRow } from "@/components/ProspectRow";
import { AddTargetForm } from "@/components/AddTargetForm";
import { PageEntry } from "@/components/PageEntry";
import { ScrambleTitle } from "@/components/ScrambleTitle";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  let prospects: Awaited<ReturnType<typeof listProspects>> = [];
  let error: string | null = null;
  let resolvedPath = "";

  try {
    resolvedPath = vaultPath();
    prospects = await listProspects();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const active = prospects.filter((p) => p.frontmatter.status !== "closed-lost");
  const dead = prospects.filter((p) => p.frontmatter.status === "closed-lost");
  const avgScore =
    active.length > 0
      ? Math.round(active.reduce((s, p) => s + p.score.score, 0) / active.length)
      : 0;
  const priorityCount = active.filter((p) => p.score.tier === "priority").length;
  const hotCount = active.filter((p) => p.score.tier === "hot").length;

  return (
    <PageEntry>
      <div className="mb-6 flex flex-col gap-1 border-b border-zinc-800/50 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <Target className="size-3 text-[var(--color-accent)]" strokeWidth={1.8} />
            hit list
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
            <ScrambleTitle text="Sales Pipeline" />
          </h1>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 sm:text-right">
          {active.length} active · avg score {avgScore}
          {resolvedPath && <span className="block opacity-60 normal-case">vault: {resolvedPath}</span>}
        </p>
      </div>

      {error && (
        <div className="glass rounded-lg p-4 text-sm text-[var(--color-danger)]">
          <p className="font-semibold">Vault unreachable</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      )}

      <AddTargetForm />

      {!error && prospects.length === 0 && (
        <div className="glass rounded-lg p-6 text-sm text-zinc-400">
          <p className="font-semibold text-zinc-100">No prospects yet.</p>
          <p className="mt-2">
            Add markdown files to <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 font-mono text-xs">02 - Sales &amp; Hit List/</code> — one file per target,
            named <code className="rounded bg-zinc-900/80 px-1.5 py-0.5 font-mono text-xs">prospect-slug.md</code>.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
            <Stat label="Priority (80+)" value={priorityCount} accent />
            <Stat label="Hot (55–79)" value={hotCount} />
            <Stat label="Avg score" value={avgScore} />
          </div>
          <div className="flex flex-col gap-2">
            {active.map((p, i) => (
              <ProspectRow key={p.slug} prospect={p} rank={i + 1} />
            ))}
          </div>
        </>
      )}

      {dead.length > 0 && (
        <details className="mt-8 group">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300">
            ▸ Closed · Lost ({dead.length})
          </summary>
          <div className="mt-3 flex flex-col gap-2 opacity-60">
            {dead.map((p, i) => (
              <ProspectRow key={p.slug} prospect={p} rank={active.length + i + 1} />
            ))}
          </div>
        </details>
      )}
    </PageEntry>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="glass rounded-lg p-3">
      <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p
        className={`mt-1 font-mono text-2xl font-bold ${
          accent ? "text-[var(--color-accent)]" : "text-zinc-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
