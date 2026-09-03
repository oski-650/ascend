// tests/architecture/gate-2g1 — THE FINAL 2G.1 GATE MANIFEST.
//
// ─── WHAT THIS IS, AND WHAT IT REFUSES TO BE ───────────────────────────────────────────────────
//
// 2G.1 closes by INTEGRATING evidence, not by adding behaviour. This file is the declared inventory
// of every suite in the repository and what each one is worth as evidence for that closure.
//
// It exists because of a mistake made during slice 5: a suite whose `beforeAll` THREW was read as
// "skipped", because vitest prints a failed suite's tests the same way it prints a genuinely gated
// one — and the misreading survived two sessions and reached the contract, the ledger and memory.
//
//   > A filtered test run is not a test result. "Skipped" and "the suite threw in beforeAll" print
//   > the same count.
//
// So the classification is DECLARED here and CHECKED by `gate-2g1.test.ts`, which fails closed: a
// suite claimed PROVEN whose environment gate is unset fails the gate rather than passing quietly.
//
// ─── THE FIVE CLASSES, AND WHY THE DISTINCTION IS THE POINT ────────────────────────────────────
//
//   PROVEN          an executed, controlled proof — it ran, in this run, with a discriminating
//                   control that can go red
//   OBSERVED        production behaviour is consistent with the property, WITHOUT a control in the
//                   loop. Never promoted to PROVEN because the system looks healthy
//   BLOCKED         infrastructure prevented execution. Recorded, never silently counted as a pass
//   PARKED          a known finding or act deliberately deferred to a later layer
//   NOT_APPLICABLE  the property does not belong to this layer
//
// A healthy production server produces OBSERVED facts. It never produces PROVEN ones.

export type Evidence = "PROVEN" | "OBSERVED" | "BLOCKED" | "PARKED" | "NOT_APPLICABLE";

/**
 * WHEN a proof runs. Two independently MEASURED constraints forced this (§26.6, §26.7):
 *
 *   A · the server phase writes probe routes into `app/`, which static scans (F41, F51, F54) see
 *       if they run concurrently — measured as three architecture failures
 *   B · the server phase's Turbopack compilation burst starves real network round-trips, which
 *       time out at Vitest's 5s default — measured, and cleared of any database cause
 *
 * These are HARNESS CONSTRAINTS, not implementation defects. Nothing collides; the phases simply
 * cannot share a machine.
 *
 *   > The manifest says what a proof requires; the scripts enforce when that proof runs.
 */
export type Phase = "static" | "server" | "db";

export type GateEntry = {
  readonly evidence: Evidence;
  /** Which phase must run this suite. Checked against the file's directory AND its behaviour. */
  readonly phase: Phase;
  /** Why this classification. Required for every entry — an unexplained class is not evidence. */
  readonly why: string;
  /**
   * Environment variables the suite needs in order to RUN.
   *
   * Load-bearing rather than documentation: the gate asserts that every PROVEN entry's variables are
   * present in the run making the claim. Presence only — never values (see the credential incident).
   */
  readonly requires?: readonly string[];
};

/**
 * EVERY test file in the repository. Totality, in the shape F49 uses for routes and F51 for pages:
 * a suite with no entry is an ERROR, not an implicit pass, and an entry naming no file means the
 * manifest is describing a repository that moved on.
 */
export const GATE_2G1: Record<string, GateEntry> = {
  "tests/api/invitations-mint.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 \u00a728.4/\u00a728.13 \u2014 the minting route: unauthenticated 401, sales 403, owner 201, malformed id 400; a non-member is refused BY THE ATOMIC INSERT \u2026 SELECT predicate \u2014 the statement executes and inserts zero rows" },
  "tests/api/route-matrix.test.ts": { evidence: "PROVEN", phase: "static", why: "2F 7.4 — all 27 routes, both roles, double denial" },
  "tests/api/search-boundary.test.ts": { evidence: "PROVEN", phase: "static", why: "scoped at assembly, with the unscoped mutation control" },
  "tests/api/threat-model.test.ts": { evidence: "PROVEN", phase: "static", why: "STAGE2F §11 threat model, demonstrated through real handlers" },
  "tests/architecture/f51-page-demand.test.ts": { evidence: "PROVEN", phase: "static", why: "F51 — declared == observed capability demand, 31/31" },
  "tests/architecture/f56-nav-contract.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 F56 — every nav destination is a classified page and `requires` equals the page contract exactly" },
  "tests/architecture/fitness.test.ts": { evidence: "PROVEN", phase: "static", why: "F1-F50, F52, F54/F55, F58 — machine-enforced rules incl. the invite-separation invariant" },
  "tests/intake/projection.test.ts": { evidence: "PROVEN", phase: "static", why: "Stage 2 Sheets 2C \u2014 \u00a71.4's three blank-cell states as a pure mapping: a present-but-blank website never becomes website_quality none, closed vocabularies are validated rather than guessed, an unrecognised boolean is UNSTATED not false, and no projection can carry a judgment field" },
  "tests/intake/batch.test.ts": { evidence: "PROVEN", phase: "static", why: "Stage 2 Sheets 2A \u2014 the intake foundation: verbatim parsing proven AGAINST lib/csv's trimming as the discriminating witness, \u00a71.4's absent-column vs empty-cell distinction, and \u00a71.2's rule that re-importing the same bytes is a new batch with the same file_sha256" },
  "tests/auth/authority-classification.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.4.5 \u00a729.3 Ruling 3 \u2014 every PageDenial reaches requireCapability as the contracted class, both directions per row, with compiler-enforced totality over the union" },
  "tests/auth/dal-boundary.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 2a/2b — all eight storage boundaries refuse an unauthorized caller" },
  "tests/auth/dal-mutation-gate.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 2c — a module-level principal leaks observably under barrier-proven overlap" },
  "tests/auth/index-scoping.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 4 — C1/C2 closed at the filesystem: sales opens zero client/SOP files" },
  "tests/auth/landing.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 \u00a728.6/\u00a728.12 \u2014 the landing DECISION and the login JOURNEY: a sales credential signs in and is routed to /partner" },
  "tests/auth/nav-visibility.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 \u00a728.7/\u00a728.12 \u2014 the rail a partner actually sees, with authority established explicitly and a non-empty control" },
  "tests/auth/nav-boundary.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 F57 — every destination hidden from sales refuses sales on a DIRECT render, with a visible-destination control" },
  "tests/auth/page-denial.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 3 — denial classified server-side by type; notFound/redirect survive" },
  "tests/auth/page-principal.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 1 — the React.cache page resolver and its 22 refusal directions" },
  "tests/auth/portal-token-boundary.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.1 slice 2d — a client token reaches only its own client" },
  "tests/auth/request-context.test.ts": { evidence: "PROVEN", phase: "static", why: "7.2 the request-context trust boundary, and the prospect seam's unit proof with its control" },
  "tests/auth/session-v2.test.ts": { evidence: "PROVEN", phase: "static", why: "the session token carries no role and cannot be edited into authority" },
  "tests/cognition/cooccurrence.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/cognition/plasticity.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/cognition/propagation.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/cognition/utility-harness.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  // The ONLY suite in the repository with a file-scoped DOM environment; the project default stays
  // `node`. It mounts the real client component and drives it — §28.12's "presence is not behaviour".
  "tests/ui/invite-panel.test.ts": { evidence: "PROVEN", phase: "static", why: "2G.3 \u00a728.4/\u00a728.12 \u2014 the owner mints THROUGH THE UI: selection, request shape, link, clipboard, refusals" },
  "tests/db/backup-restore.test.ts": { evidence: "PROVEN", phase: "db", why: "2D.2 recovery — a production backup is taken, restored and verified row-for-row", requires: ["ASCEND_TEST_DATABASE_URL"] },
  "tests/db/consumer-parity.test.ts": { evidence: "PROVEN", phase: "db", why: "substrate/consumer behaviour exercised in-process against PGlite" },
  "tests/db/intake-second-import.test.ts": { evidence: "PROVEN", phase: "db", why: "Stage 2 Sheets 2E \u2014 all seven \u00a77.3(d) cases against a real Postgres, each asserting the NEGATIVE the contract forbids: unchanged is not suppressed, changed does not rewrite batch 1 (compared whole as JSON), ABSENT IS NOT DELETED and not even marked, duplicate and conflict keep their evidence with prospect_id null, and a re-import leaves an existing judgment and its author intact with a non-vacuity control proving the batch did record something" },
  "tests/db/intake-identity.test.ts": { evidence: "PROVEN", phase: "db", why: "Stage 2 Sheets 2D \u2014 \u00a72.1's five outcomes with discriminating witnesses: BLOCKED proven to be evaluated FIRST by a row corroborating a held record AND an anchored one, so only the ORDER decides (P4's collapse); name-alone rejected with a name+locality control; a duplicate within one sheet resolves to matched; evidence survives every refusal with prospect_id null" },
  "tests/db/intake-projection.test.ts": { evidence: "PROVEN", phase: "db", why: "Stage 2 Sheets 2C \u2014 ASCEND FOUND through the EXISTING writer: prospect.created firing is the discriminating witness that core/db.createProspect was used rather than a bespoke INSERT; unprojected rows keep their evidence with prospect_id null; re-import leaves the first batch byte-identical; judgment columns asserted NULL with a non-vacuity control" },
  "tests/db/intake-evidence.test.ts": { evidence: "PROVEN", phase: "db", why: "Stage 2 Sheets 2B \u2014 THE SHEET SAID as append-only events against a real Postgres: verbatim cells survive jsonb, a second import adds evidence and leaves the first byte-identical, correlation_id partitions the batches, append-only asserted at the GRANT catalog rather than by the absence of an update path, and ordering proven with event_ids CONSTRUCTED to contradict append order" },
  "tests/db/invitations.test.ts": { evidence: "PROVEN", phase: "db", why: "F53 (2G.2) \u2014 invitation tokens hashed, single-use and atomic; least privilege proven by GRANT" },
  // 2G.2 operational gates. ONE-SHOT and production-mutating, so they classify the way 2D/2D.1/2E's
  // migration gates do: their evidence is the waypoint that recorded them (a6f4068), not a re-run.
  "tests/db/production-2g4-007.test.ts": { evidence: "PARKED", phase: "db", why: "the 007 production gate \u00a728.14 item 7 called REQUIRED and UNBUILT \u2014 applies the FILTERED 007 to production over the direct endpoint, then proves what the server enforces: the composite FK with ON DELETE RESTRICT, the recreated INSERT policy with both conjuncts, and three rolled-back behavioural witnesses gathered AS ascend_owner rather than as the superuser the migration excludes", requires: ["ASCEND_MIGRATE_007_URL"] },
  "tests/db/production-2g4-credential-read.test.ts": { evidence: "PARKED", phase: "db", why: "2G.4.6 \u00a729.3 Ruling 5 \u2014 row 11's production half, split out of production-2f-partner as a read-only rollback-scoped probe against the POOLER, with an ascend_auth control. Built and NEVER EXECUTED: withheld pending \u00a729.11 Q2, which is a decision and not an obstacle", requires: ["ASCEND_CREDENTIAL_PROBE_URL"] },
  "tests/db/production-2g2-invitations.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "one-shot; applied 006 to production; its read-only verification half is re-runnable on demand" },
  "tests/db/production-2g2-provision.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "one-shot; re-provisioned ascend_app; SET ROLE proof re-runnable on demand" },
  // EXECUTED 2026-08-30 under explicit authorization. Classified like every other one-shot
  // production gate: its evidence is the WAYPOINT that recorded it, not a re-run. PROVEN would be
  // wrong here and the gate would say so — PROVEN means "ran in THIS run", and this suite skips
  // without its two variables.
  "tests/db/production-2g2-acceptance.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "one-shot; rollback-scoped acceptance EXECUTED against production and passed 2026-08-30 \u2014 \u00a727.17; evidence is the waypoint 07e7f45", requires: ["ASCEND_ACCEPT_TEST_URL", "ASCEND_ACCEPT_VERIFY_URL"] },
  "tests/db/savepoint-client.test.ts": { evidence: "PROVEN", phase: "db", why: "the savepoint adapter the acceptance gate rests on, incl. a control that it can never COMMIT" },
  "tests/db/mutation.test.ts": { evidence: "PROVEN", phase: "db", why: "substrate/consumer behaviour exercised in-process against PGlite" },
  "tests/db/page-matrix-provisioned.test.ts": { evidence: "PROVEN", phase: "db", why: "2G.4.3 §8 row 2, row 6 page-side and row 7 — 29 pages × both roles through the REAL admission chain (cookie, Next's own work/work-unit request scope, verifySessionToken, resolvePrincipal), including the admin disclosure recorded as measured fact and a revocation by a real disabled_at write, distinguished by reason from a database outage; own PGlite and vault fixture, no external endpoint; does not exercise the App Router, middleware, or React.cache memoization" },
  "tests/db/pooled-principal.test.ts": { evidence: "PROVEN", phase: "db", why: "2D — a pooled connection carries no principal between checkouts", requires: ["ASCEND_TEST_DATABASE_URL"] },
  "tests/db/production-2e-consumer-parity.test.ts": { evidence: "PROVEN", phase: "db", why: "2E consumer parity against real production, executed once IPv6 egress returned", requires: ["ASCEND_DATABASE_URL", "ASCEND_DATABASE_URL_DIRECT"] },
  "tests/db/production-2e-migration.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "2E one-shot; migrated the six prospects; evidence is 2E's waypoint", requires: ["ASCEND_MIGRATE_PROSPECTS_URL"] },
  "tests/db/production-2e-raw-parity.test.ts": { evidence: "PROVEN", phase: "db", why: "2E raw parity \u2014 vault bytes against production columns, executed once IPv6 egress returned", requires: ["ASCEND_DATABASE_URL_DIRECT"] },
  "tests/db/production-2e-source-flip.test.ts": { evidence: "PROVEN", phase: "db", why: "2E source-of-truth flip against real production, executed once IPv6 egress returned", requires: ["ASCEND_DATABASE_URL", "ASCEND_DATABASE_URL_DIRECT"] },
  "tests/db/production-2f-partner.test.ts": { evidence: "PARKED", phase: "db", why: "provisions the partner — that is 2G.2's act, deliberately not run while users = 1", requires: ["ASCEND_PROVISION_PARTNER_URL"] },
  "tests/db/production-app-login.test.ts": { evidence: "PROVEN", phase: "db", why: "the application login holds no ambient authority \u2014 executed against the DIRECT endpoint once IPv6 egress returned", requires: ["ASCEND_DATABASE_URL", "ASCEND_DATABASE_URL_DIRECT"] },
  "tests/db/production-authorization.test.ts": { evidence: "PROVEN", phase: "db", why: "RLS and column grants enforce the boundary in the database itself", requires: ["ASCEND_TEST_DATABASE_URL"] },
  "tests/db/production-hardening.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "2D.1 one-shot; writes to production; evidence is 2D.1's waypoint", requires: ["ASCEND_HARDEN_DATABASE_URL"] },
  "tests/db/production-migration.test.ts": { evidence: "NOT_APPLICABLE", phase: "db", why: "2D one-shot; writes schema to production; its evidence is 2D's waypoint", requires: ["ASCEND_MIGRATE_DATABASE_URL"] },
  "tests/db/route-matrix-provisioned.test.ts": { evidence: "PROVEN", phase: "db", why: "2G.4.2 §8 row 1 and row 6 route-side — every route \u00d7 both roles through the REAL admission chain (cookie, verifySessionToken, requireAppDb, resolvePrincipal, can), and revocation by a real disabled_at write; own PGlite and vault fixture, no external endpoint" },
  "tests/db/provisioned-partner.test.ts": { evidence: "PROVEN", phase: "db", why: "2G.4.1 §29.3 Ruling 1 — a partner reaches a resolved principal through the real chain (insert, invite, accept, login, resolve), against its own PGlite and session secret, depending on no external endpoint" },
  "tests/db/request-isolation.test.ts": { evidence: "PROVEN", phase: "db", why: "7.3 THE CRITICAL GATE — barrier-proven overlap, mutant leaks 10 crossings incl. cross-tenant rows", requires: ["ASCEND_DATABASE_URL", "ASCEND_TEST_DATABASE_URL"] },
  "tests/db/restore-independence.test.ts": { evidence: "PROVEN", phase: "db", why: "2D.2 — a backup restores without the original", requires: ["ASCEND_BACKUP_SQL"] },
  "tests/db/scale.test.ts": { evidence: "PROVEN", phase: "db", why: "substrate/consumer behaviour exercised in-process against PGlite" },
  "tests/db/substrate-migration.test.ts": { evidence: "PROVEN", phase: "db", why: "substrate/consumer behaviour exercised in-process against PGlite" },
  "tests/db/substrate.test.ts": { evidence: "PROVEN", phase: "db", why: "substrate/consumer behaviour exercised in-process against PGlite" },
  "tests/engines/approvals-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/authority-repair.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/command-runtime.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/confirm-gate.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/decision-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/document-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/effort-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/event-emission.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/health-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/identity-backfill.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/intelligence-forecast.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/intelligence-insight.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/migration.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/notification-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/notification-loop.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/onboarding.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/opportunity-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/pipeline-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/prospect-hardening.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/reconciler.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/site-quality-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/engines/sop-engine.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/graph/viewport.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/relationships/derive.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "domain/engine behaviour — not a 2G.1 authorization property" },
  "tests/render/page-isolation.test.ts": { evidence: "PROVEN", phase: "server", why: "2G.1 slice 1 — React.cache isolation under barrier-proven overlap, with a leaking mutant", requires: ["ASCEND_RENDER_TEST"] },
  "tests/render/startup-binding.test.ts": { evidence: "PROVEN", phase: "server", why: "2G.1 slice 5 — real startup binds the resolver both entry points consume; BOUND: same process only", requires: ["ASCEND_STARTUP_TEST", "ASCEND_DATABASE_URL", "ASCEND_TEST_DATABASE_URL"] },  "tests/architecture/gate-2g1.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "this gate itself — it integrates evidence and proves no property of its own" },
  "tests/architecture/gate-2g4.test.ts": { evidence: "NOT_APPLICABLE", phase: "static", why: "the 2G.4 gate itself \u2014 it integrates evidence and proves no property of its own; asserts the accounting is total and internally honest, never that anything behaves" },
};

/**
 * Properties whose only evidence is a healthy production system.
 *
 * Kept SEPARATE from the suite manifest on purpose: these have no controlled proof, and listing them
 * beside proven properties is how an observation gets promoted by proximity.
 */
export const OBSERVED_ONLY: readonly { readonly property: string; readonly why: string }[] = [
  {
    property: "the deployed build serves every prospect-reading page",
    why: "after rebuilding to 654fe56, /finance /sales /sales/<slug> /console / /crm /signals all " +
         "answer 200 with zero errors, and /finance had returned 500 before. Consistent with the " +
         "prospect bridge working in production — but no control was in the loop, so it is not proof",
  },
  {
    property: "startup binds the database at boot",
    why: "the service logs '[startup] application database bound (TLS-verified, pooled, no ambient " +
         "identity)'. Consistent with correct wiring, and equally consistent with a resolver bound " +
         "by something else — which is exactly why slice 5 built a controlled proof instead",
  },
  {
    property: "a nonexistent prospect slug returns 404 in production, not a denial or a 500",
    why: "slice 3's unstable_rethrow observed in a real build. Proven in-process; here only observed",
  },
];

/** Findings deliberately carried out of 2G.1. The gate asserts they are NOT silently fixed here. */
export const PARKED_FINDINGS: readonly { readonly finding: string; readonly owner: string }[] = [
  { finding: "admin, admin/import, admin/wipe and dashboard declare [] so a sales principal renders them (no data leaks — those routes are guarded)", owner: "2G.4" },
  { finding: "a membership revoked mid-session reaches the error boundary rather than a named surface", owner: "2G.4" },
  { finding: "discoverClients/discoverSops read the vault directly rather than through the guarded readers — an asymmetry, not an escape path", owner: "2G.4" },
  { finding: "invitation tokens hashed and single-use (F53, reserved)", owner: "2G.2" },
  { finding: "partner UI", owner: "2G.3" },
  { finding: "Sheets intake", owner: "after 2G.4" },
];
