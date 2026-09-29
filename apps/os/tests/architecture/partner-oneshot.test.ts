// PARTNER-GATE-FIX-001 — the partner provisioning one-shot is held to the recorded authority model,
// WITHOUT a database.
//
// The one-shot writes to production and has no enclosing transaction, so a wrong expectation that
// fails AFTER its INSERTs leaves a provisioned person behind a red gate. This file proves, from the
// source text and the live capability table, that its expectation is derived (never hand-typed),
// that it is checked in `beforeAll` before the pool opens, and that the derivation catches a moved
// boundary in either direction.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CAPABILITIES, capabilitiesForRole, type Capability } from "@/core/auth/capabilities";

const ONESHOT = readFileSync(path.resolve(__dirname, "../db/production-2f-partner.test.ts"), "utf8");
const PROVISIONING = ONESHOT.slice(ONESHOT.indexOf("describeIfProvisioning("), ONESHOT.indexOf('describe("partner provisioning — guard"'));
const WITHHELD = ["admin:*", "prospects:manage"];
// The one-shot's own derivation, re-stated so a mutant can be run through it; the next test pins
// that the one-shot's text is exactly this.
const withheldFrom = (all: readonly Capability[], held: readonly Capability[]) =>
  all.filter((c) => !held.includes(c)).sort();

describe("the one-shot's capability expectation is derived, not typed", () => {
  it("names no capability literal except the two withheld ones", () => {
    const literals = [...ONESHOT.matchAll(/"([a-z]+:[a-z*]+)"/g)].map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(WITHHELD));
    expect(ONESHOT).toContain('const WITHHELD: readonly Capability[] = ["admin:*", "prospects:manage"];');
    expect(ONESHOT).toContain('const SALES = capabilitiesForRole("sales");');
    expect(ONESHOT).toContain('const OWNER = capabilitiesForRole("owner");');
    expect(ONESHOT).toContain("all.filter((c) => !held.includes(c)).sort();");
  });

  it("the resolved principal is checked against every capability, both ways", () => {
    expect(PROVISIONING).toContain("for (const denied of WITHHELD) expect(can(p, denied)");
    expect(PROVISIONING).toMatch(/for \(const c of CAPABILITIES\) \{\s*expect\(can\(p, c\)[\s\S]*?\.toBe\(SALES\.includes\(c\)\);/);
  });

  it("the live table matches the recorded boundary: sales is the owner minus exactly the two", () => {
    const sales = capabilitiesForRole("sales"), owner = capabilitiesForRole("owner");
    expect(withheldFrom(CAPABILITIES, sales)).toEqual([...WITHHELD].sort());
    expect(withheldFrom(owner, sales)).toEqual([...WITHHELD].sort());
  });

  it("the derivation catches a mutant in either direction", () => {
    const sales = capabilitiesForRole("sales");
    const widened = [...sales, "admin:*" as Capability];
    const narrowed = sales.filter((c) => c !== "finance:*");
    expect(withheldFrom(CAPABILITIES, widened)).not.toEqual([...WITHHELD].sort());
    expect(withheldFrom(CAPABILITIES, narrowed)).not.toEqual([...WITHHELD].sort());
  });
});

describe("the boundary is proven BEFORE anything can be written", () => {
  it("the check is the first thing beforeAll does, ahead of the pool and every write", () => {
    const hook = PROVISIONING.indexOf("beforeAll(async () => {");
    const check = PROVISIONING.indexOf("expect(withheldFrom(CAPABILITIES, SALES)");
    const pool = PROVISIONING.indexOf("new Pool(");
    const firstIt = PROVISIONING.indexOf("  it(");
    expect(hook).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(hook);
    expect(check).toBeLessThan(pool);
    expect(pool).toBeLessThan(firstIt);
    for (const write of ["INSERT INTO users", "INSERT INTO memberships", "setUserCredential(db", "UPDATE users SET disabled_at"]) {
      expect(PROVISIONING.indexOf(write), write).toBeGreaterThan(firstIt);
    }
  });

  it("the first it() is the write-free boundary check, ahead of the organization lookup and every write", () => {
    const its = [...PROVISIONING.matchAll(/^  it\("([^"]+)"/gm)];
    expect(its[0][1]).toBe("the capability boundary is the recorded one, asserted FIRST and writing nothing");
    const first = PROVISIONING.slice(its[0].index, its[1].index);
    expect(first).toContain("expect(withheldFrom(CAPABILITIES, SALES)).toEqual([...WITHHELD].sort());");
    expect(first).toContain("expect(withheldFrom(OWNER, SALES)).toEqual([...WITHHELD].sort());");
    expect(first).not.toMatch(/\bdb\.|\braw\.|\bpool\.|await /);
    expect(its[1][1]).toBe("the organization exists, and it is the one the owner already belongs to");
    for (const write of ["SELECT id FROM organizations", "INSERT INTO users", "INSERT INTO memberships", "setUserCredential(db", "UPDATE users SET disabled_at"]) {
      expect(PROVISIONING.indexOf(write), write).toBeGreaterThan(its[1].index!);
    }
  });

  it("the provisioning half is otherwise as written: organization never created, idempotent writes, revocation proven and undone", () => {
    expect(PROVISIONING).toContain("SELECT id FROM organizations WHERE slug = 'ascend'");
    expect(PROVISIONING).not.toMatch(/INSERT INTO organizations/);
    expect(PROVISIONING).toContain("ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name");
    expect(PROVISIONING).toContain("ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'sales'");
    expect(PROVISIONING).toContain('await tx.query("SET LOCAL ROLE ascend_sales");');
    expect(PROVISIONING).toContain("UPDATE users SET disabled_at = NULL WHERE id = $1");
    expect(ONESHOT).toContain('connectionConfigFor(DIRECT!, "migration")');
    expect(ONESHOT).toContain("const describeIfProvisioning = DIRECT && EMAIL && PASSWORD ? describe : describe.skip;");
  });
});
