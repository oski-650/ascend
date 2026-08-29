-- 004 — THE MIGRATION LEDGER.
--
-- Until now the database could not say what had been done to it. "Which migrations are applied?"
-- was answered by introspection and by a gate report — that is, by a human holding two documents
-- side by side. This table lets the database answer for itself.
--
-- IT DOES NOT MAKE MIGRATIONS RE-RUNNABLE, and that is deliberate. A ledger is often introduced
-- alongside "skip anything already applied", which quietly converts a second run from an ERROR into
-- a no-op. That is the wrong trade for this system: a migration re-applied silently is how a schema
-- and its recorded history stop agreeing, and the disagreement is invisible until something else
-- depends on it. `applyMigrations` REFUSES a recorded version rather than skipping it.
--
-- CHECKSUMS EXIST BECAUSE FILES GET EDITED. Recording only the filename would let someone change
-- `001_substrate.sql` after it had been applied and leave no trace: the ledger would still say
-- "001 applied", while the file on disk described a schema the database had never had. The checksum
-- is what makes that detectable.
--
-- `applied_at_is_backfilled` IS A PROVENANCE FLAG, not bookkeeping noise. Migrations 001–003 were
-- applied BEFORE this table existed, so their timestamps were reconstructed from a gate artifact
-- rather than observed by the ledger at the moment of writing. A reconstructed timestamp and an
-- observed one are different KINDS of fact, and the system's standing rule is that it may not
-- present one as the other. Rows written by `applyMigrations` from here on carry `false`.
--
-- NOT TENANT DATA. This table has no `organization_id` and no policy granting the application any
-- access: `ascend_owner`, `ascend_sales` and `ascend_automation` receive no grant, so the
-- application cannot read it and cannot write it. It is operational metadata belonging to whoever
-- administers the database.

CREATE TABLE schema_migrations (
  version      text PRIMARY KEY,
  -- WHEN the migration was applied. Read together with the flag below, never on its own.
  applied_at   timestamptz NOT NULL DEFAULT now(),
  -- WHO applied it, as the database saw them.
  applied_by   text NOT NULL DEFAULT current_user,
  -- sha256 of the file AS APPLIED. A later edit to the file makes this disagree, loudly.
  checksum     text NOT NULL,
  -- TRUE  → `applied_at` was reconstructed after the fact; it bounds the event, it did not witness it.
  -- FALSE → `applied_at` was recorded by the ledger at the moment of application.
  applied_at_is_backfilled boolean NOT NULL DEFAULT false,
  -- Free-text provenance for backfilled rows: where the reconstructed timestamp came from.
  note         text,

  CONSTRAINT backfilled_rows_state_their_source CHECK (
    applied_at_is_backfilled = false OR note IS NOT NULL
  )
);

COMMENT ON TABLE schema_migrations IS
  'Applied schema migrations. Forward-only: a recorded version is refused, never silently skipped.';
COMMENT ON COLUMN schema_migrations.applied_at_is_backfilled IS
  'TRUE means applied_at was RECONSTRUCTED after the fact, not witnessed. Do not read it as an observation.';

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations FORCE ROW LEVEL SECURITY;

-- No policies and no grants: default deny for every role that is not the owner. The application has
-- no business reading the migration history, and saying so with an absent grant is stronger than
-- saying it with a policy.
