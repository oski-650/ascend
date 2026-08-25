// mission-control/adapters.ts — CALLER-OWNED pure shape transforms (MC-1 hard constraint).
//
// Convert EXISTING read-models / signals → RankableSignal. They MAY: map fields, normalize ids,
// attach evidence references, and PRESERVE the producer's severity/score/tier. They MAY NOT:
// assign ranking weights, boost/penalize, detect NEW signals, infer urgency, or compute metrics.
// No `weightHint`. All weighting/ordering belongs to Decision.rank().

import type { HealthScore } from "@/engines/health-engine";
import type { Opportunity } from "@/lib/opportunities";
import type { RankableSignal, SignalSubject } from "@/engines/decision-engine";

/**
 * Transform existing HealthScore read-models → RankableSignal (score/tier preserved).
 *
 * A null score/tier is OMITTED rather than filled. There is no legal value to substitute: MC-1
 * forbids adapters computing metrics, and any placeholder would be read by Decision's weighting
 * ternary as a real tier. `weightOf` falls through to 15 for an unrecognised tier — the same weight
 * as `healthy` — so a laundered null would rank "cannot be determined" as "this client is fine"
 * without erroring. Routing to the unranked channel is the caller's job (./signals).
 */
export function healthToSignals(items: { subject: SignalSubject; health: HealthScore }[]): RankableSignal[] {
  return items.map(({ subject, health }) => ({
    source: "health",
    subject,
    kind: "health",
    ...(health.score !== null ? { score: health.score } : {}), // preserved
    ...(health.tier !== null ? { tier: health.tier } : {}), // preserved
    evidence: {
      source: "health",
      detail:
        health.tier === null
          ? "health cannot be determined — phase history unknown"
          : `health ${health.score} (${health.tier.replace("_", " ")})`,
    },
  }));
}

/** Transform existing Opportunity signals → RankableSignal (severity + action preserved). */
export function opportunityToSignals(opps: Opportunity[]): RankableSignal[] {
  return opps.map((o) => {
    const subject: SignalSubject = o.target
      ? { entity: o.target.kind, id: o.target.slug, name: o.target.name }
      : { entity: "client", id: o.id, name: o.title };
    return {
      source: "opportunity",
      subject,
      kind: o.kind,
      severity: o.severity, // preserved
      evidence: { source: "opportunity", detail: o.title, ref: o.id },
      actionRef: { source: "opportunity", ref: o.id },
    };
  });
}
