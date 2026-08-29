// Layer A — STAGE 2A MUTATION GATES.
//
// A control that passes both before and after a mutation proves nothing. Stage 0.5 and Stage 1 each
// found real defects this way — including one vacuous gate of my own — and neither would have been
// caught by inspection.
//
// These two encode the failures that would poison an entire import in one run, and each is written
// so that the NAIVE implementation fails it. The naive implementation is simulated directly rather
// than described, so the gate cannot drift away from the thing it claims to protect.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import {
  addMembership, asPrincipal, createOrganization, createProspect, createUser, findCorroborating,
} from "@/core/db";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { OrganizationId, UserId } from "@/domain";

let db: TestDb;
let org: OrganizationId;
let owner: UserId;

beforeEach(async () => {
  db = await freshDb();
  org = await createOrganization(db.client, "ascend", "Ascend");
  owner = await createUser(db.client, "oscar@ascend.test", "Oscar");
  await addMembership(db.client, owner, org, "owner");
});
afterEach(async () => db.close());

const run = <T>(fn: Parameters<typeof asPrincipal<T>>[2]) =>
  asPrincipal(db.client, __unsafePrincipalForTests("owner", org, owner), fn);

const TAPIA = {
  website: "https://tapiatilemarbleco.com/",
  phone: "+16503648038",
  email: "tapiatileandmarble@gmail.com",
};

async function seedHeldTapiaPair() {
  await run(async (tx) => {
    for (const name of ["Tapia Tile & Marble Co.", "Tile & Marble Installation in Bay Area"]) {
      await createProspect(tx, org, {
        name, website: TAPIA.website, contactPhone: TAPIA.phone, contactEmail: TAPIA.email,
        hold: { reason: "same business recorded twice; human decision required" },
      }, { kind: "system" });
    }
  });
}

/**
 * The classification a sheet row receives. This is the decision Stage 2C will make for 600 rows,
 * modelled here at the seam that decides it, so the rule is proven before the importer exists.
 */
type Outcome = "blocked" | "matched" | "ambiguous" | "new";

async function classify(
  signals: { website?: string | null; phone?: string | null; email?: string | null },
  opts: { includeHeld: boolean }
): Promise<Outcome> {
  const hits = await run((tx) => findCorroborating(tx, signals));
  // THE MUTATION LIVES HERE. `includeHeld: false` is the naive shortcut — "held records are
  // quarantined, therefore skip them" — which is the one-line change this gate exists to reject.
  const visible = opts.includeHeld ? hits : hits.filter((h) => h.identityState !== "held");
  if (opts.includeHeld && visible.some((h) => h.identityState === "held")) return "blocked";
  if (visible.length === 0) return "new";
  if (visible.length > 1) return "ambiguous";
  return "matched";
}

// ═══ GATE A ════════════════════════════════════════════════════════════════════════════════════

describe("GATE A · held + corroborating row → BLOCKED, never NEW", () => {
  it("the correct implementation blocks the row", async () => {
    await seedHeldTapiaPair();
    expect(await classify({ website: TAPIA.website, phone: TAPIA.phone }, { includeHeld: true }))
      .toBe("blocked");
  });

  it("THE MUTATION: excluding held rows from matching classifies it NEW", async () => {
    await seedHeldTapiaPair();
    const mutated = await classify({ website: TAPIA.website, phone: TAPIA.phone }, { includeHeld: false });
    // This is the bug, demonstrated rather than described: the quarantine manufacturing the
    // duplicate it exists to prevent.
    expect(mutated).toBe("new");
    expect(mutated).not.toBe("blocked");
  });

  it("and acting on that classification creates a THIRD record of one business", async () => {
    await seedHeldTapiaPair();
    if ((await classify({ website: TAPIA.website }, { includeHeld: false })) === "new") {
      await run((tx) => createProspect(tx, org, {
        name: "Tapia Tile & Marble", website: TAPIA.website,
      }, { kind: "system" }));
    }
    const all = await run((tx) => findCorroborating(tx, { website: TAPIA.website }));
    expect(all).toHaveLength(3);              // the damage, made visible
    expect(all.filter((p) => p.identityState === "anchored")).toHaveLength(1);
  });

  it("a row corroborating NOTHING is still correctly NEW — the gate is not just 'always block'", async () => {
    await seedHeldTapiaPair();
    expect(await classify({ website: "https://unrelated.test" }, { includeHeld: true })).toBe("new");
  });

  it("a row corroborating ONE anchored prospect is MATCHED, not blocked", async () => {
    await run((tx) => createProspect(tx, org, {
      name: "Alpha", website: "https://alpha.test",
    }, { kind: "system" }));
    expect(await classify({ website: "https://alpha.test" }, { includeHeld: true })).toBe("matched");
  });
});

// ═══ GATE B ════════════════════════════════════════════════════════════════════════════════════

/**
 * Website existence, three-valued. `confirmed_absent` requires an ENUMERATING source — one capable
 * of supporting an absence claim — which no method available to Stage 2D possesses.
 */
type Existence = "confirmed_present" | "confirmed_absent" | "unknown";

function websiteExistence(
  cell: string | undefined,
  opts: { blankMeansAbsent: boolean }
): Existence {
  if (cell && cell.trim().length > 0) return "confirmed_present";
  // THE MUTATION. Reading an empty cell as evidence of absence is the D-1/D-2 failure returning at
  // import scale: it converts "the sheet had a column and left it blank" into a claim about the
  // world, for every unresearched row at once.
  if (opts.blankMeansAbsent) return "confirmed_absent";
  return "unknown";
}

/** The scorer's rule, post-D-1: only a STATED quality earns the opportunity points. */
const scoreFor = (existence: Existence) =>
  existence === "confirmed_absent" ? 30 : 0;

describe("GATE B · blank website → UNKNOWN, never 'no website'", () => {
  it.each([
    ["column present but empty", ""],
    ["whitespace only", "   "],
    ["column absent", undefined],
  ])("the correct implementation reports unknown for %s", (_label, cell) => {
    expect(websiteExistence(cell, { blankMeansAbsent: false })).toBe("unknown");
    expect(scoreFor(websiteExistence(cell, { blankMeansAbsent: false }))).toBe(0);
  });

  it("THE MUTATION: a blank cell becomes a claim, and the claim scores", () => {
    expect(websiteExistence("", { blankMeansAbsent: true })).toBe("confirmed_absent");
    expect(scoreFor(websiteExistence("", { blankMeansAbsent: true }))).toBe(30);
  });

  it("at import scale the mutation fabricates 484 claims and 14,520 points", () => {
    const unresearched = 484;
    const correct = Array.from({ length: unresearched }, () => websiteExistence("", { blankMeansAbsent: false }));
    const mutated = Array.from({ length: unresearched }, () => websiteExistence("", { blankMeansAbsent: true }));

    expect(correct.every((e) => e === "unknown")).toBe(true);
    expect(correct.reduce((n, e) => n + scoreFor(e), 0)).toBe(0);

    // Every one of these is a positive assertion that a business has no website, made by nobody.
    expect(mutated.every((e) => e === "confirmed_absent")).toBe(true);
    expect(mutated.reduce((n, e) => n + scoreFor(e), 0)).toBe(14_520);
  });

  it("a real value is still a real finding — the gate is not 'always unknown'", () => {
    expect(websiteExistence("https://abc.test", { blankMeansAbsent: false })).toBe("confirmed_present");
  });

  it("the database stores the blank as NULL, never as a quality band", async () => {
    const p = await run((tx) => createProspect(tx, org, { name: "Blank", website: null }, { kind: "system" }));
    expect(p.website).toBeNull();
    expect(p.websiteQuality).toBeNull();
  });
});
