import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
// @ts-expect-error The Node .mjs gate runner has no declaration file; runtime contracts are tested below.
import { environmentClass, environmentErrors, isOwnerArtifact, makeReceipt, missingProofs, parseRunReport, receiptableResults, selectedProofStatus, verifyReceipt } from "../../scripts/gate-proof.mjs";

const appRoot = resolve(__dirname, "../..");
const tree = "a".repeat(40);
const manifestHash = "b".repeat(64);
const testHash = "c".repeat(64);
const key = Buffer.alloc(32, 7);
const runId = "12345678-1234-1234-1234-123456789abc";
const manifest = {
  "tests/a.test.ts": { evidence: "PROVEN", phase: "static" },
  "tests/db/b.test.ts": { evidence: "PROVEN", phase: "db", requires: ["ASCEND_DATABASE_URL"] },
  "tests/render/c.test.ts": { evidence: "PROVEN", phase: "server" },
  "tests/db/d.test.ts": { evidence: "PROVEN", phase: "recovery", requires: ["ASCEND_RECOVERY_OWNER_PASSWORD"] },
  "tests/db/parked.test.ts": { evidence: "PARKED", phase: "db" },
} as const;
const context = { tree, manifestHash, testHash: () => testHash };
const receipt = (suite: keyof typeof manifest) => makeReceipt({
  tree, manifestHash, suite, testHash, phase: manifest[suite].phase,
  environmentClass: environmentClass(manifest[suite]), runId, passed: 1,
}, key);
const expected = (suite: keyof typeof manifest) => ({
  tree, manifestHash, suite, testHash, phase: manifest[suite].phase,
  environmentClass: environmentClass(manifest[suite]),
});
const passingResult = (suite: string) => ({
  name: resolve(appRoot, suite), status: "passed", assertionResults: [{ status: "passed" }],
});

describe("2G.1 phase execution receipts", () => {
  it("accepts every emitted environment class, including local-pg17", () => {
    const cases = [
      { phase: "static", requires: [], name: "static-local" },
      { phase: "server", requires: [], name: "local-render" },
      { phase: "server", requires: ["ASCEND_DATABASE_URL"], name: "production-startup" },
      { phase: "db", requires: ["ASCEND_DATABASE_URL"], name: "production-database" },
      { phase: "db", requires: ["ASCEND_PG17_BIN"], name: "local-pg17" },
      { phase: "db", requires: [], name: "local-pglite" },
      { phase: "recovery", requires: [], name: "isolated-fixture-recovery" },
      { phase: "recovery", requires: ["ASCEND_BACKUP_ARTIFACT"], name: "owner-artifact-recovery" },
    ];
    for (const { phase, requires, name } of cases) {
      const emitted = environmentClass({ phase, requires });
      expect(emitted).toBe(name);
      const proof = makeReceipt({ tree, manifestHash, suite: "tests/example.test.ts", testHash,
        phase, environmentClass: emitted, runId, passed: 1 }, key);
      expect(verifyReceipt(proof, { tree, manifestHash, suite: "tests/example.test.ts", testHash,
        phase, environmentClass: emitted }, key)).toBe(true);
    }
  });

  it("rejects malformed, unexpected and wrong-phase environment classes", () => {
    for (const name of ["local-pg18", "local-pg17-extra", "local-pg17 ", "LOCAL-PG17", "local_pg17", "", "db17"]) {
      expect(() => makeReceipt({ tree, manifestHash, suite: "tests/example.test.ts", testHash,
        phase: "db", environmentClass: name, runId, passed: 1 }, key)).toThrow("invalid receipt input");
    }
    expect(() => makeReceipt({ tree, manifestHash, suite: "tests/example.test.ts", testHash,
      phase: "db", environmentClass: "static-local", runId, passed: 1 }, key)).toThrow("invalid receipt input");
  });

  it("rejects environment names without an executed suite", () => {
    expect(environmentErrors("db", manifest, { ASCEND_DATABASE_URL: "present" })).toEqual([]);
    expect(missingProofs(manifest, {}, context, key)).toEqual([
      "db: tests/db/b.test.ts", "recovery: tests/db/d.test.ts",
      "server: tests/render/c.test.ts", "static: tests/a.test.ts",
    ]);
  });

  it("rejects skipped, pending and failed assertions even when Vitest says success", () => {
    for (const status of ["skipped", "pending", "failed"]) {
      const report = { success: true, testResults: [{ ...passingResult("tests/db/b.test.ts"),
        assertionResults: [{ status }] }] };
      expect(() => parseRunReport(report, manifest, "db", appRoot)).toThrow(/skipped, pending or failed/);
    }
    expect(() => parseRunReport({ success: true, testResults: [] }, manifest, "db", appRoot)).toThrow(/missing/);
  });

  it("static and db receipts satisfy only their own suites", () => {
    const receipts = { "tests/a.test.ts": receipt("tests/a.test.ts") };
    expect(missingProofs(manifest, receipts, context, key)).toHaveLength(3);
    Object.assign(receipts, { "tests/db/b.test.ts": receipt("tests/db/b.test.ts") });
    expect(missingProofs(manifest, receipts, context, key)).toEqual([
      "recovery: tests/db/d.test.ts", "server: tests/render/c.test.ts",
    ]);
  });

  it("accepts recovery only in the isolated environment and refuses database URLs", () => {
    const clean = { ASCEND_RECOVERY_OWNER_PASSWORD: "fixture-only" };
    expect(environmentErrors("recovery", manifest, clean)).toEqual([]);
    expect(environmentErrors("recovery", manifest, { ...clean, ASCEND_DATABASE_URL: "visible" }))
      .toContain("recovery proof refuses database, PG and Supabase environment variables");
    expect(environmentErrors("db", manifest, { ASCEND_DATABASE_URL: "fixture", ...clean }))
      .toContain("db proof refuses recovery secrets");
    expect(environmentErrors("db", manifest, { ASCEND_DATABASE_URL: "fixture", ASCEND_OWNER_PASSWORD: "fixture" }))
      .toContain("db proof refuses recovery secrets");
  });

  it("does not turn the fixture artifact rehearsal into an owner-artifact proof", () => {
    const home = mkdtempSync(resolve(tmpdir(), "gate-proof-home-"));
    const fixture = mkdtempSync(resolve(tmpdir(), "gate-proof-fixture-"));
    const name = "ascend-backup-20260924T000000Z.ascbk";
    try {
      mkdirSync(resolve(home, "AscendBackups"));
      writeFileSync(resolve(fixture, name), "fixture");
      writeFileSync(resolve(home, "AscendBackups", name), "owner artifact placeholder");
      expect(isOwnerArtifact(resolve(fixture, name), home)).toBe(false);
      expect(isOwnerArtifact(resolve(home, "AscendBackups", name), home)).toBe(true);
      const proof = [{ suite: "tests/db/d.test.ts", passed: 1 }];
      const ownerManifest = { ...manifest, "tests/db/d.test.ts": { ...manifest["tests/db/d.test.ts"], requires: ["ASCEND_BACKUP_ARTIFACT"] } };
      expect(receiptableResults(proof, ownerManifest, "recovery", resolve(fixture, name), home)).toEqual([]);
      expect(receiptableResults(proof, ownerManifest, "recovery", resolve(home, "AscendBackups", name), home)).toEqual(proof);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a receipt bound to a changed tree, test or phase", () => {
    const proof = receipt("tests/db/b.test.ts");
    const want = expected("tests/db/b.test.ts");
    expect(verifyReceipt(proof, want, key)).toBe(true);
    expect(verifyReceipt(proof, { ...want, tree: "d".repeat(40) }, key)).toBe(false);
    expect(verifyReceipt(proof, { ...want, testHash: "d".repeat(64) }, key)).toBe(false);
    expect(verifyReceipt(proof, { ...want, phase: "recovery" }, key)).toBe(false);
  });

  it("verify-phase and verify-recovery accept only complete exact-tree receipts", () => {
    const ownerSuite = "tests/db/restore-independence.test.ts";
    const ownerManifest = { ...manifest, [ownerSuite]: { evidence: "PROVEN", phase: "recovery", requires: ["ASCEND_BACKUP_ARTIFACT"] } };
    const ownerReceipt = makeReceipt({ tree, manifestHash, suite: ownerSuite, testHash,
      phase: "recovery", environmentClass: "owner-artifact-recovery", runId, passed: 1 }, key);
    const receipts = { "tests/a.test.ts": receipt("tests/a.test.ts"), [ownerSuite]: ownerReceipt };
    expect(selectedProofStatus("static", null, manifest, receipts, context, key)).toEqual({ count: 1, missing: [] });
    expect(selectedProofStatus("recovery", [ownerSuite], ownerManifest, receipts, context, key))
      .toEqual({ count: 1, missing: [] });
    const otherTree = { ...context, tree: "d".repeat(40) };
    expect(selectedProofStatus("static", null, manifest, receipts, otherTree, key).missing).toHaveLength(1);
    const tampered = { ...receipts, [ownerSuite]: { ...ownerReceipt, passed: 2 } };
    expect(selectedProofStatus("recovery", [ownerSuite], ownerManifest, tampered, context, key).missing).toHaveLength(1);
    expect(selectedProofStatus("recovery", [ownerSuite], ownerManifest, {}, context, key).missing).toHaveLength(1);
    expect(() => selectedProofStatus("recovery", ["tests/a.test.ts"], manifest, receipts, context, key)).toThrow();
  });

  it("rejects malformed and tampered evidence, including added secret fields", () => {
    const proof = receipt("tests/db/b.test.ts");
    const want = expected("tests/db/b.test.ts");
    expect(verifyReceipt({ ...proof, passed: 0 }, want, key)).toBe(false);
    expect(verifyReceipt({ ...proof, mac: "0".repeat(64) }, want, key)).toBe(false);
    expect(verifyReceipt({ ...proof, password: "secret" }, want, key)).toBe(false);
    expect(verifyReceipt({ ...proof, environment_class: "isolated-recovery" }, want, key)).toBe(false);
  });

  it("accepts complete phase evidence without serializing a credential", () => {
    const secret = "UNIQUE-PRODUCTION-SECRET-NEVER-SERIALIZE";
    process.env.ASCEND_DATABASE_URL = secret;
    try {
      const receipts = Object.fromEntries(Object.keys(manifest).filter(x => x !== "tests/db/parked.test.ts")
        .map(suite => [suite, receipt(suite as keyof typeof manifest)]));
      expect(missingProofs(manifest, receipts, context, key)).toEqual([]);
      expect(JSON.stringify(receipts)).not.toContain(secret);
      expect(JSON.stringify(receipts)).not.toContain("ASCEND_DATABASE_URL");
    } finally {
      delete process.env.ASCEND_DATABASE_URL;
    }
  });
});
