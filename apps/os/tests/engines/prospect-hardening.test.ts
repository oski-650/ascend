// Layer A — STAGE 0.5 ACCEPTANCE GATES (the four pre-existing defects, D-1 … D-4).
//
// These are GATES, not coverage. Each one encodes a failure that is harmless at six prospects and
// corrupting at six hundred, and each is written so that it FAILS against the implementation it
// replaced — a test that passes both before and after proves nothing about the repair.
//
// The regression controls, stated explicitly:
//
//   D-1  computeScore({}) === 30   before   →   === 0   after
//   D-2  a failed PSI wrote `website_quality: acceptable`   →   writes no key at all
//   D-3  a bulk import emitted N operator-caused events     →   emits N system-caused events
//   D-4  a prospect had no identity but its filename        →   carries an immutable anchor
//
// THE COMMON DEFECT. All four are the same mistake in four costumes: a value that was never
// established being recorded as though it had been. D-1 read a blank field as a finding, D-2 read a
// failure as a measurement, D-3 read Ascend's own writes as the operator's work, and D-4 read a
// display string as an identity.

import { afterEach, beforeEach, describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { bindOperatorDb, requestAs, withOperatorSession } from "@/tests/support/operator-session";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeScore } from "@/core/crm/scoring";
import { createProspect, listProspects } from "@/core/crm";
import {
  buildProspectIdIndex,
  findDuplicateCandidates,
  normalizeNameKey,
  normalizeWebsiteKey,
  resolveProspectId,
} from "@/core/vault/identity";
import { readEvents } from "@/core/events";
import { extractFromHtml } from "@/lib/htmlExtract";
import type { ProspectFrontmatter, ProspectSlug } from "@/domain";


/**
 * These properties are exercised THROUGH a route, which since 2F step 7.4 requires an
 * authenticated principal holding the capability. The session is real and signed; only the
 * membership lookup behind it is stubbed. Nothing about the domain behaviour under test changes.
 */
const ownerToken = withOperatorSession({ beforeAll, beforeEach, afterAll });

const HIT_LIST = "02 - Sales & Hit List";

let vaultDir: string;
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-hardening-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, HIT_LIST), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

const prospectFile = (slug: string) => path.join(vaultDir, HIT_LIST, `${slug}.md`);
const readProspect = (slug: string) => fs.readFile(prospectFile(slug), "utf8");

/** Score for a frontmatter fragment, typed at the boundary the scorer actually receives. */
const score = (fm: Partial<ProspectFrontmatter>) => computeScore(fm as ProspectFrontmatter);
const points = (fm: Partial<ProspectFrontmatter>) => score(fm).score;
const hasNoWebsiteBonus = (fm: Partial<ProspectFrontmatter>) =>
  score(fm).breakdown.some((b) => b.key === "no_website");

// ═══ D-1 ═══════════════════════════════════════════════════════════════════════════════════════

describe("D-1 · an unresearched website is not evidence of no website", () => {
  it("THE CONTROL: an empty prospect scores zero, not thirty", () => {
    // The old scorer read `!fm.website` as the no-website signal, so this returned 30 — which is
    // exactly the `warm` tier threshold. Every unresearched row in a bulk import was born warm.
    expect(points({})).toBe(0);
    expect(score({}).tier).toBe("cold");
  });

  it.each([
    ["absent", {}],
    ["empty string", { website: "" }],
    ["whitespace", { website: "   " }],
    ["undefined", { website: undefined }],
    ["null", { website: null as unknown as string }],
  ])("an unknown website (%s) earns no bonus", (_label, fm) => {
    expect(hasNoWebsiteBonus(fm)).toBe(false);
    expect(points(fm)).toBe(0);
  });

  it("a STATED absence still earns the bonus — the repair removes a guess, not a fact", () => {
    expect(hasNoWebsiteBonus({ website_quality: "none" })).toBe(true);
    expect(points({ website: "", website_quality: "none" })).toBe(30);
  });

  it("a stated outdated site still earns the bonus", () => {
    expect(points({ website: "https://x.test", website_quality: "outdated" })).toBe(30);
  });

  it.each(["acceptable", "modern"] as const)("a stated %s site earns nothing", (quality) => {
    expect(points({ website: "https://x.test", website_quality: quality })).toBe(0);
  });

  it("no replacement default was introduced — an unknown quality is not read as any band", () => {
    // Guards against "fixing" D-1 by defaulting website_quality instead, which would move the
    // fabrication one field to the left rather than removing it.
    const unknown = { website: "https://x.test" };
    expect(hasNoWebsiteBonus(unknown)).toBe(false);
    expect(points(unknown)).toBe(0);
  });

  it("the other three rules are untouched", () => {
    expect(points({ decision_maker_access: true })).toBe(25);
    expect(points({ project_urgency: "high" })).toBe(25);
    expect(points({ niche_alignment: true })).toBe(20);
    // And they still fail toward FEWER claims when absent.
    expect(points({ decision_maker_access: false, project_urgency: "low", niche_alignment: false })).toBe(0);
  });

  it("a fully-evidenced prospect still reaches 100 / priority", () => {
    const best = {
      website_quality: "none" as const,
      decision_maker_access: true,
      project_urgency: "high" as const,
      niche_alignment: true,
    };
    expect(points(best)).toBe(100);
    expect(score(best).tier).toBe("priority");
  });

  it("tier boundaries are unchanged for evidenced prospects", () => {
    expect(score({ website_quality: "none" }).tier).toBe("warm"); // 30
    expect(score({ website_quality: "none", decision_maker_access: true }).tier).toBe("hot"); // 55
    expect(score({ decision_maker_access: true, niche_alignment: true }).tier).toBe("warm"); // 45
  });

  it("every live-vault prospect keeps the score it had — the repair is behaviour-preserving today", () => {
    // Measured against the real hit list on 2026-08-26: all six carry an explicit website_quality,
    // so none of them relied on the `!fm.website` inference. This is the three-way control from
    // STEP5-AUTHORITY-REPAIR §7 — proof the repair changed only the case nobody had filled in.
    expect(points({ website: "https://www.bayareacustomshirts.com/", website_quality: "acceptable", niche_alignment: true })).toBe(20);
    expect(points({ website: "https://example-modestohvac.com", website_quality: "outdated", decision_maker_access: true, project_urgency: "medium", niche_alignment: true })).toBe(75);
    expect(points({ website: "", website_quality: "none", decision_maker_access: true, project_urgency: "high", niche_alignment: true })).toBe(100);
  });
});

// ═══ D-2 ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Drive the URL-intake route with the network stubbed.
 *
 * The route is the only consumer of `deriveWebsiteQuality`, and the function is module-private, so
 * the behaviour is asserted where it actually reaches the vault: in the file that gets written.
 */
async function intake(opts: { performance: number | null; psiThrows?: boolean }): Promise<void> {
  vi.doMock("@/lib/urlGuard", () => ({
    validateExternalUrl: async (u: string) => ({ ok: true, url: new URL(u) }),
    safeFetch: async () => ({
      ok: true,
      finalUrl: "https://valley-roofing.test/",
      response: {
        ok: true,
        text: async () => "<html><head><title>Valley Roofing Pros</title></head><body></body></html>",
      },
    }),
  }));
  vi.doMock("@/lib/lighthouse", () => ({
    runPsiAudit: async () => {
      if (opts.psiThrows) throw new Error("PageSpeed Insights 429 — anonymous rate limit.");
      return {
        scores: { performance: opts.performance, accessibility: null, best_practices: null, seo: null },
        cwv: { lcp_ms: null, fcp_ms: null, cls: null, ttfb_ms: null, inp_ms: null },
        opportunities: [],
        fetched_url: "https://valley-roofing.test/",
      };
    },
  }));

  const { POST } = await import("@/app/api/prospects/from-url/route");
  const res = await POST(
    requestAs(ownerToken(), "http://localhost/api/prospects/from-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://valley-roofing.test/" }),
    })
  );
  expect(res.status).toBe(200);
}

describe("D-2 · a failed measurement is not a quality claim", () => {
  it("THE CONTROL: a PSI 429 does not write `website_quality: acceptable`", async () => {
    await intake({ performance: null, psiThrows: true });
    const file = await readProspect("valley-roofing-pros");
    expect(file).not.toMatch(/^website_quality:\s*acceptable/m);
    expect(file).not.toMatch(/^website_quality:/m); // absent, not blanked
  });

  it("a null performance score writes no quality key either", async () => {
    await intake({ performance: null });
    const file = await readProspect("valley-roofing-pros");
    expect(file).not.toMatch(/^website_quality:/m);
  });

  it("the unmeasured prospect therefore scores zero, not thirty (D-1 + D-2 compose)", async () => {
    // The two defects fed each other: D-2 wrote `acceptable`, and had it instead written nothing,
    // D-1's `!fm.website` branch was waiting. Only both repairs together make this zero.
    await intake({ performance: null, psiThrows: true });
    const [prospect] = await listProspects();
    expect(prospect.score.score).toBe(0);
    expect(prospect.score.breakdown).toEqual([]);
  });

  it.each([
    [95, "modern"],
    [70, "acceptable"],
    [20, "outdated"],
  ])("a real measurement of %i still produces `%s`", async (performance, expected) => {
    await intake({ performance });
    const file = await readProspect("valley-roofing-pros");
    expect(file).toMatch(new RegExp(`^website_quality: ${expected}`, "m"));
  });

  it("boundary scores land on the documented bands", async () => {
    await intake({ performance: 90 });
    expect(await readProspect("valley-roofing-pros")).toMatch(/^website_quality: modern/m);
    await fs.rm(prospectFile("valley-roofing-pros"));
    vi.resetModules();
    await bindOperatorDb();
    await intake({ performance: 50 });
    expect(await readProspect("valley-roofing-pros")).toMatch(/^website_quality: acceptable/m);
  });
});

// ═══ D-3 ═══════════════════════════════════════════════════════════════════════════════════════

/** The §19 metric's numerator input: events attributable to the operator working in the OS. */
async function operatorCausedEvents() {
  return (await readEvents()).filter((e) => e.actor === "operator");
}

const MD = "---\nname: Fixture Co\nstatus: lead\n---\n\n## Notes\n";

describe("D-3 · system writes are not operator activity", () => {
  it("the default is still operator — manual creation is genuinely operator work", async () => {
    await createProspect("manual-co", MD);
    const [event] = await readEvents();
    expect(event.actor).toBe("operator");
    expect(await operatorCausedEvents()).toHaveLength(1);
  });

  it("an explicit system actor is recorded as system", async () => {
    await createProspect("system-co", MD, { actor: "system" });
    const [event] = await readEvents();
    expect(event.actor).toBe("system");
  });

  it("THE CONTROL: a bulk CSV import increments operator activity by ZERO", async () => {
    // Before D-3 this appended one operator-caused event per row. §19's gate counts weekdays with
    // >= 3 operator-caused events against a 5% baseline, so a single 500-row paste would have
    // cleared that day's bar 166 times over — permanently, the log being append-only.
    const { POST } = await import("@/app/api/import/prospects/route");
    const csv = ["name", ...Array.from({ length: 12 }, (_, i) => `Bulk Co ${i}`)].join("\n");
    const res = await POST(
      requestAs(ownerToken(), "http://localhost/api/import/prospects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, column_map: { name: "name" } }),
      })
    );
    expect(res.status).toBe(200);

    const all = await readEvents();
    expect(all).toHaveLength(12);
    expect(all.every((e) => e.type === "prospect.created")).toBe(true);
    expect(all.every((e) => e.actor === "system")).toBe(true);
    expect(await operatorCausedEvents()).toHaveLength(0);
  });

  it("import emits no historical business event — only that records now exist", async () => {
    const { POST } = await import("@/app/api/import/prospects/route");
    await POST(
      requestAs(ownerToken(), "http://localhost/api/import/prospects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: "name\nHistory Co\n", column_map: { name: "name" } }),
      })
    );
    const types = (await readEvents()).map((e) => e.type);
    expect(types).toEqual(["prospect.created"]);
    // Nothing describing what the BUSINESS did — the F27 rule, applied to intake.
    expect(types.some((t) => /^(prospect\.(contacted|promoted|status_changed)|invoice\.|payment\.)/.test(t))).toBe(false);
  });

  it("a refused overwrite emits nothing regardless of actor", async () => {
    await createProspect("dup-co", MD, { actor: "system" });
    await createProspect("dup-co", "DIFFERENT", { actor: "system" });
    expect(await readEvents()).toHaveLength(1);
  });
});

// ═══ D-4 ═══════════════════════════════════════════════════════════════════════════════════════

describe("D-4 · a prospect's identity is not its filename", () => {
  it("THE CONTROL: a created prospect carries an immutable anchor", async () => {
    const result = await createProspect("anchored-co", MD);
    expect(result.prospectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readProspect("anchored-co")).toMatch(/^prospect_id: [0-9a-f-]{36}$/m);
    expect(await resolveProspectId("anchored-co")).toBe(result.prospectId);
  });

  it("the anchor SURVIVES an overwrite — replacing content is not replacing the business", async () => {
    const first = await createProspect("stable-co", MD);
    const second = await createProspect("stable-co", MD + "\nrewritten\n", { overwrite: true });
    expect(second.prospectId).toBe(first.prospectId);
    expect(await resolveProspectId("stable-co")).toBe(first.prospectId);
  });

  it("an incoming markdown's id cannot re-identify an existing prospect", async () => {
    // The re-import attack: a sheet carrying a stale or wrong id must not silently repoint a
    // record that already has an identity of its own.
    const original = await createProspect("owned-co", MD);
    const intruder = `---\nprospect_id: 00000000-0000-7000-8000-000000000000\nname: Owned Co\n---\n`;
    await createProspect("owned-co", intruder, { overwrite: true });
    expect(await resolveProspectId("owned-co")).toBe(original.prospectId);
  });

  it("a duplicate id across two files is REJECTED, never last-writer-wins", async () => {
    const first = await createProspect("first-co", MD);
    const clash = `---\nprospect_id: ${first.prospectId}\nname: Second Co\n---\n`;
    const result = await createProspect("second-co", clash);
    expect(result).toMatchObject({ written: false, code: "duplicate_prospect_id" });
    // The rejected file was never created, and the original is untouched.
    await expect(readProspect("second-co")).rejects.toThrow();
    expect(await resolveProspectId("first-co")).toBe(first.prospectId);
  });

  it("a caller-supplied id is honoured for a genuinely new prospect", async () => {
    const supplied = "01900000-0000-7000-8000-00000000abcd";
    const result = await createProspect("supplied-co", MD, { prospectId: supplied as never });
    expect(result.prospectId).toBe(supplied);
  });

  it("distinct prospects never share an anchor", async () => {
    const ids = new Set<string>();
    for (const slug of ["a-co", "b-co", "c-co", "d-co"]) {
      const r = await createProspect(slug, MD);
      ids.add(String(r.prospectId));
    }
    expect(ids.size).toBe(4);
  });

  it("the index reports un-anchored prospects rather than inventing ids for them", async () => {
    // A hand-authored file, exactly like the six that predate this field.
    await fs.writeFile(prospectFile("legacy-co"), MD, "utf8");
    await createProspect("modern-co", MD);

    const index = await buildProspectIdIndex();
    expect(index.unanchored).toEqual(["legacy-co"]);
    expect(index.bySlug.has("modern-co" as ProspectSlug)).toBe(true);
    expect(index.violations).toEqual([]);
    // The critical negative: the un-anchored prospect did NOT resolve to its slug.
    expect(await resolveProspectId("legacy-co")).toBeNull();
  });

  it("reads expose the anchor, and null for legacy prospects — never the slug as a stand-in", async () => {
    await fs.writeFile(prospectFile("legacy-co"), MD, "utf8");
    await createProspect("modern-co", MD);
    const bySlug = Object.fromEntries((await listProspects()).map((p) => [p.slug, p.id]));
    expect(bySlug["legacy-co"]).toBeNull();
    expect(bySlug["modern-co"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("D-4 · HTML entities never reach an identity", () => {
  it("THE CONTROL: `&amp;` in a title decodes to `&`, not the token `amp`", () => {
    // This is the exact bug in the live vault: `tapia-tile-amp-marble-co.md` and
    // `tile-amp-marble-installation-in-bay-area.md` are one business, and both filenames contain
    // markup because the name was slugified straight from undecoded HTML.
    const html = "<html><head><title>Tapia Tile &amp; Marble Co.</title></head><body></body></html>";
    const extracted = extractFromHtml(html, "https://tapiatilemarbleco.com/");
    expect(extracted.name).toBe("Tapia Tile & Marble Co.");
    expect(extracted.name).not.toMatch(/amp/i);
  });

  it.each([
    ["&amp;", "Smith &amp; Sons", "Smith & Sons"],
    ["&#38;", "Smith &#38; Sons", "Smith & Sons"],
    ["&#x26;", "Smith &#x26; Sons", "Smith & Sons"],
    ["&rsquo;", "Joe&rsquo;s Diner", "Joe’s Diner"],
    ["&ndash;", "A &ndash; B", "A – B"],
  ])("decodes %s", (_label, raw, expected) => {
    const extracted = extractFromHtml(`<title>${raw}</title>`, "https://x.test/");
    expect(extracted.name).toBe(expected);
  });

  it("double-encoded markup is still stripped, not resurrected", () => {
    // `&amp;lt;script&amp;gt;` must not decode into `<script>`. This is why `&amp;` is decoded
    // LAST — the ordering is a security property, not a formatting preference.
    const extracted = extractFromHtml("<title>Evil &amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</title>", "https://x.test/");
    expect(extracted.name).not.toMatch(/<script/i);
  });
});

describe("D-4 · duplicate candidates are surfaced, never merged", () => {
  const rec = (slug: string, over: Record<string, unknown> = {}) =>
    ({ slug: slug as ProspectSlug, ...over });

  it("THE LIVE CASE: two spellings sharing a website are flagged as one business", () => {
    const found = findDuplicateCandidates([
      rec("tapia-tile-amp-marble-co", { name: "Tapia Tile &amp; Marble Co.", website: "https://tapiatilemarbleco.com/" }),
      rec("tile-amp-marble-installation-in-bay-area", { name: "Tile &amp; Marble Installation in Bay Area", website: "https://tapiatilemarbleco.com/" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].matchedOn).toBe("website");
    expect(found[0].slugs).toEqual([
      "tapia-tile-amp-marble-co",
      "tile-amp-marble-installation-in-bay-area",
    ]);
  });

  it("matches across protocol, www and trailing-slash differences", () => {
    const found = findDuplicateCandidates([
      rec("a-co", { website: "http://www.example.com/" }),
      rec("b-co", { website: "https://example.com" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].matchedOn).toBe("website");
  });

  it("matches on phone regardless of formatting", () => {
    const found = findDuplicateCandidates([
      rec("a-co", { contact_phone: "(209) 555-0188" }),
      rec("b-co", { contact_phone: "+1 209.555.0188" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].matchedOn).toBe("phone");
  });

  it("matches names across legal suffixes and ampersand spelling", () => {
    expect(normalizeNameKey("Smith & Sons Inc")).toBe(normalizeNameKey("Smith and Sons"));
    const found = findDuplicateCandidates([
      rec("a-co", { name: "Smith & Sons Inc" }),
      rec("b-co", { name: "Smith and Sons" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].matchedOn).toBe("name");
  });

  it("reports a pair ONCE, under its strongest evidence", () => {
    const found = findDuplicateCandidates([
      rec("a-co", { name: "Same Co", website: "https://same.test", contact_phone: "209-555-0000" }),
      rec("b-co", { name: "Same Co", website: "https://same.test", contact_phone: "209-555-0000" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].matchedOn).toBe("website");
  });

  it("does not flag genuinely distinct businesses", () => {
    expect(
      findDuplicateCandidates([
        rec("a-co", { name: "Valley Roofing", website: "https://valley.test", contact_phone: "209-555-1111" }),
        rec("b-co", { name: "Delta Sheet Metal", website: "https://delta.test", contact_phone: "209-555-2222" }),
      ])
    ).toEqual([]);
  });

  it("blank and missing fields never match each other", () => {
    // The absence trap again: two prospects with no website are not the same business.
    expect(
      findDuplicateCandidates([
        rec("a-co", { name: "Alpha", website: "", contact_phone: "", contact_email: "" }),
        rec("b-co", { name: "Beta", website: "", contact_phone: "", contact_email: "" }),
      ])
    ).toEqual([]);
    expect(normalizeWebsiteKey("")).toBeNull();
    expect(normalizeWebsiteKey("   ")).toBeNull();
    expect(normalizeWebsiteKey(undefined)).toBeNull();
  });

  it("a short or partial phone number is not a match key", () => {
    expect(
      findDuplicateCandidates([rec("a-co", { contact_phone: "555" }), rec("b-co", { contact_phone: "555" })])
    ).toEqual([]);
  });

  it("finding duplicates never writes anything — detection is not repair", async () => {
    await createProspect("a-co", "---\nname: Same Co\nwebsite: https://same.test\n---\n");
    await createProspect("b-co", "---\nname: Same Co\nwebsite: https://same.test\n---\n");
    const before = await readEvents();
    const prospects = await listProspects();
    const found = findDuplicateCandidates(
      prospects.map((p) => ({ slug: p.slug as ProspectSlug, ...p.frontmatter }))
    );
    expect(found).toHaveLength(1);
    // Both records still exist, both anchors intact, no event claiming a merge.
    expect(await resolveProspectId("a-co")).not.toBeNull();
    expect(await resolveProspectId("b-co")).not.toBeNull();
    expect(await readEvents()).toEqual(before);
  });
});