// core/db — the shared operational substrate (docs/STAGE2-MULTIUSER-ARCHITECTURE.md, Stage 2A).
//
// SUBSTRATE ONLY. No importer, no research engine, no sales UI, no migration of live data. This
// layer exists so those stages have somewhere correct to be built, and so the guarantees Stages 0.5
// and 1 won with tests can be re-expressed as constraints the database will not let anyone break.
//
// NOT WIRED TO ANY SURFACE YET. The vault remains authoritative for every entity; Stage 2B verifies
// parity before anything reads from here.

export { asPrincipal, type SqlClient, type DbPrincipal, type QueryResult, type SqlValue } from "./client";
export {
  SUPABASE_ROOT_2021_CA, SUPABASE_ROOT_2021_CA_SHA256, verifiedTlsOptions, anchorValidTo,
  assertNodeTlsNotDisabled, TlsConfigurationError,
} from "./tls";
export {
  createPool, connectionConfigFor, databaseUrlFor, adaptPoolClient, withConnection,
  tlsSocketOf, assertVerifiedTls, chainRootOf, DatabaseUrlError, type DbEndpoint,
} from "./pool";
export {
  MIGRATIONS, loadMigrations, applyMigrations, schemaDir, checksum,
  ledgerStatus, currentVersion, backfillLedger, verifyChecksums, MigrationAlreadyApplied,
  type Migration, type AppliedMigration, type LedgerRow, type BackfillEntry,
} from "./migrate";
export {
  provisionAppLogin, describeAppLogin, APP_LOGIN_ROLE, ASSUMABLE_ROLES, ProvisioningError,
  type AppLoginAttributes,
} from "./provision";
export {
  dumpSnapshot, restoreSnapshot, digestOf, BACKED_UP_TABLES, RestoreError,
  type Snapshot, type TableSnapshot,
} from "./backup";
export { appendEvent, readEvents, countOperatorBusinessEvents, type EventFilter } from "./events";
export {
  listProspects, listHeldProspects, findByProspectId, findCorroborating,
  createProspect, assessWebsiteOpportunity,
  type ProspectRow, type CreateProspectInput,
} from "./prospects";
export { createOrganization, createUser, addMembership, membershipFor } from "./organizations";
