// migration — the one-shot historical backfill (docs/HISTORICAL-BACKFILL-H5.md).
//
// NOT WIRED TO ANY SURFACE, and must not be. This is an operational tool run deliberately against a
// vault snapshot, reviewed, and only then run against the real vault as a separate decision. No
// route, server action, or engine may import it.
//
// The pipeline, and the boundary in the middle of it:
//
//   plan  →  validate  →  [HUMAN REVIEW]  →  apply  →  baseline  →  verify
//   ────────────────────                     ──────────────────────────────
//   reads only, no writes                    requires { confirm: true }
//
// Bay Area Custom Shirts is excluded by decision, not oversight — see evidence.DECLARED_EXCLUSIONS.

export { planMigration } from "./plan";
export { validateManifest, type ValidationIssue } from "./validate";
export { applyMigration, type ApplyReport } from "./apply";
export { verifyMigration, countOperatorBusinessEvents, type VerificationResult } from "./verify";
export {
  buildManifest,
  renderManifest,
  sortEntries,
  baselineTargetsOf,
  entryKey,
  type Manifest,
  type ManifestEntry,
  type Classification,
  type Disposition,
  type Confidence,
  type EntityRef,
} from "./manifest";
export {
  FIELD_REGISTRY,
  recordOnlyFacts,
  rulesFor,
  type FieldRule,
} from "./registry";
export {
  DECLARED_SUBJECTS,
  DECLARED_EXCLUSIONS,
  TEST_SESSIONS,
  SOURCE_PRECEDENCE,
  SYNTHETIC_DURATION_CEILING_SECONDS,
} from "./evidence";