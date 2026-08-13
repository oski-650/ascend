import Link from "next/link";
import { listClients } from "@/lib/vault";
import { vaultPath } from "@/lib/paths";
import { ClientCard } from "@/components/ClientCard";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  let clients: { slug: string; name: string }[] = [];
  let error: string | null = null;
  let resolvedPath = "";

  try {
    resolvedPath = vaultPath();
    clients = await listClients();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 02</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">CRM · Ascend Brain</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          {clients.length} client{clients.length === 1 ? "" : "s"}
          {resolvedPath && <span className="block opacity-60">vault: {resolvedPath}</span>}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-danger)]">
          <p className="font-semibold">Vault unreachable</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      )}

      {!error && clients.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
          <p className="font-semibold text-[var(--color-fg)]">No clients yet.</p>
          <p className="mt-2">
            Run <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">npm run scaffold:vault</code> to
            seed the vault, then add client folders under{" "}
            <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">01 - CRM &amp; Clients/</code>.
          </p>
          <p className="mt-2">
            Each client folder needs four files: <span className="mono">business_context.md</span>,{" "}
            <span className="mono">brand_identity.md</span>, <span className="mono">project_scope.md</span>,{" "}
            <span className="mono">structural_meta.json</span>.
          </p>
        </div>
      )}

      {clients.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <ClientCard key={c.slug} slug={c.slug} name={c.name} />
          ))}
        </div>
      )}

      <div className="mt-10 flex items-center gap-3 text-xs text-[var(--color-fg-dim)]">
        <Link href="/crm" className="hover:text-[var(--color-fg-mute)]">↻ refresh</Link>
      </div>
    </div>
  );
}
