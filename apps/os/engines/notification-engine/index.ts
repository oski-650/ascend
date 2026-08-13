// engines/notification-engine — PURE lifecycle reconciliation (Part V §V.5).
//
// reconcile(firingSignals, actionState) → Notification[]. It has NO writes, NO fs, NO event
// emission, NO fetch, NO ranking, NO scoring, and NO signal detection. It contains LIFECYCLE logic
// only (seen / dismissed / resurrected / resolved) — never BUSINESS logic (health, opportunity,
// ranking live elsewhere). raised/resolved are DERIVED here, never persisted.
//
// Fingerprints are ENTIRELY PRODUCER-OWNED (D-3.6.4): this engine may only COMPARE them for
// equality; it never parses, orders, or reinterprets them.

import type { ActionRecord } from "@/core/notifications";

/** A currently-firing signal, normalized by the caller (Mission Control) — never fetched here. */
export type FiringSignal = {
  signalKey: string;
  fingerprint: string; // producer-owned; compared opaquely
  subject: { entity: string; id: string; name: string };
  kind: string;
  severity?: string;
  title: string;
};

export type NotificationStatus = "raised" | "viewed" | "snoozed" | "dismissed";

export type Notification = {
  signalKey: string;
  subject: { entity: string; id: string; name: string };
  kind: string;
  severity?: string;
  title: string;
  fingerprint: string;
  status: NotificationStatus;
  snoozeUntil?: string; // present when status === "snoozed"
};

/**
 * Reconcile currently-firing signals against stored operator actions, at an INJECTED time `now`
 * (epoch ms — D-3.6b.1: the engine never reads Date.now()/system time, so it stays deterministic
 * and replayable):
 *   • no action                        → raised
 *   • fingerprint CHANGED (any action) → raised   (producer invalidated prior operator state — D-3.6b.3)
 *   • dismissed, same fp               → dismissed
 *   • viewed,    same fp               → viewed    (seen, still shown & actionable)
 *   • snoozed,   same fp, now < until  → snoozed   (hidden)
 *   • snoozed,   same fp, now >= until → raised    (expired — read-time only, no event emitted)
 *   • stored action, NOT firing        → resolved: absent from the output (auto-resolve, no write)
 *
 * Pure: (firing, actions, now) → view. It only COMPARES fingerprints for equality; the producer owns
 * their meaning (no severity/tier interpretation here). Persists nothing; fully rebuildable.
 */
export function reconcile(firing: FiringSignal[], actions: Map<string, ActionRecord>, now: number): Notification[] {
  return firing.map((s) => {
    const a = actions.get(s.signalKey);
    let status: NotificationStatus = "raised";
    let snoozeUntil: string | undefined;
    // Operator state applies ONLY while the producer-owned fingerprint is unchanged (equality only).
    if (a && a.fingerprint === s.fingerprint) {
      if (a.action === "dismissed") status = "dismissed";
      else if (a.action === "viewed") status = "viewed";
      else if (a.action === "snoozed") {
        const until = a.until ? Date.parse(a.until) : NaN; // Date.parse is a pure string parser, not a clock
        if (Number.isFinite(until) && now < until) {
          status = "snoozed";
          snoozeUntil = a.until;
        } // else: snooze expired → stays "raised"
      }
    }
    return {
      signalKey: s.signalKey,
      subject: s.subject,
      kind: s.kind,
      severity: s.severity,
      title: s.title,
      fingerprint: s.fingerprint,
      status,
      ...(snoozeUntil ? { snoozeUntil } : {}),
    };
  });
}
