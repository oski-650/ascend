// migration/validate — THE GATE BETWEEN A PLAN AND A MUTATION.
//
// A manifest that fails validation may not be applied. These are structural checks over the plan
// itself, not a re-derivation of it: they catch a classifier that produced something incoherent,
// before the incoherence reaches the vault.

import "server-only";
import { entryKey, type Manifest, type ManifestEntry } from "./manifest";
import { isExcluded } from "./evidence";

export type ValidationIssue = { entry: string; problem: string };

/**
 * Structural rules the plan must satisfy:
 *
 *  1  no entry may claim a business event — the headline invariant, checked mechanically
 *  2  every entry names evidence — "a change that cannot state its evidence is a bug"
 *  3  classification and disposition must agree (synthetic removes; seeded demotes)
 *  4  no duplicate targets — two entries for one field means the plan is not deterministic
 *  5  nothing touches a declared exclusion
 *  6  a change must actually change something
 *  7  baselineTargets must match what the entries require
 */
export function validateManifest(m: Manifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (e: ManifestEntry, problem: string) => issues.push({ entry: entryKey(e), problem });

  const seen = new Set<string>();
  for (const e of m.entries) {
    // 1 — the invariant, enforced rather than trusted.
    if (e.businessEvent !== "none") {
      add(e, "proposes a business event; historical correction may never claim the business changed today");
    }
    // 2
    if (!e.evidence.trim()) add(e, "names no evidence");
    // 3
    if (e.classification === "synthetic" && e.disposition !== "removed") {
      add(e, "synthetic records are removed, never demoted — there is no underlying fact to be uncertain about");
    }
    if (e.classification === "seeded" && e.disposition === "known") {
      add(e, "seeded data can never become known");
    }
    if (e.disposition === "removed" && e.proposedValue !== null) {
      add(e, "removal must propose a null value");
    }
    // 4
    const k = entryKey(e);
    if (seen.has(k)) add(e, "duplicate entry for the same field");
    seen.add(k);
    // 5
    if (isExcluded(e.entity.id)) add(e, "targets a declared exclusion");
    // 6
    if (e.currentValue === e.proposedValue) add(e, "proposes no change");
  }

  // 7 — the derived target set must be exactly what the entries call for.
  const required = new Set(
    m.entries.filter((e) => e.baseline === "required").map((e) => `${e.entity.kind}/${e.entity.id}`)
  );
  const declared = new Set(m.baselineTargets.map((t) => `${t.kind}/${t.id}`));
  for (const r of required) {
    if (!declared.has(r)) issues.push({ entry: r, problem: "requires a baseline but is not a baseline target" });
  }
  for (const d of declared) {
    if (!required.has(d)) issues.push({ entry: d, problem: "is a baseline target but no entry requires it" });
  }

  return issues;
}