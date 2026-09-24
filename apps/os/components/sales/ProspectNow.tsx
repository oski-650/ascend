// components/sales/ProspectNow — the "Now" card: where this prospect stands, and how to reach it
// (Slice 2A.2b). Presentational, synchronous, no data access: the page reads, this renders.
//
// Everything a salesperson needs before dialling is here and nowhere else — the last contact, the
// open follow-up and whether it is late, who holds the prospect, and the phone number as a real
// `tel:` link. Due state is WORDS plus a glyph ("! Overdue · 2 days"); the colour only reinforces it.

import type { ActionSummary } from "@/core/crm/sales";
import type { ContactChannel, ContactOutcome, FollowUpAction } from "@/core/crm/sales";
import {
  ACTION_LABEL, CHANNEL_LABEL, OUTCOME_LABEL, formatDay, formatDue, formatInstant, personName, presentDue, relativeTime,
} from "./presentation";
import { CallButton } from "./SalesWorkspace";
import { FollowUpEditor } from "./FollowUpEditor";

const TONE: Record<"risk" | "accent" | "neutral", string> = {
  risk: "text-[var(--color-risk)] border-[var(--color-risk)]/45",
  accent: "text-[var(--color-accent-hi)] border-[var(--color-accent)]/45",
  neutral: "text-[var(--color-t2)] border-[var(--color-line-strong)]",
};

export function ProspectNow({
  summary, names, viewer, contactName, phone, email, website, canManage = false, slug = "", now = new Date(),
}: {
  summary: ActionSummary;
  names: Record<string, string>;
  viewer: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  canManage?: boolean;
  slug?: string;
  now?: Date;
}) {
  const latest = summary.latestContact;
  const follow = summary.openFollowUp;
  const due = follow ? presentDue(summary.dueState, follow.dueOn, now) : null;
  const who = (id: string | null) => (id === null ? "Unassigned" : id === viewer ? "You" : personName(id, names));

  return (
    <section aria-labelledby="now-h" className="rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]">
      <h2 id="now-h" className="sr-only">Now</h2>
      <dl className="divide-y divide-[var(--color-line)]">
        <Row label="Last contact">
          {latest ? (
            <>
              <span className="t-body text-[var(--color-t1)]">
                {OUTCOME_LABEL[latest.outcome as ContactOutcome] ?? "Contact"}
                <span className="text-[var(--color-t3)]"> · by {(CHANNEL_LABEL[latest.channel as ContactChannel] ?? "other").toLowerCase()}</span>
              </span>
              <span className="t-meta text-[var(--color-t3)]">
                {relativeTime(latest.happenedAt, now)} · {formatInstant(latest.happenedAt, now)}
              </span>
            </>
          ) : summary.lastContact ? (
            <>
              <span className="t-body text-[var(--color-t1)]">{formatDay(summary.lastContact, now)}</span>
              {/* An imported date is a fact about a day, with no outcome behind it — so none is shown. */}
              <span className="t-meta text-[var(--color-t3)]">From the imported record — no outcome recorded.</span>
            </>
          ) : (
            <span className="t-body text-[var(--color-t3)]">No contact recorded yet</span>
          )}
        </Row>

        <Row label="Next">
          {follow ? (
            <>
              <span className="t-body text-[var(--color-t1)]">
                {ACTION_LABEL[follow.action as FollowUpAction] ?? "Follow up"} · {formatDue(follow.dueOn, follow.dueAt, now)}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {due && (
                  <span className={`t-label inline-flex items-center gap-1 rounded-[var(--radius-xs)] border px-1.5 py-0.5 ${TONE[due.tone]}`}>
                    <span aria-hidden>{due.glyph}</span>{due.label}
                  </span>
                )}
                <span className="t-meta text-[var(--color-t3)]">{who(follow.assignee)}</span>
              </span>
              {canManage && <FollowUpEditor slug={slug} rowId={summary.id} followUp={follow} names={names} />}
            </>
          ) : (
            <span className="t-body text-[var(--color-t3)]">Nothing scheduled</span>
          )}
        </Row>

        <Row label="Assigned">
          <span className={`t-body ${summary.assignedTo ? "text-[var(--color-t1)]" : "text-[var(--color-t3)]"}`}>{who(summary.assignedTo)}</span>
        </Row>

        <Row label="Contact">
          {contactName && <span className="t-meta text-[var(--color-t2)]">{contactName}</span>}
          {phone ? <span className="whitespace-nowrap"><CallButton variant="inline" /></span> : <span className="t-meta text-[var(--color-t3)]">No phone number</span>}
          {(email || website) && (
            <span className="flex min-w-0 flex-col gap-0.5">
              {email && (
                <a href={`mailto:${email}`} className="t-meta break-all text-[var(--color-t2)] underline-offset-4 hover:text-[var(--color-t1)] hover:underline">{email}</a>
              )}
              {website && (
                <a href={website} target="_blank" rel="noreferrer noopener" className="t-meta break-all text-[var(--color-t2)] underline-offset-4 hover:text-[var(--color-t1)] hover:underline">
                  {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
            </span>
          )}
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3">
      <dt className="t-label pt-[3px] text-[var(--color-t3)]">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">{children}</dd>
    </div>
  );
}
