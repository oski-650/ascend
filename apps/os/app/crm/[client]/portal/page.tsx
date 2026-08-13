import Link from "next/link";
import path from "node:path";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/vault";
import { activeInviteFor, listApprovalRequests, listSubmissions } from "@/lib/portal";
import { APPROVAL_KIND_LABEL, approvalStatus } from "@/lib/portalTypes";
import { InviteLinkPanel } from "@/components/InviteLinkPanel";
import { CreateApprovalForm } from "@/components/CreateApprovalForm";
import { ApprovalLinkCopy } from "@/components/ApprovalLinkCopy";

export const dynamic = "force-dynamic";

function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function relName(p: string): string {
  return path.basename(p);
}

export default async function ClientPortalPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const [invite, submissions, approvals, headerList] = await Promise.all([
    activeInviteFor(slug),
    listSubmissions(slug),
    listApprovalRequests(slug),
    headers(),
  ]);

  // Reconstruct site origin for shareable links. Falls back to dev URL.
  const host = headerList.get("host") ?? "localhost:3001";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Link href={`/crm/${slug}`} className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          ← {client.name}
        </Link>
      </div>

      <div className="mb-6 border-b border-[var(--color-border-hi)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">pillar 12 · portal</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{client.name} · Client Portal</h1>
      </div>

      <div className="mb-6">
        <InviteLinkPanel
          clientSlug={slug}
          invite={invite ? { id: invite.id, token: invite.token, created_at: invite.created_at } : null}
          baseUrl={baseUrl}
        />
      </div>

      {/* Approval requests */}
      <section className="mb-6">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          approval requests ({approvals.length})
        </h2>
        <div className="mb-3">
          <CreateApprovalForm clientSlug={slug} />
        </div>
        {approvals.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-fg-mute)]">
            None yet. Create one above to capture client sign-off on a design, scope change, or launch.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {approvals.map((a) => {
              const status = approvalStatus(a);
              const url = invite ? `${baseUrl}/portal/${invite.token}/approve/${a.id}` : null;
              const statusStyle =
                status === "approved"
                  ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : status === "overdue"
                    ? "border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                    : "border-amber-400/60 bg-amber-400/10 text-amber-300";
              return (
                <li
                  key={a.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3 sm:grid-cols-[auto_1fr_auto_auto] sm:gap-4 sm:p-4"
                >
                  <span className="hidden font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)] sm:inline">
                    {APPROVAL_KIND_LABEL[a.kind]}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{a.title}</p>
                    <p className="truncate font-mono text-[11px] text-[var(--color-fg-dim)]">
                      created {shortDate(a.created_at)}
                      {a.due_at && <> · due {shortDate(a.due_at)}</>}
                      {a.approved_at && (
                        <>
                          {" "}· signed {shortDate(a.approved_at)} by{" "}
                          <span className="text-[var(--color-fg-mute)]">{a.approved_by_name}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${statusStyle}`}
                  >
                    {status}
                  </span>
                  {url && status !== "approved" && <ApprovalLinkCopy url={url} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Submissions */}
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          submissions ({submissions.length})
        </h2>
        {submissions.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-fg-mute)]">
            No submissions yet. Once the client opens the invite URL and submits the form, it&apos;ll appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {submissions.map((s) => (
              <li key={s.id} className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
                <header className="mb-3 flex items-baseline justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                    {new Date(s.submitted_at).toLocaleString()}
                  </p>
                  <p className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                    {Object.keys(s.fields).length} fields · {s.files.length} files
                  </p>
                </header>
                {s.files.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {s.files.map((f) => (
                      <span
                        key={f.saved_path}
                        title={`${f.original_name} · ${(f.size / 1024).toFixed(0)} KB · ${f.mime}`}
                        className="inline-flex items-center gap-1 rounded border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-fg-mute)]"
                      >
                        📎 {relName(f.saved_name)}
                      </span>
                    ))}
                  </div>
                )}
                <dl className="grid grid-cols-1 gap-2 text-sm">
                  {Object.entries(s.fields)
                    .filter(([, v]) => v && v.trim().length > 0)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                          {k.replace(/_/g, " ")}
                        </dt>
                        <dd className="whitespace-pre-wrap text-[var(--color-fg)]">{v}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
