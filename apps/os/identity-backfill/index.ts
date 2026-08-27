// identity-backfill — the prospect identity backfill (docs/STAGE1-PROSPECT-IDENTITY.md).
//
// NOT WIRED TO ANY SURFACE. A one-shot tool, run deliberately against a snapshot, reviewed, then
// against the live vault as a separate decision — the same posture as `migration/` and `onboarding/`.
//
//   snapshot → plan → validate → [HUMAN REVIEW] → apply → verify
//   ─────────────────────────────                 ─────────────────
//   read only, no write path                      requires { confirm: true }
//
// IT RECORDS A NAME, NOT A HISTORY. Writing `prospect_id` establishes "this file represents this
// stable identity" and asserts nothing about when the prospect was created, whether it was
// contacted, whether it has a website, or whether anyone assessed one. It emits no event, because
// naming a thing is not something that happened to the business.

export {
  snapshotHitList,
  sha256,
  withoutIdentityLine,
  type HitListSnapshot,
  type ProspectSnapshot,
  type IdentityFields,
} from "./snapshot";
export { DECLARED_HOLDS, declaredHoldFor, type DeclaredHold } from "./holds";
export {
  planIdentityBackfill,
  validateIdentityManifest,
  renderIdentityManifest,
  type IdentityBackfillManifest,
  type IdentityBackfillEntry,
  type IdentityDecision,
  type ValidationIssue,
} from "./plan";
export {
  applyIdentityBackfill,
  IdentityBackfillRefused,
  type IdentityBackfillReport,
} from "./apply";
export {
  verifyIdentityBackfill,
  renderVerification,
  countOperatorBusinessEvents,
  type IdentityVerification,
  type Check,
} from "./verify";