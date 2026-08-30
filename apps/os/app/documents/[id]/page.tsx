// app/documents/[id] — THE DOCUMENT VIEW.
//
// The detail level beneath the Documents surface, and a peer of the Client and Prospect views. It
// was the last piece of an already-redesigned surface still running the transitional aliases, which
// is why it also still linked to `/crm/:slug` — a second client destination reached from a page the
// operator arrives at from the redesigned index.
//
// The document body is vault prose, so it is rendered through the shared `.prose-ascend`
// stylesheet rule rather than a stack of utility classes on one element.
//
// It computes nothing. Type/status vocabulary, lineage, and the successor chain all come from
// lib/documents; the write actions continue to go through their existing API endpoints.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { getDocument, findSuccessors, TYPE_LABEL, STATUS_LABEL } from "@/lib/documents";
import { compileDocumentBrief } from "@/lib/compileDocumentBrief";
import { listClients } from "@/core/crm";
import { routeForEntity } from "@/navigation/routing";
import { focusHrefFor } from "@/graph-view/contract";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { CopyTextButton } from "@/components/CopyTextButton";
import { DocumentActions } from "@/components/DocumentActions";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import {
  Breadcrumb,
  EntityHeader,
  FactGrid,
  FactRow,
  PageShell,
  QuietEmpty,
  RelationshipList,
  SectionLabel,
  type RelationItem,
} from "@/components/primitives/entity";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

/** Document status → tone. A lookup on the vocabulary lib/documents owns; it derives nothing. */
const STATUS_TONE: Record<string, Tone> = {
  accepted: "good",
  sent: "accent",
  draft: "neutral",
  superseded: "neutral",
  declined: "risk",
};

function fmtUsd(n?: number): string {
  if (n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function shortDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await getDocument(id);
  return { title: doc ? `${doc.meta.title} · Ascend OS` : "Document · Ascend OS" };
}

async function DocumentDetailPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) notFound();

  const [successors, brief, clients] = await Promise.all([
    findSuccessors(doc.meta.doc_id),
    compileDocumentBrief(doc),
    listClients(),
  ]);

  const meta = doc.meta;
  // The document stores a client SLUG; the roster gives it a name. A lookup, not a derivation.
  const clientName = clients.find((c) => c.slug === meta.client)?.name ?? meta.client;
  const clientHref = routeForEntity("client", meta.client);
  const graphHref = focusHrefFor("document", meta.doc_id);
  const isSuperseded = meta.status === "superseded" || successors.length > 0;

  return (
    <PageShell hue={NODE_VISUAL.document.color}>
      <Breadcrumb
        items={[
          { label: "Neural Core", href: "/" },
          { label: "Documents", href: "/documents" },
          // The client is part of this document's address, and it now resolves to the CANONICAL
          // client view. This link used to point at /crm/:slug.
          ...(clientHref ? [{ label: clientName, href: clientHref }] : []),
          { label: `v${meta.version}` },
        ]}
      />

      <EntityHeader
        kind={TYPE_LABEL[meta.type]}
        kindColor={NODE_VISUAL.document.color}
        name={meta.title}
        facts={
          <>
            <Status tone={STATUS_TONE[meta.status] ?? "neutral"}>{STATUS_LABEL[meta.status]}</Status>
            <Badge>v{meta.version}</Badge>
            {meta.amount_usd !== undefined && (
              <span className="t-mono text-[var(--color-t3)]">{fmtUsd(meta.amount_usd)}</span>
            )}
            {clientHref && (
              <Link
                href={clientHref}
                className="t-mono text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
              >
                ↳ {clientName}
              </Link>
            )}
          </>
        }
        actions={
          <>
            {graphHref && (
              <Link href={graphHref} className="contents">
                <Button variant="ghost">Focus in Neural Core</Button>
              </Link>
            )}
            <CopyTextButton payload={brief} label="Copy for Claude" variant="secondary" />
          </>
        }
      />

      {/* ── STATE ────────────────────────────────────────────────────────────────────────────
          Value leads: for a proposal or contract, the amount is the fact the operator acts on. */}
      <section className="mb-11">
        <FactGrid
          lead={
            <FactRow
              lead
              value={fmtUsd(meta.amount_usd)}
              label="Value"
              detail={meta.amount_usd === undefined ? "no amount recorded" : TYPE_LABEL[meta.type]}
              tone={meta.status === "accepted" && meta.amount_usd !== undefined ? "good" : undefined}
            />
          }
        >
          <FactRow value={`v${meta.version}`} label="Version" detail={isSuperseded ? "superseded" : "current"} />
          <FactRow value={shortDate(meta.created_at)} label="Created" detail={`sent ${shortDate(meta.sent_at)}`} />
          <FactRow
            value={shortDate(meta.accepted_at)}
            label="Accepted"
            detail={meta.accepted_at ? "signed off" : "not yet accepted"}
            tone={meta.accepted_at ? "good" : undefined}
          />
        </FactGrid>
      </section>

      {/* ── ACTION ───────────────────────────────────────────────────────────────────────────
          The only interactive layer: status transitions and versioning, each a real write through
          the existing /api/documents endpoints. */}
      <section className="mb-11">
        <SectionLabel tier="primary">Actions</SectionLabel>
        <DocumentActions docId={meta.doc_id} currentStatus={meta.status} />
      </section>

      {/* ── LINEAGE ──────────────────────────────────────────────────────────────────────────
          A document's version history is its most important relationship — it is what tells you
          whether the thing you are reading is still the live one. */}
      <section className="mb-11">
        <SectionLabel
          tier={isSuperseded ? "decision" : "quiet"}
          aside={successors.length > 0 ? `${successors.length} newer` : "current version"}
        >
          Lineage
        </SectionLabel>

        {successors.length === 0 && !meta.supersedes ? (
          <QuietEmpty>This is the only version of this document.</QuietEmpty>
        ) : (
          <RelationshipList
            items={[
              ...(meta.supersedes
                ? [
                    {
                      id: meta.supersedes,
                      label: "Previous version",
                      detail: meta.supersedes.slice(0, 8),
                      status: "superseded",
                      tone: "neutral" as const,
                      dotColor: NODE_VISUAL.document.color,
                      href: `/documents/${meta.supersedes}`,
                    },
                  ]
                : []),
              ...successors.map<RelationItem>((s) => ({
                id: s.meta.doc_id,
                label: `Version ${s.meta.version}`,
                detail: shortDate(s.meta.created_at),
                status: STATUS_LABEL[s.meta.status],
                tone: STATUS_TONE[s.meta.status] ?? "neutral",
                dotColor: NODE_VISUAL.document.color,
                href: `/documents/${s.meta.doc_id}`,
              })),
            ]}
            empty="No other versions."
          />
        )}
      </section>

      {/* ── THE DOCUMENT ─────────────────────────────────────────────────────────────────── */}
      <section className="mb-11">
        <SectionLabel tier="primary">Document</SectionLabel>
        {meta.summary && (
          <p className="t-body mb-5 max-w-[68ch] text-[var(--color-t2)]">{meta.summary}</p>
        )}
        {doc.body ? (
          <article
            className="prose-ascend max-w-[68ch]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body) }}
          />
        ) : (
          <QuietEmpty>This document has no body yet.</QuietEmpty>
        )}
      </section>

      <p className="t-mono text-[var(--color-t3)]">id: {meta.doc_id}</p>
    </PageShell>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `DocumentDetailPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function DocumentDetailPage(...props: Parameters<typeof DocumentDetailPageContent>) {
  return renderOrDenied("Documents", () => DocumentDetailPageContent(...props));
}
