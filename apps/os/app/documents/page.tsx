// app/documents — THE EPISTEMIC SURFACE.
//
// A knowledge workspace, not a file browser. The organising idea is that a document is never
// standalone: it belongs to a client, it has a type, it has a STATE, and it usually sits inside a
// version LINEAGE. Grouping by client and rendering supersession chains inline is what makes those
// relationships legible without adding a second graph.
//
// OWNERSHIP: counts and lineages come from mission-control.assembleDocuments() → the frozen
// Document Engine. The previous version computed its own aggregates on the surface
// (`allDocs.filter(...).reduce(...)` for accepted value); that computation now lives with its
// owner. The surface selects and renders only.

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
import { listClients } from "@/core/crm";
import { assembleDocuments } from "@/mission-control/documents";
import { routeForEntity } from "@/navigation/routing";
import { NewDocumentForm } from "@/components/NewDocumentForm";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import {
  FactGrid,
  FactRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";
import { NODE_VISUAL } from "@/graph-view/taxonomy";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  client?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  search?: string;
  include_superseded?: string;
}>;

const STATUS_TONE: Record<string, Tone> = {
  accepted: "good",
  sent: "accent",
  draft: "neutral",
  superseded: "neutral",
};

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const includeSuperseded = params.include_superseded === "1";

  const [clients, docs, digest] = await Promise.all([
    listClients(),
    listDocuments({
      client: params.client,
      type: params.type,
      status: params.status,
      search: params.search,
      includeSuperseded,
    }),
    assembleDocuments(), // Mission Control → Document Engine: counts + ordered lineages
  ]);

  const clientNameBySlug = new Map(clients.map((c) => [c.slug, c.name]));

  // Selection only: reading a bucket the engine already produced.
  const bucket = (status: string) => digest.byStatus.find((b) => b.status === status)?.count ?? 0;
  const accepted = bucket("accepted");
  const drafts = bucket("draft");
  const sent = bucket("sent");

  // Lineage lookup so a chain can be rendered beside the document it belongs to.
  const lineageFor = new Map<string, (typeof digest.lineages)[number]>();
  for (const lineage of digest.lineages) {
    for (const step of lineage.chain) lineageFor.set(step.docId, lineage);
  }

  // Group the FILTERED documents by client — a document belongs to a business relationship.
  const byClient = new Map<string, typeof docs>();
  for (const doc of docs) {
    const list = byClient.get(doc.meta.client) ?? [];
    list.push(doc);
    byClient.set(doc.meta.client, list);
  }
  const clientGroups = [...byClient.entries()].sort((a, b) =>
    (clientNameBySlug.get(a[0]) ?? a[0]).localeCompare(clientNameBySlug.get(b[0]) ?? b[0])
  );

  const filtered =
    Boolean(params.search || params.client || params.type || params.status) || includeSuperseded;

  const buildHref = (overrides: Partial<Awaited<SearchParams>>) => {
    const merged: Record<string, string | undefined> = { ...params, ...overrides };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && v.length > 0) usp.set(k, String(v));
    const qs = usp.toString();
    return qs ? `/documents?${qs}` : "/documents";
  };

  return (
    <PageShell hue={NODE_VISUAL.document.color}>
      <SurfaceHeader
        eyebrow="Knowledge"
        title="Documents"
        lede="Proposals, contracts, and statements of work — grouped by the relationship they belong to, with their version lineage intact."
      />

      {/* ── STATE ────────────────────────────────────────────────────────────────────────────
          Paperwork value leads. Counts are the engine's own buckets, not surface arithmetic. */}
      <section className="mb-12">
        <FactGrid
          lead={
            <FactRow
              lead
              value={usd(digest.counts.paperworkInProgressUsd)}
              label="In progress"
              detail="draft + sent · document value, not revenue"
            />
          }
        >
          <FactRow value={String(digest.counts.total)} label="Documents" detail="all versions" />
          <FactRow value={String(drafts)} label="Drafts" detail="not yet sent" />
          <FactRow value={String(sent)} label="Awaiting client" detail="sent, unsigned" />
          <FactRow
            value={String(accepted)}
            label="Accepted"
            detail="signed off"
            tone={accepted > 0 ? "good" : undefined}
          />
        </FactGrid>
      </section>

      {/* ── ACTION ─────────────────────────────────────────────────────────────────────────── */}
      <section className="mb-12">
        <NewDocumentForm clients={clients.map((c) => ({ slug: c.slug, name: c.name }))} />
      </section>

      {/* ── FILTERS — a quiet control strip, not a panel ───────────────────────────────────── */}
      <section className="mb-12">
        <SectionLabel tier="quiet">Refine</SectionLabel>
        <form method="GET" className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <Field label="Search">
            <input
              name="search"
              defaultValue={params.search ?? ""}
              placeholder="title, summary, body…"
              className={FIELD}
            />
          </Field>
          <Field label="Client">
            <select name="client" defaultValue={params.client ?? ""} className={FIELD}>
              <option value="">any</option>
              {clients.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select name="type" defaultValue={params.type ?? ""} className={FIELD}>
              <option value="">any</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={params.status ?? ""} className={FIELD}>
              <option value="">any</option>
              {DOCUMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-1.5">
            <input
              type="checkbox"
              name="include_superseded"
              value="1"
              defaultChecked={includeSuperseded}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            <span className="t-label text-[var(--color-t3)]">Include superseded</span>
          </label>
          <div className="flex items-center gap-2 self-end">
            <Button type="submit" variant="ghost">
              Apply
            </Button>
            {filtered && (
              <Link
                href="/documents"
                className="t-label text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
              >
                Reset
              </Link>
            )}
          </div>
        </form>
      </section>

      {/* ── DOCUMENTS, BY RELATIONSHIP ──────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel
          tier="primary"
          aside={`${docs.length} shown${clientGroups.length > 0 ? ` · ${clientGroups.length} client${clientGroups.length === 1 ? "" : "s"}` : ""}`}
        >
          Documents
        </SectionLabel>

        {docs.length === 0 ? (
          <QuietEmpty>
            {filtered ? (
              <>
                No documents match this view.{" "}
                {!includeSuperseded && (
                  <Link
                    href={buildHref({ include_superseded: "1" })}
                    className="text-[var(--color-accent)] underline-offset-4 hover:underline"
                  >
                    Include superseded versions
                  </Link>
                )}
              </>
            ) : (
              "No documents yet. Create one above, or add markdown files under 04 - Documents/ in the vault."
            )}
          </QuietEmpty>
        ) : (
          <div className="flex flex-col gap-11">
            {clientGroups.map(([slug, group]) => {
              const clientHref = routeForEntity("client", slug);
              return (
                <div key={slug}>
                  {/* The relationship this paperwork belongs to — a real link, not a header string. */}
                  <div className="mb-3 flex items-baseline gap-2.5 border-b border-[var(--color-line)] pb-2">
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: NODE_VISUAL.client.color }}
                    />
                    {clientHref ? (
                      <Link
                        href={clientHref}
                        className="t-h2 text-[var(--color-t1)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                      >
                        {clientNameBySlug.get(slug) ?? slug}
                      </Link>
                    ) : (
                      <span className="t-h2 text-[var(--color-t1)]">
                        {clientNameBySlug.get(slug) ?? slug}
                      </span>
                    )}
                    <span className="t-mono ml-auto text-[var(--color-t3)]">{group.length}</span>
                  </div>

                  <ul className="flex flex-col">
                    {group.map((d) => {
                      const meta = d.meta;
                      const lineage = lineageFor.get(meta.doc_id);
                      // Only show the chain on the newest member, so it renders once per lineage.
                      const isChainHead =
                        lineage && lineage.chain[lineage.chain.length - 1]?.docId === meta.doc_id;
                      return (
                        <li
                          key={meta.doc_id}
                          className="border-b border-[var(--color-line)] py-3 last:border-b-0"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                            <Link
                              href={`/documents/${meta.doc_id}`}
                              className="t-body min-w-0 max-w-[52ch] text-[var(--color-t1)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                            >
                              {meta.title}{" "}
                              <span className="t-mono text-[var(--color-t3)]">v{meta.version}</span>
                            </Link>
                            <div className="flex shrink-0 items-center gap-3">
                              {meta.amount_usd !== undefined && (
                                <span className="t-mono text-[var(--color-t2)]">
                                  {usd(meta.amount_usd)}
                                </span>
                              )}
                              <Badge>{TYPE_LABEL[meta.type]}</Badge>
                              <span className="w-[92px] text-right">
                                <Status tone={STATUS_TONE[meta.status] ?? "neutral"}>
                                  {STATUS_LABEL[meta.status]}
                                </Status>
                              </span>
                            </div>
                          </div>

                          {/* LINEAGE — the supersession chain, oldest → newest, from the engine. */}
                          {isChainHead && lineage.chain.length > 1 && (
                            <p className="t-mono mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--color-t3)]">
                              <span>lineage</span>
                              {lineage.chain.map((step, i) => (
                                <span key={step.docId} className="flex items-center gap-1.5">
                                  {i > 0 && <span aria-hidden>→</span>}
                                  <Link
                                    href={`/documents/${step.docId}`}
                                    className={
                                      i === lineage.chain.length - 1
                                        ? "text-[var(--color-t1)] hover:text-[var(--color-accent)]"
                                        : "line-through hover:text-[var(--color-accent)]"
                                    }
                                  >
                                    v{step.version}
                                  </Link>
                                </span>
                              ))}
                              <span className="text-[var(--color-t3)]">
                                · {lineage.chain.length} versions
                              </span>
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}

const FIELD =
  "rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[0.8rem] text-[var(--color-t1)] outline-none placeholder:text-[var(--color-t3)] focus:border-[var(--color-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="t-label text-[var(--color-t3)]">{label}</span>
      {children}
    </label>
  );
}