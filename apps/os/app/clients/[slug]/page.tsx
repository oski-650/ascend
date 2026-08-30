// app/clients/[slug] — THE CLIENT VIEW. The first level beneath the Neural Core.
//
// Answers, in order: what am I looking at · why does it matter · what is connected to it ·
// what should I do next.
//
// It gathers and renders; it computes nothing. Health comes from the Health Engine via Mission
// Control, ranking from the Decision Engine via `assemblePriorityFeed` — `rank()` is never imported
// here (F14 is absolute). Everything shown is real: where a relationship does not exist, the section
// says so plainly rather than being padded.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { focusHrefFor } from "@/graph-view/contract";
import { Badge, Button, Status } from "@/components/primitives";
import {
  ActivityList,
  AttentionItem,
  Breadcrumb,
  EntityHeader,
  FactGrid,
  FactRow,
  PageShell,
  ProgressRail,
  QuietEmpty,
  RelationshipList,
  SectionLabel,
  type RelationItem,
} from "@/components/primitives/entity";
import { compileContext } from "@/lib/compileContext";
import { ProfileSection, MetaSection } from "@/components/ProfileSection";
import { CopyTextButton } from "@/components/CopyTextButton";
import { getClientDossier, toActivityItems, usd } from "./dossier";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dossier = await getClientDossier(slug);
  return { title: dossier ? `${dossier.client.name} · Ascend OS` : "Client · Ascend OS" };
}

async function ClientPageContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dossier = await getClientDossier(slug);
  if (!dossier) notFound();

  const { client, production, health, invoices, documents, approvals, audits, attention, activity } =
    dossier;

  const meta = client.meta.data;
  const status = typeof meta.status === "string" ? meta.status : null;
  const tier = typeof meta.tier === "string" ? meta.tier : null;
  const website = typeof meta.website === "string" ? meta.website : null;
  const promotedFrom =
    typeof meta.promoted_from_prospect === "string" ? meta.promoted_from_prospect : null;

  // Selection only — counting a filtered list is not a business metric.
  const openInvoices = invoices.filter((i) => i.status !== "paid");
  const overdueInvoices = invoices.filter((i) => i.status === "overdue");
  const openTasks =
    production?.phases.reduce((n, p) => n + p.checklist.filter((c) => !c.done).length, 0) ?? 0;
  const activePhase =
    production && production.activePhaseIndex !== null
      ? production.phases[production.activePhaseIndex]
      : null;

  // Graph identity comes from the contract that defines it, never a hand-built string (F19).
  const graphHref = focusHrefFor("client", slug);

  return (
    <PageShell hue={NODE_VISUAL.client.color}>
      <Breadcrumb items={[{ label: "Neural Core", href: "/" }, { label: client.name }]} />

      <EntityHeader
        kind="Client"
        kindColor={NODE_VISUAL.client.color}
        name={client.name}
        facts={
          <>
            {status && <Status tone={status === "active" ? "good" : "neutral"}>{status}</Status>}
            {tier && <Badge>{tier}</Badge>}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer noopener"
                className="t-mono text-[var(--color-t3)] underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
              >
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {promotedFrom && (
              <Link
                href={`/sales/${promotedFrom}`}
                className="t-mono text-[var(--color-t3)] hover:text-[var(--color-accent)]"
              >
                ↳ promoted from prospect
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
            {/* Migrated from /crm/[client]/portal. Operator-side administration of THIS client's
                access — not the client-facing portal itself, which is a separate surface. */}
            <Link href={`/clients/${slug}/portal`} className="contents">
              <Button variant="ghost">Portal administration</Button>
            </Link>
            {/* Migrated from /crm/[client]. The old page shipped its own CopyContextButton, which
                duplicated CopyTextButton; the canonical component is used instead of moving a
                second copy across. `compileContext` — the payload's owner — is unchanged. */}
            <CopyTextButton
              payload={compileContext(client)}
              label="Copy context"
              variant="secondary"
            />
            {production && (
              <Link href={`/clients/${slug}/project`} className="contents">
                <Button variant="primary">Open project →</Button>
              </Link>
            )}
          </>
        }
      />

      {/* ── CURRENT STATE ────────────────────────────────────────────────────────────────────
          FACT vs SIGNAL: task/invoice counts are facts the vault contains. Health is a SIGNAL, so
          it names the engine that derived it. */}
      <section className="mb-11">
        <FactGrid
          lead={
            health && health.tier !== null ? (
              <FactRow
                lead
                value={String(health.score)}
                label="Health"
                detail={health.tier.replace("_", " ")}
                attribution="Health Engine"
                tone={health.tier === "at_risk" ? "risk" : health.tier === "healthy" ? "good" : undefined}
              />
            ) : health ? (
              // Uncomputable, not unscored — and said in words, since "—" reads as "not applicable".
              <FactRow
                lead
                value="?"
                label="Health"
                detail="cannot be determined — phase history unknown"
                attribution="Health Engine"
              />
            ) : (
              <FactRow lead value="—" label="Health" detail="no project to score" />
            )
          }
        >
          <FactRow
            value={production && production.overallProgress !== null ? `${production.overallProgress}%` : production ? "?" : "—"}
            label="Progress"
            detail={
              activePhase
                ? activePhase.label
                : production
                  ? production.phaseState === "launched"
                    ? "all phases resolved"
                    : "phase history unknown"
                  : "no project"
            }
          />

          <FactRow
            value={String(openTasks)}
            label="Open tasks"
            detail={production ? `across ${production.phases.length} phases` : "no project"}
          />

          <FactRow
            value={usd(invoices.reduce((sum, i) => sum + (i.status !== "paid" ? i.amountUsd : 0), 0))}
            label="Outstanding"
            detail={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"} total`}
            tone={overdueInvoices.length > 0 ? "risk" : undefined}
          />
        </FactGrid>
      </section>

      {/* ── WHAT CHANGED ─────────────────────────────────────────────────────────────────────
          The other half of "where does this stand". CURRENT STATE above is what the engines say is
          true now; this is what the event spine says actually happened, and the two are never
          blended — nothing here is derived from present state, and present state is never inferred
          from history.

          It is NOT an activity feed. It is scoped to this relationship, it shows the transition the
          event itself recorded, and it names the part of the business that recorded it. Every row
          can answer: what happened · when · to what · what changed · where to inspect it. An event
          that cannot answer those is not rendered.

          This REPLACED the old "Recent activity" section at the bottom of the page rather than
          joining it — one temporal section per surface, positioned where it is read. */}
      <section className="mb-11">
        <SectionLabel tier="primary" aside={activity.length > 0 ? "newest first" : undefined}>
          What changed
        </SectionLabel>
        <ActivityList
          groupByDay
          items={toActivityItems(activity)}
          empty="Nothing recorded for this client yet. Changes appear here as work happens."
        />
      </section>

      {/* ── ATTENTION (DECISION) ─────────────────────────────────────────────────────────── */}
      <section className="mb-11">
        <SectionLabel tier="decision" aside={attention.length > 0 ? `${attention.length} ranked` : undefined}>
          Needs attention
        </SectionLabel>
        {attention.length === 0 ? (
          <QuietEmpty>
            Nothing ranked for this client. No open health risks or opportunities.
          </QuietEmpty>
        ) : (
          attention.map((item) => (
            <AttentionItem
              key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
              rank={item.rank}
              explanation={item.explanation.replace(/^because:\s*/i, "")}
              actions={
                <>
                  {graphHref && (
                    <Link href={graphHref} className="contents">
                      <Button variant="ghost">Focus in graph</Button>
                    </Link>
                  )}
                  {production && (
                    <Link
                      href={`/clients/${slug}/project`}
                      className="t-label text-[var(--color-t3)] hover:text-[var(--color-accent)]"
                    >
                      Open project →
                    </Link>
                  )}
                </>
              }
            />
          ))
        )}
      </section>

      {/* ── PROJECT ──────────────────────────────────────────────────────────────────────── */}
      <section className="mb-11">
        <SectionLabel tier="primary">Project</SectionLabel>
        {!production ? (
          <QuietEmpty>
            No production state for this client. Add a <code>production_state.md</code> to its vault
            folder to begin tracking delivery.
          </QuietEmpty>
        ) : (
          <Link
            href={`/clients/${slug}/project`}
            className="-mx-3 block rounded-[var(--radius-md)] px-3 py-3 transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="t-h2 text-[var(--color-t1)]">{production.clientName} · Build</h3>
              <span className="t-mono text-[var(--color-t3)]">
                {activePhase ? activePhase.label : "launched"}
                {production.launchTarget ? ` · target ${production.launchTarget}` : ""}
              </span>
            </div>
            <div className="mt-3 max-w-[420px]">
              <ProgressRail
                value={production.overallProgress}
                tone="accent"
                label={`${production.clientName} project progress`}
              />
            </div>
            <p className="t-meta mt-2 text-[var(--color-t3)]">
              {openTasks === 0
                ? "No open tasks."
                : `${openTasks} open task${openTasks === 1 ? "" : "s"}`}
            </p>
          </Link>
        )}
      </section>

      {/* ── PROFILE (IDENTITY) ───────────────────────────────────────────────────────────────
          The vault's own prose about this client, migrated from the retired /crm/[client].

          PLACEMENT IS DELIBERATE. It sits with the reference material rather than at the top of
          the page: health and ranked attention are what an operator arrives for, and profile prose
          is what they consult to remember who someone is. Collapsed by default for the same
          reason — this is the quietest content in the product, and the old CRM page gave it the
          loudest chrome. Business context opens by default because it is the one section that
          actually gets read. */}
      <section className="mb-11">
        <SectionLabel tier="quiet" aside={client.meta.missing ? "meta missing" : undefined}>
          Profile
        </SectionLabel>
        <ProfileSection title="Business context" section={client.business} defaultOpen />
        <ProfileSection title="Brand identity" section={client.brand} />
        <ProfileSection title="Project scope" section={client.scope} />
        <MetaSection data={client.meta.data} missing={client.meta.missing} />
      </section>

      {/* ── RELATIONSHIPS ────────────────────────────────────────────────────────────────────
          Lists, not a card grid: these are peers, and density is what makes them scannable. */}
      <section className="mb-11">
        <SectionLabel tier="quiet">Relationships</SectionLabel>

        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
          <RelationGroup
            title="Invoices"
            count={invoices.length}
            note={
              overdueInvoices.length > 0
                ? `${overdueInvoices.length} overdue`
                : openInvoices.length > 0
                  ? `${openInvoices.length} open`
                  : invoices.length > 0
                    ? "all paid"
                    : undefined
            }
            items={invoices.map<RelationItem>((inv) => ({
              id: inv.id,
              label: inv.label,
              detail: usd(inv.amountUsd),
              status: inv.status,
              tone: inv.status === "overdue" ? "risk" : inv.status === "paid" ? "good" : "neutral",
              dotColor: NODE_VISUAL.invoice.color,
              href: "/finance",
            }))}
            empty="No invoices for this client."
          />

          <RelationGroup
            title="Documents"
            count={documents.length}
            items={documents.map<RelationItem>((doc) => ({
              id: doc.docId,
              label: `${doc.title} v${doc.version}`,
              detail: doc.type,
              status: doc.status,
              tone: doc.status === "accepted" ? "good" : "neutral",
              dotColor: NODE_VISUAL.document.color,
              href: `/documents/${doc.docId}`,
            }))}
            empty="No documents for this client."
          />

          <RelationGroup
            title="Approvals"
            count={approvals.length}
            items={approvals.map<RelationItem>((a) => ({
              id: a.id,
              label: a.title,
              detail: a.kind,
              status: a.status,
              tone: a.status === "overdue" ? "risk" : a.status === "approved" ? "good" : "neutral",
              dotColor: NODE_VISUAL.approval.color,
            }))}
            empty="No approvals requested."
          />

          <RelationGroup
            title="Audits"
            count={audits.length}
            hidden={Math.max(0, audits.length - 6)}
            items={audits.slice(0, 6).map<RelationItem>((a) => ({
              id: a.id,
              label: `Site audit · ${a.strategy}`,
              detail: a.runAt.slice(0, 10),
              status: a.performance === null ? "no score" : `perf ${a.performance}`,
              dotColor: NODE_VISUAL.audit.color,
              href: "/maintenance",
            }))}
            empty="No site audits recorded."
          />
        </div>
      </section>

    </PageShell>
  );
}

/** One relationship group: a labelled list with an honest count and an honest empty state. */
function RelationGroup({
  title,
  count,
  note,
  items,
  empty,
  hidden,
}: {
  title: string;
  count: number;
  note?: string;
  items: RelationItem[];
  empty: string;
  hidden?: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="t-label text-[var(--color-t2)]">
          {title} <span className="text-[var(--color-t3)]">{count}</span>
        </h3>
        {note && <span className="t-mono text-[var(--color-t3)]">{note}</span>}
      </div>
      <RelationshipList items={items} empty={empty} hidden={hidden} />
    </div>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `ClientPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function ClientPage(...props: Parameters<typeof ClientPageContent>) {
  return renderOrDenied("Clients", () => ClientPageContent(...props));
}
