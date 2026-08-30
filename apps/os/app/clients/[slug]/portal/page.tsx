// app/clients/[slug]/portal — OPERATOR-SIDE PORTAL ADMINISTRATION.
//
// Migrated from /crm/[client]/portal, the last capability the retired CRM routes owned. It is a
// child of the client because that is what it administers: the client's access to Ascend, not a
// separate object.
//
// TWO SURFACES, DELIBERATELY NOT MERGED:
//   THIS page          — the operator issuing access, requesting approvals, reading submissions.
//   /portal/[token]/** — the CLIENT's authenticated experience. Different audience, different
//                        identity, and permanently outside the Neural Core visual language. It is
//                        not touched by this increment.
//
// CAPABILITY IS PRESERVED EXACTLY. Every write still goes through the existing endpoints under
// /api/portal/** — invite issue/rotate, approval creation — which remain the sole writers and are
// unchanged. This page reads through lib/portal (the canonical portal reader) and renders.
//
// KNOWN GAP, RECORDED NOT FIXED: lib/portal emits NO events, although packages/domain defines
// portal.invited / portal.invite_revoked / portal.submitted / approval.requested /
// approval.approved. Portal administration therefore cannot participate in the
// Action → Event → Entity loop closed in increments 6 and 7. Extending the event spine to portal
// writes is a separate increment; nothing here papers over it.
//
// `node:path` is NOT imported. The previous version called path.basename on `saved_name`, which
// lib/portal already produces as a bare filename — a no-op. Dropping it is what allows F18's
// narrow exemption to be deleted rather than carried to this new location.

import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getClient } from "@/core/crm";
import { activeInviteFor, listApprovalRequests, listSubmissions } from "@/lib/portal";
import { APPROVAL_KIND_LABEL, approvalStatus } from "@/lib/portalTypes";
import { routeForEntity } from "@/navigation/routing";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { InviteLinkPanel } from "@/components/InviteLinkPanel";
import { CreateApprovalForm } from "@/components/CreateApprovalForm";
import { ApprovalLinkCopy } from "@/components/ApprovalLinkCopy";
import { Status, type Tone } from "@/components/primitives";
import {
  Breadcrumb,
  EntityHeader,
  PageShell,
  QuietEmpty,
  SectionLabel,
} from "@/components/primitives/entity";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

/** Approval status → tone. A lookup on the domain deriver's own word; it derives nothing. */
const STATUS_TONE: Record<string, Tone> = {
  approved: "good",
  overdue: "risk",
  pending: "accent",
};

function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `${client.name} · Portal · Ascend OS` : "Portal · Ascend OS" };
}

async function ClientPortalAdminPageContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const [invite, submissions, approvals, headerList] = await Promise.all([
    activeInviteFor(slug),
    listSubmissions(slug),
    listApprovalRequests(slug),
    headers(),
  ]);

  // Reconstruct the site origin so the share links are usable outside this machine.
  const host = headerList.get("host") ?? "localhost:3001";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  const clientHref = routeForEntity("client", slug);
  // Counting a filtered list is selection, not a derived metric.
  const pending = approvals.filter((a) => approvalStatus(a) !== "approved");

  return (
    <PageShell hue={NODE_VISUAL.approval.color}>
      <Breadcrumb
        items={[
          { label: "Neural Core", href: "/" },
          ...(clientHref ? [{ label: client.name, href: clientHref }] : []),
          { label: "Portal" },
        ]}
      />

      <EntityHeader
        kind="Portal administration"
        kindColor={NODE_VISUAL.approval.color}
        name={client.name}
        facts={
          <>
            <Status tone={invite ? "good" : "neutral"}>
              {invite ? "access issued" : "no access"}
            </Status>
            <span className="t-mono text-[var(--color-t3)]">
              {approvals.length} approval{approvals.length === 1 ? "" : "s"} ·{" "}
              {submissions.length} submission{submissions.length === 1 ? "" : "s"}
            </span>
          </>
        }
      />

      {/* ── ACCESS ───────────────────────────────────────────────────────────────────────────
          What the client can reach, and the single link that grants it. */}
      <section className="mb-11">
        <SectionLabel tier="primary" aside={invite ? "active" : "none issued"}>
          Client access
        </SectionLabel>
        <InviteLinkPanel
          clientSlug={slug}
          invite={invite ? { id: invite.id, token: invite.token, created_at: invite.created_at } : null}
          baseUrl={baseUrl}
        />
      </section>

      {/* ── APPROVALS ────────────────────────────────────────────────────────────────────────
          Outstanding sign-offs lead, because they are the only thing here that is waiting on
          someone. Signed ones stay visible but recede. */}
      <section className="mb-11">
        <SectionLabel
          tier={pending.length > 0 ? "decision" : "primary"}
          aside={
            approvals.length === 0
              ? undefined
              : `${pending.length} outstanding of ${approvals.length}`
          }
        >
          Approvals
        </SectionLabel>

        <div className="mb-5">
          <CreateApprovalForm clientSlug={slug} />
        </div>

        {approvals.length === 0 ? (
          <QuietEmpty>
            No approvals requested. Create one to capture client sign-off on a design, a scope
            change, or a launch.
          </QuietEmpty>
        ) : (
          <ul className="flex flex-col">
            {approvals.map((a) => {
              const status = approvalStatus(a); // domain deriver, copied — never re-derived here
              const url = invite ? `${baseUrl}/portal/${invite.token}/approve/${a.id}` : null;
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-x-5 gap-y-2 border-b border-[var(--color-line)] py-4 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="t-body text-[var(--color-t1)]">{a.title}</h3>
                    <p className="t-mono mt-1 text-[var(--color-t3)]">
                      {APPROVAL_KIND_LABEL[a.kind]} · created {shortDate(a.created_at)}
                      {a.due_at && <> · due {shortDate(a.due_at)}</>}
                      {a.approved_at && (
                        <> · signed {shortDate(a.approved_at)} by {a.approved_by_name}</>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Status tone={STATUS_TONE[status] ?? "neutral"}>{status}</Status>
                    {url && status !== "approved" && <ApprovalLinkCopy url={url} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── SUBMISSIONS ──────────────────────────────────────────────────────────────────────
          What the client sent back. Reference material, so it is quiet — but rendered in full,
          because a half-shown answer is not an answer. */}
      <section>
        <SectionLabel tier="quiet" aside={submissions.length > 0 ? `${submissions.length}` : undefined}>
          Submissions
        </SectionLabel>

        {submissions.length === 0 ? (
          <QuietEmpty>
            {invite
              ? "Nothing submitted yet. Submissions appear here once the client opens their link and sends the form."
              : "No submissions — this client has no portal access yet."}
          </QuietEmpty>
        ) : (
          <ul className="flex flex-col gap-8">
            {submissions.map((s) => {
              const answered = Object.entries(s.fields).filter(([, v]) => v && v.trim().length > 0);
              return (
                <li key={s.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-line)] pb-2">
                    <p className="t-mono text-[var(--color-t2)]">
                      {new Date(s.submitted_at).toLocaleString()}
                    </p>
                    <p className="t-mono text-[var(--color-t3)]">
                      {answered.length} field{answered.length === 1 ? "" : "s"} · {s.files.length}{" "}
                      file{s.files.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  {s.files.length > 0 && (
                    <ul className="mt-3 flex flex-col">
                      {s.files.map((f) => (
                        <li
                          key={f.saved_path}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-line)] py-2 last:border-b-0"
                        >
                          {/* `saved_name` is already a bare filename — no path handling needed. */}
                          <span className="t-body min-w-0 break-all text-[var(--color-t2)]">
                            {f.saved_name}
                          </span>
                          <span className="t-mono shrink-0 text-[var(--color-t3)]">
                            {(f.size / 1024).toFixed(0)} KB · {f.mime}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="mt-3 flex flex-col gap-3">
                    {answered.map(([k, v]) => (
                      <div key={k}>
                        <dt className="t-label text-[var(--color-t3)]">{k.replace(/_/g, " ")}</dt>
                        <dd className="t-body mt-0.5 max-w-[68ch] whitespace-pre-wrap text-[var(--color-t1)]">
                          {v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="t-mono mt-11 text-[var(--color-t3)]">
        The client&rsquo;s own view lives at{" "}
        <span className="text-[var(--color-t2)]">/portal/&lt;token&gt;</span> and is a separate
        product surface.{" "}
        {clientHref && (
          <Link href={clientHref} className="hover:text-[var(--color-accent)]">
            ← back to {client.name}
          </Link>
        )}
      </p>
    </PageShell>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `ClientPortalAdminPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function ClientPortalAdminPage(...props: Parameters<typeof ClientPortalAdminPageContent>) {
  return renderOrDenied("Client portals", () => ClientPortalAdminPageContent(...props));
}
