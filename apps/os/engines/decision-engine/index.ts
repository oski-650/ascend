// engines/decision-engine — the ranking brain (Part V §V.3). PURE: rank(RankableSignal[]) → PriorityItem[].
//
// Owns the COMPLETE ranking strategy end-to-end — weighting, ordering, and whether/how signals
// collapse per subject are ALL internal implementation details, never part of the contract.
//
// PURITY: no fs, no reads, no writes, no events, no cache/snapshots/memory (rebuildable from inputs).
// Computes NO business facts (no health scoring, opportunity detection, finance/production metrics,
// EHR, invoice/project status). `priorityScore` is a RANKING WEIGHT, not a business metric.
// The source→RankableSignal adapters are the CALLER's (Mission Control), never here.

import type { Severity } from "@/domain";

export type SignalSubject = { entity: "client" | "prospect" | "project" | "invoice"; id: string; name: string };

export type EvidenceRef = { source: string; detail: string; ref?: string };

/**
 * Normalized input — produced by caller-side adapters. Raw attributes are PRESERVED from the
 * producer (no `weightHint` — assigning weight here would be ranking leaking into the surface).
 */
export type RankableSignal = {
  source: string; // producing module, e.g. "health" | "opportunity"
  subject: SignalSubject;
  kind: string;
  severity?: Severity; // preserved (opportunity/signal producers)
  score?: number; // preserved (health etc.)
  tier?: string; // preserved (health tier)
  evidence: EvidenceRef;
  actionRef?: { source: string; ref: string };
};

export type PriorityItem = {
  rank: number;
  subject: SignalSubject;
  priorityScore: number; // ranking weight 0–100 — NOT a business metric
  explanation: string;
  evidence: EvidenceRef[];
  recommendedActionRef?: { source: string; ref: string };
};

// ─── Ranking strategy — entirely internal to Decision (implementation detail) ──

function weightOf(s: RankableSignal): number {
  if (s.source === "opportunity") {
    return s.severity === "urgent" ? 90 : s.severity === "suggest" ? 60 : 30;
  }
  if (s.source === "health") {
    return s.tier === "at_risk" ? 85 : s.tier === "on_track" ? 45 : 15;
  }
  return 20; // default for future sources
}

export function rank(signals: RankableSignal[]): PriorityItem[] {
  // Collapse per subject — Decision's private choice, NOT part of the contract.
  const groups = new Map<string, { subject: SignalSubject; weighted: { s: RankableSignal; w: number }[] }>();
  for (const s of signals) {
    const key = `${s.subject.entity}:${s.subject.id}`;
    const g = groups.get(key) ?? { subject: s.subject, weighted: [] };
    g.weighted.push({ s, w: weightOf(s) });
    groups.set(key, g);
  }

  const items = [...groups.values()].map((g) => {
    const sorted = [...g.weighted].sort((a, b) => b.w - a.w);
    const top = sorted[0].s;
    return {
      subject: g.subject,
      priorityScore: sorted[0].w,
      explanation: `because: ${sorted.map((x) => x.s.evidence.detail).join(" · ")}`,
      evidence: sorted.map((x) => x.s.evidence),
      recommendedActionRef: top.actionRef,
    };
  });

  items.sort((a, b) => b.priorityScore - a.priorityScore || a.subject.name.localeCompare(b.subject.name));
  return items.map((it, i) => ({ rank: i + 1, ...it }));
}
