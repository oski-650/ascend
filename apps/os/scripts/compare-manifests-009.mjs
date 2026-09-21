#!/usr/bin/env node --experimental-strip-types
// D1b.2 · THE §8 DELTA CHECK — compare the pre-009 and post-009 recovery manifests.
//
//   node --experimental-strip-types scripts/compare-manifests-009.mjs "$PWD" \
//     ~/AscendBackups/ascend-backup-20260919T120457Z-r1b.ascbk \
//     ~/AscendBackups/ascend-backup-20260920T104952Z-post-009.ascbk
//
// R1b and R1c each prove a restore equals the manifest ITS OWN artifact recorded. Neither says what
// changed BETWEEN two recovery points. This does, against the frozen permitted list in
// docs/DEPENDENCY-D1B2-EXECUTION-CONTRACT.md §8: every permitted key must move, and nothing else may.
//
// Both artifacts are decrypted IN MEMORY by `core/recovery/artifact.ts`'s own `open()`; no plaintext is
// written anywhere. It prints key names, changed/unchanged, and integer values only — never a digest
// value, which R1 abort condition A7 forbids.
//
// The list carries two keys added post-hoc by owner authorization (a witnessed enumeration defect,
// recorded in §8): `F3.rows.schema_migrations` and `F4.digest.schema_migrations`, the ledger table's
// own row count and digest, which move for the same reason `F17.ledger` does.
import { readFileSync } from "node:fs";
import path from "node:path";
const [APP, OLD, NEW] = process.argv.slice(2);
const A = await import(path.join(APP, "core/recovery/artifact.ts"));
const man = (file) => {
  const env = readFileSync(file);
  const h = A.readHeader(env);
  const { files } = A.open(env, A.keyForId(h.keyId));
  const m = files.find((f) => f.name === "source-manifest.tsv");
  if (!m) throw new Error("no source-manifest.tsv in " + path.basename(file));
  const out = new Map();
  for (const line of m.bytes.toString("utf8").split("\n")) {
    const i = line.indexOf("\t"); if (i < 0) continue;
    out.set(line.slice(0, i), line.slice(i + 1));
  }
  return { keyId: h.keyId, out };
};
const a = man(OLD), b = man(NEW);
const PERMITTED = new Set([
  "F2.columns.count","F2.columns.digest","F4.digest.prospects","F4.held.digest",
  "F5.constraints.count","F5.constraints.digest","F5.indexes.count","F5.indexes.digest",
  "F11.policies.digest","F13.grants.columns.count","F13.grants.columns.digest","F17.ledger",
  // Added post-hoc, owner-authorized: witnessed enumeration defect — the same ledger mutation as F17.
  "F3.rows.schema_migrations","F4.digest.schema_migrations",
]);
const isInt = (v) => /^-?\d+$/.test(v ?? "");
const keys = [...new Set([...a.out.keys(), ...b.out.keys()])].sort();
let unexpected = 0, permittedMoved = 0, permittedStill = 0, same = 0;
console.log(`old key id ${a.keyId} · new key id ${b.keyId} · keys ${a.out.size} → ${b.out.size}\n`);
for (const k of keys) {
  const va = a.out.get(k), vb = b.out.get(k);
  if (va === undefined || vb === undefined) { unexpected++; console.log(`  UNEXPECTED ${k.padEnd(32)} ${va === undefined ? "ADDED" : "REMOVED"}`); continue; }
  const moved = va !== vb;
  const shown = isInt(va) && isInt(vb) ? `${va} → ${vb}` : (moved ? "changed" : "unchanged");
  if (moved && PERMITTED.has(k)) { permittedMoved++; console.log(`  permitted  ${k.padEnd(32)} ${shown}`); }
  else if (moved) { unexpected++; console.log(`  UNEXPECTED ${k.padEnd(32)} ${shown}`); }
  else if (PERMITTED.has(k)) { permittedStill++; console.log(`  (listed, did not move) ${k.padEnd(20)} ${shown}`); }
  else same++;
}
console.log(`\nunchanged (not on the permitted list): ${same}`);
console.log(`permitted and moved: ${permittedMoved} · permitted but unmoved: ${permittedStill}`);
console.log(`UNEXPECTED deltas: ${unexpected}`);
process.exit(unexpected === 0 ? 0 : 1);
