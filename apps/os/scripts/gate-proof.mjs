#!/usr/bin/env node
// 2G.1 proof receipts live in this worktree's private Git directory, never in the repository.
// Only fixed, non-secret fields are serialized. A receipt is valid for exactly one Git tree.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { GATE_2G1 } from "../tests/architecture/gate-2g1.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const phases = ["static", "server", "db", "recovery"];
const environmentClasses = {
  static: new Set(["static-local"]),
  server: new Set(["local-render", "production-startup"]),
  db: new Set(["production-database", "local-pg17", "local-pglite"]),
  recovery: new Set(["isolated-fixture-recovery", "owner-artifact-recovery"]),
};
const recoverySuites = new Set([
  "tests/recovery/artifact.test.ts",
  "tests/db/restore-fidelity.test.ts",
  "tests/db/recovery-profiles.test.ts",
  "tests/db/restore-independence.test.ts",
  "tests/db/restore-same-version.test.ts",
]);
const sha = value => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: appRoot, encoding: "utf8" }).trim();
const suitePath = name => resolve(appRoot, name);
const receiptName = name => `${sha(name)}.json`;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

export function expectedSuites(manifest, phase) {
  return Object.entries(manifest).filter(([, row]) => row.evidence === "PROVEN" && row.phase === phase)
    .map(([name]) => name).sort();
}

export function parseRunReport(report, manifest, phase, appDir = appRoot) {
  if (!report || report.success !== true || !Array.isArray(report.testResults)) throw Error("test runner did not pass");
  const expected = expectedSuites(manifest, phase);
  const seen = new Map();
  for (const result of report.testResults) {
    if (typeof result?.name !== "string" || !isAbsolute(result.name)) throw Error("invalid suite path");
    const name = relative(appDir, result.name).replaceAll("\\", "/");
    if (name.startsWith("../") || seen.has(name)) throw Error("unexpected or duplicate suite");
    seen.set(name, result);
  }
  for (const name of expected) {
    const result = seen.get(name);
    if (!result || result.status !== "passed" || !Array.isArray(result.assertionResults)) {
      throw Error(`${name}: missing, failed or malformed result`);
    }
    if (!result.assertionResults.length || result.assertionResults.some(x => x.status !== "passed")) {
      throw Error(`${name}: skipped, pending or failed assertion`);
    }
  }
  return expected.map(name => ({ suite: name, passed: seen.get(name).assertionResults.length }));
}

const receiptKeys = ["version", "tree", "manifest_sha256", "suite", "test_sha256", "phase", "environment_class", "run_id", "passed", "result"];
export function environmentClass(row) {
  const required = row.requires ?? [];
  if (row.phase === "static") return "static-local";
  if (row.phase === "recovery") return required.includes("ASCEND_BACKUP_ARTIFACT") ? "owner-artifact-recovery" : "isolated-fixture-recovery";
  if (row.phase === "server") return required.some(name => name.includes("DATABASE_URL")) ? "production-startup" : "local-render";
  if (row.phase === "db") return required.some(name => name.includes("DATABASE_URL")) ? "production-database" :
    required.includes("ASCEND_PG17_BIN") ? "local-pg17" : "local-pglite";
  throw Error("unknown proof phase");
}
export function isOwnerArtifact(artifact, home = homedir()) {
  if (typeof artifact !== "string" || !/^ascend-backup-\d{8}T\d{6}Z(?:-[a-z0-9-]+)?\.ascbk$/.test(basename(artifact))) return false;
  try {
    const root = realpathSync(join(home, "AscendBackups"));
    return dirname(realpathSync(artifact)) === root;
  } catch { return false; }
}
export function receiptableResults(passed, manifest, phase, artifact, home = homedir()) {
  return passed.filter(item => phase !== "recovery" ||
    environmentClass(manifest[item.suite]) !== "owner-artifact-recovery" || isOwnerArtifact(artifact, home));
}
export function makeReceipt({ tree, manifestHash, suite, testHash, phase, environmentClass: className, runId, passed }, key) {
  if (!phases.includes(phase) || !/^[a-f0-9]{40}$/.test(tree) || !/^[a-f0-9]{64}$/.test(manifestHash) ||
      !/^[a-f0-9]{64}$/.test(testHash) || typeof suite !== "string" || !Number.isSafeInteger(passed) || passed < 1 ||
      typeof runId !== "string" || !/^[a-f0-9-]{36}$/.test(runId) || typeof className !== "string" ||
      !environmentClasses[phase]?.has(className)) throw Error("invalid receipt input");
  const body = { version: 1, tree, manifest_sha256: manifestHash, suite, test_sha256: testHash,
    phase, environment_class: className, run_id: runId, passed, result: "passed" };
  return { ...body, mac: createHmac("sha256", key).update(JSON.stringify(body)).digest("hex") };
}

export function verifyReceipt(receipt, expected, key) {
  if (!exactKeys(receipt, [...receiptKeys, "mac"]) || !/^[a-f0-9]{64}$/.test(receipt.mac)) return false;
  const { mac, ...body } = receipt;
  if (body.version !== 1 || body.result !== "passed" || body.tree !== expected.tree ||
      body.manifest_sha256 !== expected.manifestHash || body.suite !== expected.suite ||
      body.test_sha256 !== expected.testHash || body.phase !== expected.phase ||
      body.environment_class !== expected.environmentClass ||
      !Number.isSafeInteger(body.passed) || body.passed < 1 ||
      typeof body.run_id !== "string" || !/^[a-f0-9-]{36}$/.test(body.run_id)) return false;
  const calculated = createHmac("sha256", key).update(JSON.stringify(body)).digest();
  return timingSafeEqual(calculated, Buffer.from(mac, "hex"));
}

export function missingProofs(manifest, receipts, context, key) {
  const missing = [];
  for (const [suite, row] of Object.entries(manifest)) {
    if (row.evidence !== "PROVEN") continue;
    const receipt = receipts[suite];
    const expected = { tree: context.tree, manifestHash: context.manifestHash, suite,
      testHash: context.testHash(suite), phase: row.phase, environmentClass: environmentClass(row) };
    if (!receipt || !verifyReceipt(receipt, expected, key)) missing.push(`${row.phase}: ${suite}`);
  }
  return missing.sort();
}

function context() {
  if (git("status", "--porcelain").trim()) throw Error("proof requires a clean tracked tree");
  const tree = git("rev-parse", "HEAD^{tree}");
  const manifestHash = sha(readFileSync(suitePath("tests/architecture/gate-2g1.ts")));
  return { tree, manifestHash, testHash: name => sha(readFileSync(suitePath(name))) };
}

function store() {
  const gitPath = git("rev-parse", "--git-path", "ascend-proof-v1");
  const dir = isAbsolute(gitPath) ? gitPath : resolve(appRoot, gitPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (statSync(dir).mode & 0o077) throw Error("proof directory must be private (0700)");
  const keyPath = join(dir, "key");
  let key;
  try { key = readFileSync(keyPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    key = randomBytes(32);
    writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
  }
  if (key.length !== 32 || statSync(keyPath).mode & 0o077) throw Error("invalid or non-private local proof key");
  return { dir, key };
}

export function environmentErrors(phase, manifest, environment) {
  const names = Object.keys(environment);
  const errors = [];
  if (phase === "recovery") {
    if (names.some(name => name.startsWith("PG") || name.includes("DATABASE_URL") || name.startsWith("SUPABASE")))
      errors.push("recovery proof refuses database, PG and Supabase environment variables");
  } else if (names.some(name => name.startsWith("ASCEND_BACKUP_") || name.startsWith("ASCEND_RECOVERY_") ||
      name === "ASCEND_R1C_ROOT" || name === "ASCEND_OWNER_PASSWORD")) {
    errors.push(`${phase} proof refuses recovery secrets`);
  }
  for (const suite of expectedSuites(manifest, phase)) {
    for (const name of manifest[suite].requires ?? []) {
      if (!environment[name]) errors.push(`${suite}: missing required environment name ${name}`);
    }
  }
  return errors;
}

function requireEnvironment(phase, manifest) {
  const errors = environmentErrors(phase, manifest, process.env);
  if (errors.length) throw Error(errors.join("\n"));
}

function runPhase(phase, selected = null) {
  const manifest = GATE_2G1;
  const ctx = context();
  requireEnvironment(phase, selected ? Object.fromEntries(selected.map(name => [name, manifest[name]])) : manifest);
  const args = phase === "static" ? ["--exclude", "tests/render/**", "--exclude", "tests/db/**", "--exclude", "tests/recovery/**"] :
    phase === "server" ? ["tests/render/"] : phase === "db" ? ["tests/db/", ...[...recoverySuites]
      .filter(name => name.startsWith("tests/db/")).flatMap(name => ["--exclude", name])] : selected;
  const result = spawnSync("npx", ["vitest", "run", ...args, "--reporter=json"],
    { cwd: appRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env });
  if (result.error || result.status !== 0) throw Error(`${phase} test runner exited ${result.status ?? "without status"}`);
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw Error(`${phase} test runner returned malformed JSON`); }
  const checkedManifest = phase === "recovery" ? Object.fromEntries(selected.map(name => [name, manifest[name]])) : manifest;
  const passed = receiptableResults(parseRunReport(report, checkedManifest, phase),
    manifest, phase, process.env.ASCEND_BACKUP_ARTIFACT);
  const { dir, key } = store();
  const treeDir = join(dir, ctx.tree);
  mkdirSync(treeDir, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  for (const item of passed) {
    const receipt = makeReceipt({ tree: ctx.tree, manifestHash: ctx.manifestHash, suite: item.suite,
      testHash: ctx.testHash(item.suite), phase, environmentClass: environmentClass(manifest[item.suite]),
      runId, passed: item.passed }, key);
    writeFileSync(join(treeDir, receiptName(item.suite)), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  }
  console.log(`Tests  ${report.numPassedTests} passed${report.numPendingTests ? ` | ${report.numPendingTests} skipped` : ""}`);
  console.log(`${phase}: ${passed.length} PROVEN suites executed in their legitimate environment and recorded for tree ${ctx.tree}`);
}

function storedReceipts(ctx) {
  const { dir, key } = store();
  const treeDir = join(dir, ctx.tree);
  const receipts = {};
  try {
    for (const file of readdirSync(treeDir)) {
      if (!file.endsWith(".json")) continue;
      const value = JSON.parse(readFileSync(join(treeDir, file), "utf8"));
      if (receiptName(value.suite) !== file || receipts[value.suite]) throw Error("malformed or duplicate proof receipt");
      receipts[value.suite] = value;
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { receipts, key };
}

function verifyPhase(phase, selected = null) {
  if (!phases.includes(phase)) throw Error("unknown proof phase");
  const ctx = context();
  const { receipts, key } = storedReceipts(ctx);
  if (selected && (phase !== "recovery" || !selected.length || selected.some(name => !recoverySuites.has(name))))
    throw Error("invalid selected proof suites");
  const phaseManifest = Object.fromEntries(Object.entries(GATE_2G1).filter(([name, row]) =>
    row.phase === phase && (!selected || selected.includes(name))));
  const missing = missingProofs(phaseManifest, receipts, ctx, key);
  if (missing.length) throw Error(`PROVEN ${phase} suites lack valid execution evidence (${missing.length}):\n${missing.join("\n")}`);
  const count = expectedSuites(phaseManifest, phase).length;
  console.log(`${phase}: ${count}/${count} PROVEN suites have valid exact-tree receipts for ${ctx.tree}`);
}

function aggregate() {
  const ctx = context();
  const { receipts, key } = storedReceipts(ctx);
  const missing = missingProofs(GATE_2G1, receipts, ctx, key);
  if (missing.length) throw Error(`PROVEN suites lack valid execution evidence (${missing.length}):\n${missing.join("\n")}`);
  console.log(`aggregate: all ${Object.values(GATE_2G1).filter(x => x.evidence === "PROVEN").length} PROVEN suites have valid phase evidence for tree ${ctx.tree}`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "static") { runPhase("static"); aggregate(); }
  else if (command === "static-only") runPhase("static");
  else if (command === "db" || command === "server") runPhase(command);
  else if (command === "verify-phase" && rest.length === 1) verifyPhase(rest[0]);
  else if (command === "verify-recovery" && rest.length && rest.every(name => recoverySuites.has(name)))
    verifyPhase("recovery", rest);
  else if (command === "recovery") {
    if (rest[0] !== "--" || !rest[1] || rest.slice(1).some(name => !recoverySuites.has(name)))
      throw Error("recovery runner requires the sanctioned suite paths after --");
    runPhase("recovery", rest.slice(1));
  } else if (command === "aggregate") aggregate();
  else if (command === "full") { runPhase("static"); runPhase("server"); runPhase("db"); aggregate(); }
  else throw Error("usage: gate-proof.mjs static|static-only|server|db|verify-phase PHASE|recovery -- <suite...>|aggregate|full");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`gate-proof: ${error.message}`); process.exitCode = 1; }
}
