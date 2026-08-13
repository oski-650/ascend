// mission-control/jarvis.ts — CALLER-OWNED pure shaper (MC-1): present Decision output; rank nothing.
//
// JARVIS's morning briefing is a PURE reshaping of what the page already fetched. It CONSUMES
// Decision's already-ranked PriorityItem[] and phrases them; it fetches nothing, ranks nothing,
// weights nothing, and selects nothing by severity/score. The status line shows RAW owned facts
// (streak, yesterday's hours, overdue count/amount, pending automations) — presented, never ranked.
//
// Ranking lives exclusively in Decision.rank(). Overdue invoices are a raw finance fact (D-3.5.1/A):
// displayed from FinanceKpis, never converted into a recommendation.

import type { PriorityItem } from "@/engines/decision-engine";

export type GreetingLine = { kind: "in" | "out" | "err" | "sys"; text: string };

export type GreetingStatus = {
  streak: number;
  yesterdaySeconds: number;
  pendingAutomations: number;
  overdue: { count: number; amount: number };
};

export type GreetingInput = {
  priorityItems: PriorityItem[];
  status: GreetingStatus;
  now?: Date;
};

/** How many ranked items the briefing surfaces — a presentation limit over Decision's order. */
const MAX_RECOMMENDATIONS = 4;

/**
 * Build JARVIS's briefing from Decision-ranked PriorityItems + raw owned status facts.
 * Pure and synchronous: no fetch, no rank, no weight, no severity/score selection. The
 * recommendations ARE Decision's top-N in Decision's order — Jarvis only phrases them.
 */
export function buildGreeting(input: GreetingInput): GreetingLine[] {
  const now = input.now ?? new Date();
  const { priorityItems, status } = input;
  const lines: GreetingLine[] = [];

  lines.push({ kind: "out", text: `${timeGreeting(now)}.` });

  // Decision already ranked these; take the first N (presentation truncation, not re-ordering).
  const top = priorityItems.slice(0, MAX_RECOMMENDATIONS);
  if (top.length === 0) {
    lines.push({
      kind: "out",
      text: "Nothing ranked needs your attention this morning — no open health risks or opportunities. A quiet window for deep work, if you have it.",
    });
  } else {
    const verb = top.length === 1 ? "one item warrants your attention" : `${top.length} items warrant your attention`;
    lines.push({ kind: "out", text: `Briefly — ${verb}:` });
    for (const item of top) {
      lines.push({ kind: "out", text: `  ▸ ${phrase(item)}` });
    }
  }

  // Status line — RAW owned facts, fixed authored order, never ranked (overdue = fact only, D-3.5.1/A).
  const fragments: string[] = [];
  if (status.streak > 0) fragments.push(`Streak: ${status.streak} day${status.streak === 1 ? "" : "s"}`);
  if (status.yesterdaySeconds > 0) fragments.push(`yesterday: ${fmtHrs(status.yesterdaySeconds)}`);
  else if (status.streak === 0) fragments.push("no recent activity logged");
  if (status.overdue.count > 0) {
    const word = status.overdue.count === 1 ? "invoice" : "invoices";
    fragments.push(`${status.overdue.count} overdue ${word} (${fmtUsd(status.overdue.amount)})`);
  }
  if (status.pendingAutomations > 0) {
    fragments.push(`${status.pendingAutomations} automation${status.pendingAutomations === 1 ? "" : "s"} pending`);
  }
  if (fragments.length > 0) lines.push({ kind: "sys", text: fragments.join(" · ") + "." });

  lines.push({ kind: "sys", text: "Standing by. /help for the menu." });

  return lines;
}

// ─── Presentation helpers (phrasing only — no derivation, no ranking) ───────────

/**
 * Present a Decision-ranked item as a readable line: Decision's own explanation (its "because:"
 * prefix trimmed for prose), prefixed with the subject name only when the explanation does not
 * already carry it. Pure string formatting — no ranking, no re-derivation, no new facts.
 */
function phrase(item: PriorityItem): string {
  const reason = item.explanation.replace(/^because:\s*/i, "");
  return reason.includes(item.subject.name) ? reason : `${item.subject.name} — ${reason}`;
}

function timeGreeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Good evening, sir";
  if (h < 12) return "Good morning, sir";
  if (h < 17) return "Good afternoon, sir";
  return "Good evening, sir";
}

function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtHrs(seconds: number): string {
  return (seconds / 3600).toFixed(1) + "h";
}
