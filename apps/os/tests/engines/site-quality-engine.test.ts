// Layer A — Site Quality Awareness (Phase 9) contract tests.
//
// Frozen contract: the MEASURED EXTERNAL quality of shipped sites, distinct from Health (internal
// delivery). Classifies each client's LATEST audit against FIXED standard Lighthouse bands (SQ-3).
// Reports facts only — never a recommendation (that is Opportunity), never a priority (Decision),
// and it does NOT modify Health. FULLY CLOCK-FREE (SQ-5): no staleness, no `now`.

import { describe, expect, it } from "vitest";
import { buildSiteQualityDigest, type SiteAuditInput } from "@/engines/site-quality-engine";
import type { AuditStrategy, LighthouseScores } from "@/domain";

const audit = (over: Partial<SiteAuditInput> & Pick<SiteAuditInput, "id">): SiteAuditInput => ({
  client: "acme",
  url: "https://acme.test",
  strategy: "mobile" as AuditStrategy,
  run_at: "2026-01-01T00:00:00.000Z",
  scores: { performance: 95, accessibility: 95, best_practices: 95, seo: 95 },
  ...over,
});

const scores = (over: Partial<LighthouseScores>): LighthouseScores => ({
  performance: null,
  accessibility: null,
  best_practices: null,
  seo: null,
  ...over,
});

describe("site-quality-engine · empty + absence", () => {
  it("returns an honest empty digest for no audits", () => {
    expect(buildSiteQualityDigest([])).toEqual({
      sites: [],
      counts: { poor: 0, needsImprovement: 0, good: 0 },
    });
  });

  it("omits a client entirely rather than fabricating a result for it", () => {
    // A client with no audit simply has no row — the engine never invents a band.
    const digest = buildSiteQualityDigest([audit({ id: "a1", client: "has-audit" })]);
    expect(digest.sites.map((s) => s.clientSlug)).toEqual(["has-audit"]);
  });
});

describe("site-quality-engine · SQ-3 fixed band thresholds", () => {
  it("classifies exactly 90 as good (inclusive lower bound)", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ performance: 90 }) })]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.band).toBe("good");
  });

  it("classifies 89 as needs-improvement", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ performance: 89 }) })]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.band).toBe(
      "needs-improvement"
    );
  });

  it("classifies exactly 50 as needs-improvement (inclusive lower bound)", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ performance: 50 }) })]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.band).toBe(
      "needs-improvement"
    );
  });

  it("classifies 49 as poor", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ performance: 49 }) })]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.band).toBe("poor");
  });

  it("classifies 0 as poor rather than treating it as missing", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ performance: 0 }) })]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.band).toBe("poor");
  });
});

describe("site-quality-engine · missing metrics are unclassified, never 0", () => {
  it("marks a null category score as unclassified", () => {
    const digest = buildSiteQualityDigest([audit({ id: "a", scores: scores({ seo: null }) })]);
    const seo = digest.sites[0].categories.find((c) => c.category === "seo");
    expect(seo?.score).toBeNull();
    expect(seo?.band).toBe("unclassified");
  });

  it("survives an audit whose scores object is missing entirely", () => {
    const broken = { ...audit({ id: "a" }), scores: undefined } as unknown as SiteAuditInput;
    const digest = buildSiteQualityDigest([broken]);
    expect(digest.sites[0].categories.every((c) => c.band === "unclassified")).toBe(true);
    expect(digest.sites[0].worstBand).toBe("unclassified");
  });

  it("reports worstBand as unclassified only when NO category is classified", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "a", scores: scores({ performance: 40 }) }), // one classified, rest null
    ]);
    expect(digest.sites[0].worstBand).toBe("poor");
  });

  it("derives worstBand from the lowest classified band, ignoring unclassified ones", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "a", scores: scores({ performance: 95, seo: 30 }) }),
    ]);
    expect(digest.sites[0].worstBand).toBe("poor");
  });
});

describe("site-quality-engine · latest-audit selection", () => {
  it("keeps only the most recent audit per client+strategy", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "old", run_at: "2026-01-01T00:00:00.000Z", scores: scores({ performance: 10 }) }),
      audit({ id: "new", run_at: "2026-06-01T00:00:00.000Z", scores: scores({ performance: 95 }) }),
    ]);
    expect(digest.sites).toHaveLength(1);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.score).toBe(95);
  });

  it("breaks an identical run_at tie by id, deterministically", () => {
    const same = "2026-01-01T00:00:00.000Z";
    const digest = buildSiteQualityDigest([
      audit({ id: "aaa", run_at: same, scores: scores({ performance: 10 }) }),
      audit({ id: "zzz", run_at: same, scores: scores({ performance: 95 }) }),
    ]);
    expect(digest.sites[0].categories.find((c) => c.category === "performance")?.score).toBe(95);
  });

  it("preserves the mobile/desktop distinction as separate rows", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "m", strategy: "mobile" }),
      audit({ id: "d", strategy: "desktop" }),
    ]);
    expect(digest.sites).toHaveLength(2);
    expect(digest.sites.map((s) => s.strategy).sort()).toEqual(["desktop", "mobile"]);
  });
});

describe("site-quality-engine · ordering + counts", () => {
  it("orders sites worst band first", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "g", client: "good-co", scores: scores({ performance: 95 }) }),
      audit({ id: "p", client: "poor-co", scores: scores({ performance: 10 }) }),
      audit({ id: "n", client: "mid-co", scores: scores({ performance: 70 }) }),
    ]);
    expect(digest.sites.map((s) => s.clientSlug)).toEqual(["poor-co", "mid-co", "good-co"]);
  });

  it("counts each band consistently with the rows", () => {
    const digest = buildSiteQualityDigest([
      audit({ id: "p", client: "a", scores: scores({ performance: 10 }) }),
      audit({ id: "n", client: "b", scores: scores({ performance: 70 }) }),
      audit({ id: "g", client: "c", scores: scores({ performance: 95 }) }),
    ]);
    expect(digest.counts).toEqual({ poor: 1, needsImprovement: 1, good: 1 });
  });
});

describe("site-quality-engine · ownership boundary", () => {
  it("emits no Health, recommendation, or priority field", () => {
    const serialized = JSON.stringify(buildSiteQualityDigest([audit({ id: "a" })])).toLowerCase();
    for (const forbidden of ["health", "tier", "recommend", "action", "priority", "rank", "severity"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("site-quality-engine · SQ-5 clock-free determinism", () => {
  it("produces identical output across calls with no staleness field", () => {
    const input = [audit({ id: "a" }), audit({ id: "b", client: "other" })];
    const first = buildSiteQualityDigest(input);
    expect(first).toEqual(buildSiteQualityDigest(input));
    // No computedAt / age / stale field may appear — the engine has no clock.
    expect(JSON.stringify(first).toLowerCase()).not.toMatch(/computedat|stale|ageday|daysago/);
  });
});