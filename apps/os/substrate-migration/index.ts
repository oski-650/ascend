// substrate-migration — vault → Postgres, for prospects and the event spine only (Stage 2B).
//
// NOT WIRED TO ANY SURFACE. A reviewed one-shot: plan → validate → [HUMAN REVIEW] → apply → verify.
// It does not flip a reader; the vault stays authoritative until that is a separate decision.
//
// It moves prospects and events. It does NOT move clients, projects, invoices, documents or
// relationships, and it authors no event of its own.

export { planSubstrateMigration, validateManifest, renderManifest,
  type MigrationManifest, type ProspectPlan, type EventPlan, type ValidationIssue } from "./plan";
export { applySubstrateMigration, MigrationRefused, type MigrationReport } from "./apply";
export { verifySubstrateMigration, renderVerification, vaultLedger, dbLedger,
  type Verification, type Check } from "./verify";
export { buildLedger, norm, raw, LEDGER_FIELDS, EMPTY_EQUALS_ABSENT, type Ledger } from "./ledger";
