// Layer A — Effort Distribution (Phase 10) contract tests.
//
// Frozen contract: allocation FACTS ONLY (hours + share) by phase and by client. Never judges
// profitability (EHR stays computeEhr's authority), never recommends, never ranks. Pure, clock-free,
// totals only. `duration_seconds: null` contributes 0 (EF-5). Unknown phase strings preserved.

import { describe, expect, it } from "vitest";
import { buildEffortDigest, type EffortEntryInput } from "@/engines/effort-engine";
import { PHASE_KEYS } from "@/domain";

/** Structural fixtures — the engine's declared input type, not a re-declared vocabulary. */
const entry = (client: string, phase: string, duration_seconds: number | null): EffortEntryInput => ({
  client,
  phase,
  duration_seconds,
});

describe("effort-engine · empty + honest states", () => {
  it("returns an honest empty digest for no entries — no fabricated buckets", () => {
    const digest = buildEffortDigest([]);
    expect(digest).toEqual({ byPhase: [], byClient: [], totalSeconds: 0 });
  });

  it("does not divide by zero when every entry has null duration", () => {
    const digest = buildEffortDigest([entry("acme", "dev", null), entry("acme", "design", null)]);
    expect(digest.totalSeconds).toBe(0);
    // share must be 0, never NaN — a NaN would render as "NaN%" on the dashboard.
    for (const p of digest.byPhase) expect(p.share).toBe(0);
    for (const c of digest.byClient) expect(c.share).toBe(0);
  });
});

describe("effort-engine · EF-5 null durations", () => {
  it("counts a null-duration entry as 0 seconds WITHOUT dropping its client or phase", () => {
    // An active (running) timer has duration_seconds: null. It must still appear structurally.
    const digest = buildEffortDigest([entry("acme", "dev", 3600), entry("acme", "launch", null)]);
    expect(digest.totalSeconds).toBe(3600);
    expect(digest.byPhase.map((p) => p.phase).sort()).toEqual(["dev", "launch"]);
    expect(digest.byPhase.find((p) => p.phase === "launch")?.seconds).toBe(0);
  });
});

describe("effort-engine · unknown value preservation", () => {
  it("preserves an unrecognised phase string literally rather than coercing it", () => {
    const rogue = "Some Loose Phase";
    expect(PHASE_KEYS as readonly string[]).not.toContain(rogue);
    const digest = buildEffortDigest([entry("acme", rogue, 1800)]);
    expect(digest.byPhase.map((p) => p.phase)).toContain(rogue);
  });
});

describe("effort-engine · EF-6 ordering guarantees", () => {
  it("orders phases by seconds desc", () => {
    const digest = buildEffortDigest([
      entry("acme", "design", 100),
      entry("acme", "dev", 900),
      entry("acme", "launch", 500),
    ]);
    expect(digest.byPhase.map((p) => p.phase)).toEqual(["dev", "launch", "design"]);
  });

  it("breaks an exact seconds tie by phase name ascending", () => {
    const digest = buildEffortDigest([entry("acme", "zeta", 600), entry("acme", "alpha", 600)]);
    expect(digest.byPhase.map((p) => p.phase)).toEqual(["alpha", "zeta"]);
  });

  it("orders clients by total seconds desc, tie-broken by slug ascending", () => {
    const digest = buildEffortDigest([
      entry("zzz-co", "dev", 600),
      entry("aaa-co", "dev", 600),
      entry("mid-co", "dev", 1200),
    ]);
    expect(digest.byClient.map((c) => c.clientSlug)).toEqual(["mid-co", "aaa-co", "zzz-co"]);
  });
});

describe("effort-engine · aggregation correctness", () => {
  it("aggregates per client and per phase consistently", () => {
    const digest = buildEffortDigest([
      entry("acme", "dev", 3600),
      entry("acme", "dev", 1800),
      entry("acme", "design", 1800),
      entry("other", "dev", 3600),
    ]);
    expect(digest.totalSeconds).toBe(10800);

    const acme = digest.byClient.find((c) => c.clientSlug === "acme");
    expect(acme?.totalSeconds).toBe(7200);
    expect(acme?.hours).toBe(2);
    // Per-client phase shares are relative to that client's own total, not the global total.
    expect(acme?.byPhase.find((p) => p.phase === "dev")?.share).toBe(75);
    // Client totals must reconcile with the global total.
    expect(digest.byClient.reduce((s, c) => s + c.totalSeconds, 0)).toBe(digest.totalSeconds);
  });
});

describe("effort-engine · ownership boundary", () => {
  it("reports no profitability/revenue field — EHR remains computeEhr's authority", () => {
    const digest = buildEffortDigest([entry("acme", "dev", 3600)]);
    const serialized = JSON.stringify(digest);
    for (const forbidden of ["ehr", "revenue", "usd", "profit", "rate", "priority", "score", "rank"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("effort-engine · determinism", () => {
  it("produces identical output for identical input", () => {
    const input = [entry("b", "dev", 100), entry("a", "design", 100), entry("a", "dev", null)];
    expect(buildEffortDigest(input)).toEqual(buildEffortDigest(input));
  });

  it("does not mutate its input", () => {
    const input: EffortEntryInput[] = [entry("acme", "dev", 3600)];
    const snapshot = structuredClone(input);
    buildEffortDigest(input);
    expect(input).toEqual(snapshot);
  });
});