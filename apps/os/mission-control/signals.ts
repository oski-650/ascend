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

/** Assemble the firing signals once (Health risks + Opportunities), for shared distribution. */
export async function assembleFiringSignals(): Promise<RankableSignal[]> {
  const [states, opportunities] = await Promise.all([listProductionStates(), detectOpportunities()]);

  const healthItems = await Promise.all(
    states
      .filter((s) => s.activePhaseIndex !== null)
      .map(async (s) => {
        const hours = (await secondsInWindow(7, s.clientSlug)) / 3600;
        // V1 1:1 client:project — normalize health to the client identity (unchanged from Phase 3.1).
        const subject: SignalSubject = { entity: "client", id: s.clientSlug, name: s.clientName };
        return { subject, health: computeHealthScore(s, hours) };
      })
  );

  return [...healthToSignals(healthItems), ...opportunityToSignals(opportunities)];
}
