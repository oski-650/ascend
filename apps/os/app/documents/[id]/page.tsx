import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { getDocument, findSuccessors, TYPE_LABEL, STATUS_LABEL } from "@/lib/documents";
import { compileDocumentBrief } from "@/lib/compileDocumentBrief";
import { CopyTextButton } from "@/components/CopyTextButton";
import { DocumentActions } from "@/components/DocumentActions";

export const dynamic = "force-dynamic";

marked.setOptions({ gfm: true, breaks: false });

function fmtUsd(n?: number): string {
  if (n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function shortDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) notFound();

  const [successors, brief] = await Promise.all([findSuccessors(doc.meta.doc_id), compileDocumentBrief(doc)]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Link href="/documents" className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          ← documents
        </Link>
        <Link href={`/crm/${doc.meta.client}`} className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          · crm profile
        </Link>
      </div>

      <div className="sticky top-[57px] z-40 -mx-4 mb-6 border-b border-[var(--color-border-hi)] bg-[var(--color-bg)]/85 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                {TYPE_LABEL[doc.meta.type]} · v{doc.meta.version} · {doc.meta.client}
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--color-border-hi)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">
                {STATUS_LABEL[doc.meta.status]}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{doc.meta.title}</h1>
            {doc.meta.summary && (
              <p className="mt-1 text-sm text-[var(--color-fg-mute)]">{doc.meta.summary}</p>
            )}
          </div>
          <CopyTextButton payload={brief} label="Copy for Claude" variant="secondary" icon="📋" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        {/* Rendered body */}
        <article
          className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed text-[var(--color-fg)] sm:p-6 [&_a]:text-[var(--color-accent)] [&_code]:rounded [&_code]:bg-[var(--color-surface-hi)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--color-fg-mute)] [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:mt-1 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: marked.parse(doc.body) as string }}
        />

        {/* Metadata sidebar */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">metadata</h2>
            <dl className="flex flex-col gap-2 text-xs">
              <Meta label="Type" value={TYPE_LABEL[doc.meta.type]} />
              <Meta label="Client" value={doc.meta.client} />
              <Meta label="Version" value={`v${doc.meta.version}`} />
              <Meta label="Status" value={STATUS_LABEL[doc.meta.status]} />
              <Meta label="Amount" value={fmtUsd(doc.meta.amount_usd)} />
              <Meta label="Created" value={shortDate(doc.meta.created_at)} />
              <Meta label="Sent" value={shortDate(doc.meta.sent_at)} />
              <Meta label="Accepted" value={shortDate(doc.meta.accepted_at)} />
            </dl>
            <p className="mt-3 break-all font-mono text-[10px] text-[var(--color-fg-dim)]">
              id: {doc.meta.doc_id}
            </p>
            {doc.meta.supersedes && (
              <p className="mt-1 break-all font-mono text-[10px] text-[var(--color-fg-dim)]">
                supersedes: <Link href={`/documents/${doc.meta.supersedes}`} className="hover:text-[var(--color-accent)]">{doc.meta.supersedes.slice(0, 8)}…</Link>
              </p>
            )}
          </section>

          <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">actions</h2>
            <DocumentActions docId={doc.meta.doc_id} currentStatus={doc.meta.status} />
          </section>

          {successors.length > 0 && (
            <section className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
                newer versions
              </h2>
              <ul className="flex flex-col gap-1.5">
                {successors.map((s) => (
                  <li key={s.meta.doc_id}>
                    <Link href={`/documents/${s.meta.doc_id}`} className="text-xs text-[var(--color-fg)] hover:text-[var(--color-accent)]">
                      v{s.meta.version} · {STATUS_LABEL[s.meta.status]}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</dt>
      <dd className="font-mono text-xs text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}
