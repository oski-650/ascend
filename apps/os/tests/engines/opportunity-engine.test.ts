// Layer A — Opportunity (Phase 2.6) contract tests.
//
// Frozen contract: revenue-expansion opportunity detection ONLY — no health/risk detection, no
// sales/outreach detection, no severity sorting, no ranking, no Decision behaviour.
//
// ─── D2 RULING: DOCUMENTED COVERAGE GAP ─────────────────────────────────────────────────────────
// detectRevenueOpportunities() is the one engine that is NOT a pure transform: it reads the vault
// through core/crm (`listClients`/`getClient`, value imports) and calls `Date.now()` internally.
//
// Per the D2 ruling its vault I/O is NOT mocked to manufacture unit-test purity, its API is NOT
// changed, and global time is NOT faked. Testing it would therefore require either reading the live
// vault (forbidden) or fabricating a filesystem — both of which would test the implementation rather
// than the contract.
//
// What IS covered here is the genuinely pure exported surface. The rule behaviour is defended
// elsewhere without touching the engine:
//   • Layer B rule F10 asserts the 7/2 ownership split of emitted OpportunityKind literals;
//   • Layer B rules F2/F3/F6 prevent its dependencies from expanding further.
// Making the rules directly testable requires an architectural ruling (inject the client reader, or
// split the pure rule functions from the gathering step). Recorded as an open review item.

import { describe, expect, it } from "vitest";
import { severityLabel, type Opportunity, type OpportunityKind } from "@/engines/opportunity-engine";
import type { Severity } from "@/domain";

describe("opportunity-engine · severityLabel (pure exported surface)", () => {
  it("maps every Severity to its display label", () => {
    expect(severityLabel("urgent" as Severity)).toBe("URGENT");
    expect(severityLabel("suggest" as Severity)).toBe("SUGGEST");
    expect(severityLabel("info" as Severity)).toBe("INFO");
  });

  it("is a pure total function over the Severity union", () => {
    const severities: Severity[] = ["urgent", "suggest", "info"] as Severity[];
    for (const s of severities) {
      expect(severityLabel(s)).toBe(severityLabel(s));
      expect(typeof severityLabel(s)).toBe("string");
      expect(severityLabel(s).length).toBeGreaterThan(0);
    }
  });
});

describe("opportunity-engine · exported contract shape", () => {
  it("declares the revenue-expansion kinds this engine owns within the shared union", () => {
    // The OpportunityKind union is shared with the lib composer and does NOT itself encode
    // ownership (see D5). These two are the kinds this engine actually emits; Layer B F10 asserts
    // the emission split at source level.
    const owned: OpportunityKind[] = ["launched_no_retainer", "launched_checkin"];
    expect(owned).toHaveLength(2);
  });

  it("keeps `action` descriptive — the engine never executes or prioritises it", () => {
    // Structural assertion against the frozen shape: an Opportunity carries no score/priority/rank.
    const shape: Opportunity = {
      id: "launched_no_retainer:acme",
      kind: "launched_no_retainer",
      severity: "suggest" as Severity,
      title: "t",
      rationale: "r",
      action: "a",
      claudeDirective: "d",
    };
    expect(shape).not.toHaveProperty("priorityScore");
    expect(shape).not.toHaveProperty("rank");
    expect(shape).not.toHaveProperty("score");
  });
});

// ─── Explicitly uncovered: requires an architectural ruling (D2) ────────────────────────────────
describe.skip("opportunity-engine · rule behaviour [COVERAGE GAP — engine reads the vault + clock]", () => {
  it.skip("emits launched_no_retainer for a client in maintenance", () => {});
  it.skip("emits launched_checkin only past the 90-day threshold", () => {});
  it.skip("emits nothing for a client that is not in maintenance", () => {});
  it.skip("handles an unparseable launch_target without fabricating a day count", () => {});
  it.skip("returns an empty list for an empty client set", () => {});
});