// Layer A — Notification lifecycle reconciliation (Part V §V.5) contract tests.
//
// D1 RULING: Notification is treated as a frozen PEER responsibility that was omitted from the
// earlier twelve-engine test list. This is enforcement of an already-frozen responsibility — it is
// NOT a new phase, a new responsibility, or a register change.
//
// Frozen contract: LIFECYCLE logic only (seen / dismissed / resurrected / resolved), never BUSINESS
// logic. No writes, no fs, no events, no fetch, no ranking, no scoring, no signal detection.
// raised/resolved are DERIVED, never persisted. Fingerprints are ENTIRELY PRODUCER-OWNED (D-3.6.4):
// this engine may only COMPARE them for equality. `now` is INJECTED (D-3.6b.1).

import { describe, expect, it } from "vitest";
import { reconcile, type FiringSignal } from "@/engines/notification-engine";
import type { ActionRecord } from "@/core/notifications";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

const firing = (over: Partial<FiringSignal> & Pick<FiringSignal, "signalKey">): FiringSignal => ({
  fingerprint: "fp-1",
  subject: { entity: "client", id: "acme", name: "Acme" },
  kind: "health",
  title: "Acme health is at risk",
  ...over,
});

const action = (over: Partial<ActionRecord> & Pick<ActionRecord, "signalKey" | "action">): ActionRecord => ({
  fingerprint: "fp-1",
  at: "2026-06-10T00:00:00.000Z",
  ...over,
});

const actions = (...records: ActionRecord[]) => new Map(records.map((r) => [r.signalKey, r]));

describe("notification-engine · empty", () => {
  it("returns nothing when no signals are firing", () => {
    expect(reconcile([], new Map(), NOW)).toEqual([]);
  });

  it("returns nothing even when stored actions exist but nothing fires", () => {
    // A stored action with no firing signal is RESOLVED: absent from output, no write.
    const stored = actions(action({ signalKey: "health:client:acme", action: "dismissed" }));
    expect(reconcile([], stored, NOW)).toEqual([]);
  });
});

describe("notification-engine · lifecycle table", () => {
  it("raises a signal with no stored action", () => {
    const out = reconcile([firing({ signalKey: "k1" })], new Map(), NOW);
    expect(out[0].status).toBe("raised");
  });

  it("keeps a dismissed signal dismissed while the fingerprint is unchanged", () => {
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "dismissed" })),
      NOW
    );
    expect(out[0].status).toBe("dismissed");
  });

  it("keeps a viewed signal viewed (seen, still shown and actionable)", () => {
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "viewed" })),
      NOW
    );
    expect(out[0].status).toBe("viewed");
  });

  it("hides a snoozed signal while now < until, and surfaces the expiry", () => {
    const until = "2026-06-20T00:00:00.000Z";
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "snoozed", until })),
      NOW
    );
    expect(out[0].status).toBe("snoozed");
    expect(out[0].snoozeUntil).toBe(until);
  });

  it("re-raises a snoozed signal once the snooze has expired", () => {
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "snoozed", until: "2026-06-01T00:00:00.000Z" })),
      NOW
    );
    expect(out[0].status).toBe("raised");
    // No lingering snoozeUntil once expired.
    expect(out[0].snoozeUntil).toBeUndefined();
  });

  it("treats an unparseable snooze expiry as not snoozed", () => {
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "snoozed", until: "not-a-date" })),
      NOW
    );
    expect(out[0].status).toBe("raised");
  });

  it("treats a snooze with no `until` as not snoozed", () => {
    const out = reconcile(
      [firing({ signalKey: "k1" })],
      actions(action({ signalKey: "k1", action: "snoozed" })),
      NOW
    );
    expect(out[0].status).toBe("raised");
  });
});

describe("notification-engine · D-3.6b.3 fingerprint invalidation", () => {
  it("re-raises when the producer's fingerprint changed, overriding a dismissal", () => {
    const out = reconcile(
      [firing({ signalKey: "k1", fingerprint: "fp-2" })],
      actions(action({ signalKey: "k1", action: "dismissed", fingerprint: "fp-1" })),
      NOW
    );
    expect(out[0].status).toBe("raised");
  });

  it("re-raises when the fingerprint changed, overriding an active snooze", () => {
    const out = reconcile(
      [firing({ signalKey: "k1", fingerprint: "fp-2" })],
      actions(
        action({ signalKey: "k1", action: "snoozed", fingerprint: "fp-1", until: "2026-06-20T00:00:00.000Z" })
      ),
      NOW
    );
    expect(out[0].status).toBe("raised");
    expect(out[0].snoozeUntil).toBeUndefined();
  });
});

describe("notification-engine · D-3.6.4 fingerprints are opaque", () => {
  it("compares fingerprints by exact equality only — no parsing or ordering", () => {
    // Fingerprints that a severity-aware engine might consider "related" must NOT match.
    const cases = [
      ["urgent", "urgent "],
      ["urgent", "URGENT"],
      ["at_risk", "at risk"],
      ["", "0"],
    ];
    for (const [stored, incoming] of cases) {
      const out = reconcile(
        [firing({ signalKey: "k1", fingerprint: incoming })],
        actions(action({ signalKey: "k1", action: "dismissed", fingerprint: stored })),
        NOW
      );
      expect(out[0].status).toBe("raised");
    }
  });

  it("honours a stored action when fingerprints match exactly, including empty string", () => {
    const out = reconcile(
      [firing({ signalKey: "k1", fingerprint: "" })],
      actions(action({ signalKey: "k1", action: "dismissed", fingerprint: "" })),
      NOW
    );
    expect(out[0].status).toBe("dismissed");
  });
});

describe("notification-engine · auto-resolve", () => {
  it("omits signals that are no longer firing, without any write", () => {
    const stored = actions(
      action({ signalKey: "gone", action: "dismissed" }),
      action({ signalKey: "k1", action: "viewed" })
    );
    const out = reconcile([firing({ signalKey: "k1" })], stored, NOW);
    expect(out.map((n) => n.signalKey)).toEqual(["k1"]);
  });
});

describe("notification-engine · producer data preserved", () => {
  it("passes subject, kind, severity, title and fingerprint through unchanged", () => {
    const signal = firing({
      signalKey: "k1",
      severity: "urgent",
      kind: "launch_crunch",
      title: "Crunch",
      fingerprint: "fp-9",
    });
    const out = reconcile([signal], new Map(), NOW);
    expect(out[0]).toMatchObject({
      signalKey: "k1",
      subject: signal.subject,
      kind: "launch_crunch",
      severity: "urgent",
      title: "Crunch",
      fingerprint: "fp-9",
    });
  });

  it("derives no score, priority, or ranking of its own", () => {
    const out = reconcile([firing({ signalKey: "k1", severity: "urgent" })], new Map(), NOW);
    expect(out[0]).not.toHaveProperty("priorityScore");
    expect(out[0]).not.toHaveProperty("score");
    expect(out[0]).not.toHaveProperty("rank");
  });
});

describe("notification-engine · injected clock + purity", () => {
  it("changes snooze status purely as a function of the injected now", () => {
    const stored = actions(
      action({ signalKey: "k1", action: "snoozed", until: "2026-06-20T00:00:00.000Z" })
    );
    const during = reconcile([firing({ signalKey: "k1" })], stored, Date.parse("2026-06-19T00:00:00Z"));
    const after = reconcile([firing({ signalKey: "k1" })], stored, Date.parse("2026-06-21T00:00:00Z"));
    expect(during[0].status).toBe("snoozed");
    expect(after[0].status).toBe("raised");
  });

  it("does not mutate the stored action map", () => {
    const stored = actions(action({ signalKey: "k1", action: "dismissed" }));
    const snapshot = new Map(stored);
    reconcile([firing({ signalKey: "k1" })], stored, NOW);
    expect(stored).toEqual(snapshot);
  });

  it("preserves input order and produces identical output for identical input", () => {
    const signals = [firing({ signalKey: "a" }), firing({ signalKey: "b" })];
    const out = reconcile(signals, new Map(), NOW);
    expect(out.map((n) => n.signalKey)).toEqual(["a", "b"]);
    expect(reconcile(signals, new Map(), NOW)).toEqual(out);
  });
});