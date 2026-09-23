import Link from "next/link";
import type { SalesQueueRow as Row } from "@/core/crm/sales";
import { ACTION_LABEL, OUTCOME_LABEL, formatDue, personName, presentDue, relativeTime, stageLabel } from "./presentation";

export function SalesQueueRow({ row, names, now }: { row: Row; names: Record<string, string>; now: Date }) {
  const due = row.openFollowUp;
  const state = presentDue(row.dueState, due?.dueOn ?? null, now);
  const contact = row.latestContact;
  const href = `/sales/${encodeURIComponent(row.slug ?? row.id)}`;
  return (
    <li className="border-b border-[var(--color-line)] last:border-b-0" data-sales-row>
      <Link href={href} className="group grid min-h-16 min-w-0 gap-x-5 gap-y-2 py-4 text-left transition-colors hover:bg-[var(--color-surface-2)] sm:px-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] lg:items-center">
        <span className="min-w-0">
          <span className="block break-words text-base font-medium leading-snug text-[var(--color-t1)] group-hover:text-[var(--color-accent)]">{row.name || "Unnamed prospect"}</span>
          <span className="mt-1 block text-sm text-[var(--color-t2)]">{stageLabel(row.status)} · {row.assignedTo ? personName(row.assignedTo, names) : "Unassigned"}</span>
        </span>
        <span className="text-sm text-[var(--color-t2)]">
          {contact ? `${(OUTCOME_LABEL as Record<string, string>)[contact.outcome] ?? "Contact recorded"} · ${relativeTime(contact.happenedAt, now)}` : "No contact yet"}
        </span>
        <span className="min-w-0 text-sm text-[var(--color-t2)]">
          {due ? <><span className={state?.tone === "risk" ? "font-medium text-[var(--color-risk)]" : "font-medium text-[var(--color-t1)]"}>{state?.label ?? "Next follow-up"}</span><span className="block break-words">{(ACTION_LABEL as Record<string, string>)[due.action] ?? "Follow up"} · {formatDue(due.dueOn, due.dueAt, now)}</span></> : <span>No follow-up set</span>}
        </span>
      </Link>
    </li>
  );
}
