import Link from "next/link";
import {
  listDocuments,
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  TYPE_LABEL,
  STATUS_LABEL,
  type DocumentType,
  type DocumentStatus,
} from "@/lib/documents";
import { listClients } from "@/lib/vault";
import { DocumentRow } from "@/components/DocumentRow";
import { NewDocumentForm } from "@/components/NewDocumentForm";
import { KpiCard } from "@/components/KpiCard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  client?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  search?: string;
  include_superseded?: string;
}>;

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const includeSuperseded = params.include_superseded === "1";

  const [clients, docs] = await Promise.all([
    listClients(),
    listDocuments({
      client: params.client,
      type: params.type,
      status: params.status,
      search: params.search,
      includeSuperseded,
    }),
  ]);

  const clientNameBySlug = new Map(clients.map((c) => [c.slug, c.name]));

  // KPI counts across ALL docs (independent of filters), excluding superseded
  const allDocs = await listDocuments({ includeSuperseded: false });
  const counts = {
    total: allDocs.length,
    drafts: allDocs.filter((d) => d.meta.status === "draft").length,
    sent: allDocs.filter((d) => d.meta.status === "sent").length,
    accepted: allDocs.filter((d) => d.meta.status === "accepted").length,
    acceptedValue: allDocs
      .filter((d) => d.meta.status === "accepted")
      .reduce((s, d) => s + (d.meta.amount_usd ?? 0), 0),
  };

  const acceptedUsd = counts.acceptedValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  const linkBase = "/documents";
  const buildHref = (overrides: Partial<typeof params>) => {
    const merged: Record<string, string | undefined> = { ...params, ...overrides };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v.length > 0) usp.set(k, String(v));
    }
    const qs = usp.toString();
    return qs ? `${linkBase}?${qs}` : linkBase;
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 border-b border-[var(--color-border-hi)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 08</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Document Vault</h1>
        </div>
        <p className="font-mono text-xs text-[var(--color-fg-dim)] sm:text-right">
          Files live in <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5 font-mono text-[10px]">04 - Documents/</code> — editable in Obsidian
        </p>
      </div>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total · current" value={String(counts.total)} sub="non-superseded" />
        <KpiCard label="Drafts" value={String(counts.drafts)} sub="not yet sent" />
        <KpiCard label="Sent · awaiting" value={String(counts.sent)} sub="pending client" />
        <KpiCard label="Accepted value" value={acceptedUsd} sub={`${counts.accepted} doc${counts.accepted === 1 ? "" : "s"}`} accent={counts.accepted > 0} />
      </section>

      <NewDocumentForm clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />

      {/* Filters */}
      <section className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3 sm:p-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <Filter label="search">
            <input
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="title, summary, body…"
              className={inputClass}
            />
          </Filter>
          <Filter label="client">
            <select name="client" defaultValue={params.client ?? ""} className={selectClass}>
              <option value="">— any —</option>
              {clients.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="type">
            <select name="type" defaultValue={params.type ?? ""} className={selectClass}>
              <option value="">— any —</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="status">
            <select name="status" defaultValue={params.status ?? ""} className={selectClass}>
              <option value="">— any —</option>
              {DOCUMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Filter>
          <label className="flex items-center gap-1.5 self-center font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            <input
              type="checkbox"
              name="include_superseded"
              value="1"
              defaultChecked={includeSuperseded}
              className="size-3"
            />
            include superseded
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
            >
              Apply
            </button>
            <Link
              href="/documents"
              className="rounded-md border border-[var(--color-border-hi)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--color-fg-mute)] hover:border-[var(--color-fg-mute)] hover:text-[var(--color-fg)]"
            >
              Reset
            </Link>
          </div>
        </form>
      </section>

      {/* Doc list */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          documents ({docs.length})
        </h2>
        {docs.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-fg-mute)]">
            <p className="font-semibold text-[var(--color-fg)]">No documents match.</p>
            <p className="mt-2">
              Click <code className="rounded bg-[var(--color-surface-hi)] px-1.5 py-0.5 font-mono text-xs">+ New document</code> above, or{" "}
              <Link href={buildHref({ search: "", client: "", type: undefined as never, status: undefined as never, include_superseded: "1" })} className="text-[var(--color-accent)] hover:underline">
                include superseded
              </Link>{" "}
              to widen the view.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {docs.map((d) => (
              <DocumentRow key={d.meta.doc_id} document={d} clientName={clientNameBySlug.get(d.meta.client)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)]";
const selectClass = inputClass + " appearance-none pr-6";
