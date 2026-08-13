// engines/intelligence-engine — PURE historical-insight derivation (Phase 6, Business Intelligence).
//
// Answers "WHAT CHANGED?" over time — never "what is the current state?" (Health), "what signal exists?"
// (Opportunity), or "what should we prioritize/do?" (Decision). It produces FACTUAL, rule-derived
// observations only: NO priority score, NO recommendation, NO "you should…" language. A pure derivation
// engine (Part V): zero writes, zero events. It imports ONLY domain types — no fs, no core, no other
// engine, no surface. Deterministic: `now` is INJECTED (no clock, no randomness); same (input, now) ⇒
// identical Insight[]. Templated, authored rules only — no ML, no statistical discovery, no inference.

import type { EventEnvelope, Invoice } from "@/domain";

export type InsightWindow = { since: string; until: string } | "all-time";
export type InsightDirection = "up" | "down" | "flat";

/** A true, non-obvious historical fact. Carries NO score, NO ranking, NO recommended action (KI-3 / BI boundary). */
export type Insight = {
  id: string;
  rule: string;
  statement: string;
  window: InsightWindow;
  direction?: InsightDirection;
  evidence: string[];
  computedAt: string;
};

/** Inputs are GATHERED by the caller (Mission Control) and passed in — the engine reads no core, no fs. */
export type IntelligenceInput = {
  events: readonly EventEnvelope[];
  invoices: readonly Invoice[];
};

const DAY_MS = 86_400_000;

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function directionOf(cur: number, prev: number): InsightDirection {
  return cur > prev ? "up" : cur < prev ? "down" : "flat";
}

/**
 * Rule: collections month-over-month. Toggle-safe — derived from the invoice records' FINAL `paid_at`
 * (not raw paid-events), so a paid→unpaid→paid history never double-counts. Small-N honest: no prior
 * month ⇒ no fabricated percentage.
 */
function collectionsMonthOverMonth(invoices: readonly Invoice[], now: Date): Insight {
  const thisM = monthKey(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevM = monthKey(prevDate);
  let cur = 0;
  let prior = 0;
  for (const inv of invoices) {
    if (!inv.paid_at) continue;
    const mk = monthKey(new Date(inv.paid_at));
    if (mk === thisM) cur += inv.amount_usd;
    else if (mk === prevM) prior += inv.amount_usd;
  }
  const window: InsightWindow = { since: new Date(prevDate.getFullYear(), prevDate.getMonth(), 1).toISOString(), until: now.toISOString() };

  let statement: string;
  let direction: InsightDirection | undefined;
  if (cur === 0 && prior === 0) {
    statement = "No collections recorded this month or last.";
  } else if (prior === 0) {
    statement = `Collections ${usd(cur)} this month (no collections last month to compare).`;
    direction = "up";
  } else {
    direction = directionOf(cur, prior);
    const pct = Math.abs(Math.round(((cur - prior) / prior) * 100));
    const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "▬";
    statement = `Collections ${usd(cur)} this month vs ${usd(prior)} last month (${arrow} ${pct}%).`;
  }
  return { id: `collections.month_over_month:${thisM}`, rule: "collections.month_over_month", statement, window, direction, evidence: ["invoices.paid_at"], computedAt: now.toISOString() };
}

/** Rule: invoices collected in the last 30 days (records; toggle-safe). Small-N honest: zero ⇒ says so. */
function collectionsLast30d(invoices: readonly Invoice[], now: Date): Insight {
  const start = new Date(now.getTime() - 30 * DAY_MS);
  let count = 0;
  let total = 0;
  for (const inv of invoices) {
    if (!inv.paid_at) continue;
    const t = Date.parse(inv.paid_at);
    if (Number.isNaN(t)) continue;
    if (t >= start.getTime() && t <= now.getTime()) {
      count += 1;
      total += inv.amount_usd;
    }
  }
  const window: InsightWindow = { since: start.toISOString(), until: now.toISOString() };
  const statement =
    count === 0
      ? "No invoices collected in the last 30 days."
      : `${count} invoice${count === 1 ? "" : "s"} collected in the last 30 days totaling ${usd(total)}.`;
  return { id: "collections.last_30d", rule: "collections.last_30d", statement, window, evidence: ["invoices.paid_at"], computedAt: now.toISOString() };
}

/** Rule: activity volume, last 7 days vs the prior 7 (from the event spine). Small-N honest: no activity ⇒ says so. */
function activityWeekOverWeek(events: readonly EventEnvelope[], now: Date): Insight {
  const last7Start = now.getTime() - 7 * DAY_MS;
  const prior7Start = now.getTime() - 14 * DAY_MS;
  let last = 0;
  let prior = 0;
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (Number.isNaN(t)) continue;
    if (t >= last7Start && t <= now.getTime()) last += 1;
    else if (t >= prior7Start && t < last7Start) prior += 1;
  }
  const window: InsightWindow = { since: new Date(prior7Start).toISOString(), until: now.toISOString() };
  let statement: string;
  let direction: InsightDirection | undefined;
  if (last === 0 && prior === 0) {
    statement = "No recorded activity in the last two weeks.";
  } else {
    direction = directionOf(last, prior);
    statement = `${last} event${last === 1 ? "" : "s"} in the last 7 days (vs ${prior} the prior week).`;
  }
  return { id: "activity.week_over_week", rule: "activity.week_over_week", statement, window, direction, evidence: ["core/events"], computedAt: now.toISOString() };
}

/**
 * Derive the V1 Insight set — pure and deterministic given (input, now). The 2–3 approved templated
 * historical rules only. Stable order by rule then id.
 */
export function deriveInsights(input: IntelligenceInput, now: Date): Insight[] {
  const insights: Insight[] = [
    collectionsMonthOverMonth(input.invoices, now),
    collectionsLast30d(input.invoices, now),
    activityWeekOverWeek(input.events, now),
  ];
  insights.sort((a, b) => a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
  return insights;
}
