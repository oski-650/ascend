// mission-control/adapters.ts — CALLER-OWNED pure shape transforms (MC-1 hard constraint).
//
// Convert EXISTING read-models / signals → RankableSignal. They MAY: map fields, normalize ids,
// attach evidence references, and PRESERVE the producer's severity/score/tier. They MAY NOT:
// assign ranking weights, boost/penalize, detect NEW signals, infer urgency, or compute metrics.
// No `weightHint`. All weighting/ordering belongs to Decision.rank().

import type { HealthScore } from "@/engines/health-engine";
import type { Opportunity } from "@/lib/opportunities";
import type { RankableSignal, SignalSubject } from "@/engines/decision-engine";

/** Transform existing HealthScore read-models → RankableSignal (score/tier preserved). */
export function healthToSignals(items: { subject: SignalSubject; health: HealthScore }[]): RankableSignal[] {
  return items.map(({ subject, health }) => ({
    source: "health",
    subject,
    kind: "health",
    score: health.score, // preserved
    tier: health.tier, // preserved
    evidence: { source: "health", detail: `health ${health.score} (${health.tier.replace("_", " ")})` },
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
