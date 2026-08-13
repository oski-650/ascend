// Layer A — Insight / Business Intelligence (Phase 6) contract tests.
//
// Frozen contract: answers "WHAT CHANGED?" over time — never "what is the current state?" (Health),
// "what signal exists?" (Opportunity), or "what should we do?" (Decision). Produces FACTUAL,
// rule-derived observations only: NO priority score, NO recommendation, NO "you should…" language.
// `now` is INJECTED. Templated, authored rules only — no ML, no statistical discovery.

import { describe, expect, it } from "vitest";
import { deriveInsights, type IntelligenceInput } from "@/engines/intelligence-engine";
import { ORGANIZATION_ID, newEventId, newInvoiceId, type EventEnvelope, type Invoice } from "@/domain";

const NOW = new Date("2026-06-15T12:00:00.000Z");

// Fixtures are built from the real domain types with NO casts: `id` uses the domain's own
// branded-id constructor. Nothing here asserts on invoice ids, so a minted id is sufficient.
const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: newInvoiceId(),
  client: "acme",
  amount_usd: 1000,
  label: "Build",
  issued_at: "2026-05-01T00:00:00.000Z",
  due_at: "2026-06-01T00:00:00.000Z",
  paid_at: null,
  note: "",
  ...over,
});

// Built from real domain constructors and the real ORGANIZATION_ID constant — no casts.
const event = (occurred_at: string): EventEnvelope => ({
  event_id: newEventId(),
  type: "time.logged",
  occurred_at,
  actor: "operator",
  subject: { entity: "time_entry", entity_id: "t1" },
  organization_id: ORGANIZATION_ID,
});

const input = (over: Partial<IntelligenceInput> = {}): IntelligenceInput => ({
  events: [],
  invoices: [],
  ...over,
});

describe("insight · rule set + ordering", () => {
  it("derives exactly the three approved V1 rules", () => {
    const insights = deriveInsights(input(), NOW);
    expect(insights.map((i) => i.rule).sort()).toEqual([
      "activity.week_over_week",
      "collections.last_30d",
      "collections.month_over_month",
    ]);
  });

  it("orders stably by rule then id", () => {
    const insights = deriveInsights(input(), NOW);
    const rules = insights.map((i) => i.rule);
    expect(rules).toEqual([...rules].sort());
  });
});

describe("insight · honest empty states", () => {
  it("states plainly that nothing was collected rather than fabricating a figure", () => {
    const insights = deriveInsights(input(), NOW);
    const mom = insights.find((i) => i.rule === "collections.month_over_month");
    expect(mom?.statement).toBe("No collections recorded this month or last.");
    // No direction is asserted when there is nothing to compare.
    expect(mom?.direction).toBeUndefined();
  });

  it("reports zero collections in the last 30 days explicitly", () => {
    const last30 = deriveInsights(input(), NOW).find((i) => i.rule === "collections.last_30d");
    expect(last30?.statement).toBe("No invoices collected in the last 30 days.");
  });

  it("reports no activity across both weeks explicitly", () => {
    const act = deriveInsights(input(), NOW).find((i) => i.rule === "activity.week_over_week");
    expect(act?.statement).toBe("No recorded activity in the last two weeks.");
    expect(act?.direction).toBeUndefined();
  });
});

describe("insight · small-N honesty (no fabricated percentages)", () => {
  it("does NOT emit a percentage when there is no prior month to compare against", () => {
    const insights = deriveInsights(
      input({ invoices: [invoice({ paid_at: "2026-06-05T00:00:00.000Z" })] }),
      NOW
    );
    const mom = insights.find((i) => i.rule === "collections.month_over_month");
    expect(mom?.statement).toContain("no collections last month to compare");
    expect(mom?.statement).not.toMatch(/%/);
  });

  it("emits a percentage only when both months have data", () => {
    const insights = deriveInsights(
      input({
        invoices: [
          invoice({ amount_usd: 1000, paid_at: "2026-05-10T00:00:00.000Z" }),
          invoice({ amount_usd: 2000, paid_at: "2026-06-10T00:00:00.000Z" }),
        ],
      }),
      NOW
    );
    const mom = insights.find((i) => i.rule === "collections.month_over_month");
    expect(mom?.direction).toBe("up");
    expect(mom?.statement).toMatch(/100%/);
  });
});

describe("insight · toggle-safe derivation from records", () => {
  it("counts a paid invoice once regardless of how often it was toggled", () => {
    // Derived from the invoice record's FINAL paid_at, not from a stream of paid events,
    // so a paid→unpaid→paid history can never double-count.
    const once = deriveInsights(
      input({ invoices: [invoice({ amount_usd: 500, paid_at: "2026-06-05T00:00:00.000Z" })] }),
      NOW
    );
    const statement = once.find((i) => i.rule === "collections.last_30d")?.statement;
    expect(statement).toContain("1 invoice");
    expect(statement).toContain("$500");
  });

  it("ignores an unpaid invoice entirely", () => {
    const insights = deriveInsights(input({ invoices: [invoice({ paid_at: null })] }), NOW);
    expect(insights.find((i) => i.rule === "collections.last_30d")?.statement).toBe(
      "No invoices collected in the last 30 days."
    );
  });
});

describe("insight · malformed timestamps degrade safely", () => {
  it("skips an invoice with an unparseable paid_at instead of producing NaN", () => {
    const insights = deriveInsights(
      input({ invoices: [invoice({ paid_at: "not-a-date" })] }),
      NOW
    );
    const statement = insights.find((i) => i.rule === "collections.last_30d")?.statement ?? "";
    expect(statement).not.toContain("NaN");
    expect(statement).toBe("No invoices collected in the last 30 days.");
  });

  it("skips an event with an unparseable occurred_at", () => {
    const insights = deriveInsights(input({ events: [event("not-a-date")] }), NOW);
    const statement = insights.find((i) => i.rule === "activity.week_over_week")?.statement ?? "";
    expect(statement).not.toContain("NaN");
  });
});

describe("insight · injected clock determinism", () => {
  it("windows activity purely from the injected now", () => {
    const insights = deriveInsights(
      input({
        events: [
          event("2026-06-14T00:00:00.000Z"), // within last 7d of NOW
          event("2026-06-05T00:00:00.000Z"), // within the prior 7d
        ],
      }),
      NOW
    );
    const act = insights.find((i) => i.rule === "activity.week_over_week");
    expect(act?.statement).toContain("1 event in the last 7 days");
    expect(act?.statement).toContain("vs 1 the prior week");
  });

  it("stamps computedAt from the injected now, not the system clock", () => {
    for (const insight of deriveInsights(input(), NOW)) {
      expect(insight.computedAt).toBe(NOW.toISOString());
    }
  });

  it("produces identical output for identical (input, now)", () => {
    const i = input({ invoices: [invoice({ paid_at: "2026-06-05T00:00:00.000Z" })] });
    expect(deriveInsights(i, NOW)).toEqual(deriveInsights(i, NOW));
  });
});

describe("insight · ownership boundary (BI, not Decision)", () => {
  it("carries no score, priority, or recommended action on any insight", () => {
    const insights = deriveInsights(input(), NOW);
    for (const insight of insights) {
      expect(insight).not.toHaveProperty("priorityScore");
      expect(insight).not.toHaveProperty("score");
      expect(insight).not.toHaveProperty("action");
      expect(insight).not.toHaveProperty("recommendation");
    }
  });

  it("uses no prescriptive language in any statement", () => {
    const insights = deriveInsights(
      input({
        invoices: [invoice({ paid_at: "2026-06-05T00:00:00.000Z" })],
        events: [event("2026-06-14T00:00:00.000Z")],
      }),
      NOW
    );
    for (const insight of insights) {
      expect(insight.statement.toLowerCase()).not.toMatch(/\byou should\b|\bmust\b|\brecommend/);
    }
  });
});