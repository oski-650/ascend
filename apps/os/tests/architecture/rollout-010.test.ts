// 2A.3a-1 — the rollout's own tools are held to the reviewed migration, WITHOUT a database.
//
// The apply/verify scripts freeze a checksum and an object inventory; this file proves both are the
// reviewed 010 and that the scripts cannot write by default. The smoke is held to "writes nothing":
// every write-shaped request targets a prospect reference that cannot exist.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// @ts-expect-error The rollout scripts are standalone Node ESM with no declaration file.
import { FROZEN_SHA256, EXPECTED_PREDECESSOR, CREATES, PRE_GRANTS, DATA_KEYS, movedSince } from "../../scripts/apply-migration-010.mjs";
// @ts-expect-error The rollout scripts are standalone Node ESM with no declaration file.
import { DELTA, EXPECT } from "../../scripts/verify-migration-010.mjs";

const APP = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(APP, p), "utf8");
const MIG = read("core/db/schema/010_sales_actions.sql");
const APPLY = read("scripts/apply-migration-010.mjs");
const VERIFY = read("scripts/verify-migration-010.mjs");
const SMOKE = read("scripts/deploy-smoke.mjs");
const names = (re: RegExp) => [...MIG.matchAll(re)].map((m) => m[1]).sort();

describe("the frozen identity is the reviewed 010", () => {
  it("pins the file's SHA-256, and the recovery registry pins the same value", () => {
    expect(createHash("sha256").update(MIG).digest("hex")).toBe(FROZEN_SHA256);
    expect(read("core/recovery/profile-registry.ts")).toContain(`010_sales_actions.sql:${FROZEN_SHA256}`);
  });

  it("expects exactly the 001–009 files on disk as its predecessor, and 010 is the last migration", () => {
    const files = readdirSync(path.join(APP, "core/db/schema")).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    expect(files.slice(0, 9)).toEqual(EXPECTED_PREDECESSOR);
    expect(files.at(-1)).toBe("010_sales_actions.sql");
  });

  it("names every table, function, trigger, policy and index that 010's text creates", () => {
    expect(names(/CREATE TABLE (\w+)/g)).toEqual([...CREATES.tables].sort());
    expect(names(/CREATE FUNCTION public\.(\w+)/g)).toEqual([...CREATES.functions].sort());
    expect(names(/CREATE TRIGGER (\w+)/g)).toEqual([CREATES.trigger]);
    expect(names(/CREATE POLICY (\w+)/g)).toEqual(EXPECT.policies.map((p: string) => p.split(":")[1]).sort());
    for (const idx of names(/CREATE (?:UNIQUE )?INDEX (\w+)/g)) expect(EXPECT.indexes).toContain(idx);
    expect(DELTA.cat_tables).toBe(CREATES.tables.length);
    expect(DELTA.cat_functions).toBe(CREATES.functions.length);
    expect(DELTA.cat_policies).toBe(EXPECT.policies.length);
    expect(DELTA.cat_indexes).toBe(EXPECT.indexes.length);
  });

  it("the grant pre-state is what 010 revokes from, and the post-state removes exactly the guarded four", () => {
    expect(MIG).toMatch(/REVOKE UPDATE \(status, assigned_to, first_contact, last_contact\) ON prospects FROM ascend_sales;/);
    expect(MIG).toMatch(/REVOKE UPDATE ON prospects FROM ascend_owner;/);
    const post = EXPECT.sales_prospect_update_columns.split(",");
    expect(PRE_GRANTS.sales_update_columns.filter((c: string) => !post.includes(c)).sort()).toEqual([...EXPECT.guarded].sort());
    expect(post.every((c: string) => PRE_GRANTS.sales_update_columns.includes(c))).toBe(true);
  });
});

describe("the scripts cannot write by default", () => {
  it("apply opens a read-only session unless --apply-to-production, and applying needs the window's evidence", () => {
    expect(APPLY).toContain('...(APPLY ? {} : { options: "-c default_transaction_read_only=on" })');
    expect(APPLY).toContain('const APPLY = has("--apply-to-production")');
    expect(APPLY).toMatch(/if \(APPLY && !arg\("--since"\)\) die/);
    expect(APPLY).toMatch(/if \(!has\("--service-stopped"\)\) die/);
    expect(APPLY).toMatch(/sessions\.active !== 0\) die/);
    expect(APPLY).toMatch(/sessions\.unknown !== 0\) die/);
    expect(APPLY).toMatch(/mode: 0o600/);
  });

  it("apply loads no application mutation path: only pg and core/db/migrate.ts", () => {
    const dynamic = [...APPLY.matchAll(/import\((?:path\.join\(APP, )?"([^"]+)"/g)].map((m) => m[1]);
    expect(dynamic.sort()).toEqual(["core/db/migrate.ts", "node_modules/pg/lib/index.js"]);
    const statics = [...APPLY.matchAll(/^import [^;]* from "([^"]+)";/gm)].map((m) => m[1]);
    expect(statics.every((s) => s.startsWith("node:"))).toBe(true);
  });

  it("verify is read-only end to end and contains no writing SQL", () => {
    expect(VERIFY).toContain('options: "-c default_transaction_read_only=on"');
    expect(VERIFY).toContain('await client.query("BEGIN READ ONLY")');
    const sql = [...VERIFY.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("\n");
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|ALTER |DROP |CREATE |GRANT |REVOKE |TRUNCATE )/i);
  });

  it("movedSince reports exactly the data keys that changed", () => {
    const base = Object.fromEntries(DATA_KEYS.map((k: string) => [k, 1]));
    expect(movedSince(base, { ...base })).toEqual([]);
    expect(movedSince(base, { ...base, prospects: 2, events_max_seq: "9" })).toEqual(["prospects", "events_max_seq"]);
  });
});

describe("the smoke writes nothing", () => {
  it("every POST, PATCH or DELETE targets the impossible `ghost` reference, except login", () => {
    const writes = [...SMOKE.matchAll(/req\("(POST|PATCH|DELETE)", `?([^,`"]+)[`"]?/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(writes.length).toBeGreaterThanOrEqual(6);
    for (const w of writes) {
      if (w.endsWith("/api/auth/login")) continue;
      expect(w, w).toMatch(/\/api\/prospects\/\$\{ghost\}(\/|$)/);
    }
    expect(SMOKE).toMatch(/const ghost = `d1-smoke-no-such-prospect-\$\{randomBytes\(6\)\.toString\("hex"\)\}`/);
    expect(SMOKE).not.toMatch(/req\([^)]*from-url/);
  });

  it("takes partner credentials only from the environment and never prints them", () => {
    expect(SMOKE).toContain("process.env.ASCEND_SMOKE_PARTNER_EMAIL");
    expect(SMOKE).toContain("process.env.ASCEND_SMOKE_PARTNER_PASSWORD");
    expect(SMOKE).not.toMatch(/console\.log\([^)]*\b(pe|pp|email)\b/);
  });

  it("every new Sales check is marked to fail on the old build, so the baseline proves discrimination", () => {
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "R2", "R3", "R4"]) {
      const at = SMOKE.indexOf(`check("${id}"`);
      expect(at, id).toBeGreaterThan(0);
      expect(SMOKE.slice(at, SMOKE.indexOf(");", SMOKE.indexOf("`", at) + 1) + 2), id).toContain("newBuild: true");
    }
  });
});
