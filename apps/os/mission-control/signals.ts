// mission-control/signals.ts — the SHARED firing-signal producer (MC-4).
//
// Assembles EXISTING Health read-models + Opportunity signals into RankableSignal[] EXACTLY ONCE,
// via the frozen caller-owned adapters. This single output is distributed to multiple consumers —
// Decision (to rank) and Notification (to reconcile lifecycle) — with no recomputation and no
// dependency between those consumers. It detects nothing and ranks nothing (MC-1); it only assembles.

import "server-only";
import { listProductionStates, secondsInWindow } from "@/core/production";
import { computeHealthScore } from "@/engines/health-engine";
import { detectOpportunities } from "@/lib/opportunities";
import type { RankableSignal, SignalSubject } from "@/engines/decision-engine";
import { healthToSignals, opportunityToSignals } from "./adapters";

/**
 * The two channels a firing signal can belong to.
 *
 * `indeterminate` exists because a health score can now be null, and a null score is not rankable.
 * It is NOT dropped: "health cannot be determined" is actionable — it tells the operator what to
 * investigate — so it keeps the full notification lifecycle (view / snooze / dismiss) while never
 * entering `rank()`. This preserves Decision's invariant rather than teaching it a special case.
 */
export type FiringSignals = {
  /** Carries a producer-supplied score/severity. Safe to rank. */
  rankable: RankableSignal[];
  /** Visible and actionable, but carries no score. Never ranked. */
  indeterminate: RankableSignal[];
};

/** Assemble the firing signals once (Health risks + Opportunities), for shared distribution. */
export async function assembleFiringSignals(): Promise<FiringSignals> {
  const [states, opportunities] = await Promise.all([listProductionStates(), detectOpportunities()]);

  const healthItems = await Promise.all(
    states
      // Genuinely launched projects raise no health signal. Previously this gated on
      // `activePhaseIndex !== null`, which now reads null for INDETERMINATE projects too — so the
      // clients whose health is unknowable would have been silently excluded, which is the exact
      // failure H2 §11.3 forbids. `phaseState` is the authoritative distinction (H4 §2.3).
      .filter((s) => s.phaseState !== "launched")
      .map(async (s) => {
        const hours = (await secondsInWindow(7, s.clientSlug)) / 3600;
        // V1 1:1 client:project — normalize health to the client identity (unchanged from Phase 3.1).
        const subject: SignalSubject = { entity: "client", id: s.clientSlug, name: s.clientName };
        return { subject, health: computeHealthScore(s, hours) };
      })
  );

  // Routing keys on PRESENCE (`tier === null`), never on a tier's meaning — routing on `at_risk`
  // would be interpretation, which MC-1 reserves for the engines.
  const determinate = healthItems.filter((h) => h.health.tier !== null);
  const indeterminate = healthItems.filter((h) => h.health.tier === null);

  return {
    rankable: [...healthToSignals(determinate), ...opportunityToSignals(opportunities)],
    indeterminate: healthToSignals(indeterminate),
  };
}
