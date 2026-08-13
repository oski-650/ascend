import { notFound } from "next/navigation";
import Link from "next/link";
import { findInviteByToken, getApprovalRequest } from "@/lib/portal";
import { APPROVAL_KIND_LABEL, approvalStatus } from "@/lib/portalTypes";
import { ApprovalSignForm } from "@/components/ApprovalSignForm";

export const dynamic = "force-dynamic";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ token: string; reqId: string }>;
}) {
  const { token, reqId } = await params;
  const invite = await findInviteByToken(token);
  if (!invite) notFound();
  const reqRecord = await getApprovalRequest(reqId);
  if (!reqRecord || reqRecord.client_slug !== invite.client_slug) notFound();

  const status = approvalStatus(reqRecord);

  return (
    <div>
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          {APPROVAL_KIND_LABEL[reqRecord.kind]} approval
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--color-fg)] sm:text-3xl">
          {reqRecord.title}
        </h1>
      </header>

      {reqRecord.description && (
        <article className="mb-6 whitespace-pre-wrap rounded-xl border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-5 text-sm leading-relaxed text-[var(--color-fg)] sm:p-7">
          {reqRecord.description}
        </article>
      )}

      <section className="rounded-xl border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-5 sm:p-7">
        {status === "approved" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-xl text-[var(--color-accent)]">
              ✓
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">Approved</h2>
            <p className="font-serif text-2xl italic text-[var(--color-fg)]">{reqRecord.signature_text}</p>
            <p className="font-mono text-xs text-[var(--color-fg-mute)]">
              {reqRecord.approved_by_name} ·{" "}
              {new Date(reqRecord.approved_at as string).toLocaleString()}
            </p>
            <Link
              href={`/portal/${token}`}
              className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]"
            >
              ← back to portal
            </Link>
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-base font-semibold text-[var(--color-fg)]">Sign to approve</h2>
            <p className="mb-4 text-sm text-[var(--color-fg-mute)]">
              Approving means you&apos;ve reviewed the above and authorize the Ascend team to proceed.
            </p>
            <ApprovalSignForm token={token} requestId={reqRecord.id} />
          </>
        )}
      </section>
    </div>
  );
}
