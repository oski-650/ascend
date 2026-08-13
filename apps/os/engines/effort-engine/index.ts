// engines/effort-engine — PURE read-only Effort Distribution (Phase 10).
//
// Answers "where does my delivery time go?" — aggregates logged time by phase and by client. It reports
// ALLOCATION FACTS ONLY (hours + share); it NEVER judges profitability (EHR is computeEhr's authority —
// untouched), never recommends, never ranks priority. Pure and self-contained: no imports, no fs, no
// core/lib, no writes/events, no clock, no randomness → deterministic. Totals only (EF-4: no windows /
// trends / streaks). `duration_seconds: null` contributes 0 (EF-5); unknown/loose phase strings are
// preserved literally (never dropped, never fabricated).

export type PhaseEffort = { phase: string; seconds: number; hours: number; share: number };
export type ClientEffort = {
  clientSlug: string;
  totalSeconds: number;
  hours: number;
  share: number;
  byPhase: PhaseEffort[];
};
export type EffortDigest = { byPhase: PhaseEffort[]; byClient: ClientEffort[]; totalSeconds: number };

/** Minimal structural input — satisfied by domain TimeEntry (phase: TimeActivity ⊆ string). No coupling. */
export type EffortEntryInput = { client: string; phase: string; duration_seconds: number | null };

function hoursOf(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}
function shareOf(seconds: number, total: number): number {
  return total > 0 ? Math.round((seconds / total) * 100) : 0;
}

/** Bucket → PhaseEffort[], ordered by seconds desc, tie-broken by phase asc (EF-6 presentation ordering). */
function toPhaseEfforts(bucket: Map<string, number>, total: number): PhaseEffort[] {
  const out: PhaseEffort[] = [];
  for (const [phase, seconds] of bucket) out.push({ phase, seconds, hours: hoursOf(seconds), share: shareOf(seconds, total) });
  out.sort((a, b) => b.seconds - a.seconds || a.phase.localeCompare(b.phase));
  return out;
}

/**
 * Aggregate effort by phase and by client — pure and deterministic given `entries`. Clock-free totals.
 * Empty input ⇒ empty digest with zero total (honest).
 */
export function buildEffortDigest(entries: readonly EffortEntryInput[]): EffortDigest {
  const phaseTotals = new Map<string, number>();
  const clientTotals = new Map<string, number>();
  const clientPhase = new Map<string, Map<string, number>>();
  let totalSeconds = 0;

  for (const e of entries) {
    const secs = e.duration_seconds ?? 0; // EF-5: active/null → 0, never fabricated
    totalSeconds += secs;
    phaseTotals.set(e.phase, (phaseTotals.get(e.phase) ?? 0) + secs);
    clientTotals.set(e.client, (clientTotals.get(e.client) ?? 0) + secs);
    let cp = clientPhase.get(e.client);
    if (!cp) {
      cp = new Map();
      clientPhase.set(e.client, cp);
    }
    cp.set(e.phase, (cp.get(e.phase) ?? 0) + secs);
  }

  const byPhase = toPhaseEfforts(phaseTotals, totalSeconds);

  const byClient: ClientEffort[] = [];
  for (const [clientSlug, secs] of clientTotals) {
    byClient.push({
      clientSlug,
      totalSeconds: secs,
      hours: hoursOf(secs),
      share: shareOf(secs, totalSeconds),
      byPhase: toPhaseEfforts(clientPhase.get(clientSlug) ?? new Map(), secs),
    });
  }
  byClient.sort((a, b) => b.totalSeconds - a.totalSeconds || a.clientSlug.localeCompare(b.clientSlug));

  return { byPhase, byClient, totalSeconds };
}
