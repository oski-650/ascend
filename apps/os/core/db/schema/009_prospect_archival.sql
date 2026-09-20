-- Ascend OS · prospect ARCHIVAL (Dependency D1b.1)
--
-- NOT APPLIED TO PRODUCTION BY THIS FILE. Like 007 and 008, applying it is a further authorization
-- that writing it does not carry. D1b.2 owns the production application, the new recovery artifact
-- and the R1b/R1c re-proof. See docs/DEPENDENCY-D1B-CONTRACT.md §11.
--
-- ─── WHAT THIS REPLACES ────────────────────────────────────────────────────────────────────────
--
-- D1a left Postgres-mode deletion REFUSED, with a truthful 409 naming this migration. The refusal
-- was correct and the reason is in `008_prospect_notes_log.sql`: `prospect_notes.prospect` carries
-- `ON DELETE CASCADE`, so `DELETE FROM prospects` destroys every note a human wrote about that
-- business. The shortest path to "deletion works again" was also the one that destroys sales
-- history, and it was not taken.
--
-- ARCHIVAL is the operation that was actually wanted: the row stays, its identity stays, its notes
-- stay, its events stay, and it leaves the operator's working list. An UPDATE cannot cascade.
--
-- ─── ABSENCE STAYS ABSENCE ─────────────────────────────────────────────────────────────────────
--
-- Both columns are nullable with NO default, for the reason 002 gives for five columns and 001 gives
-- for `status` and `website_quality`: an unarchived row states NOTHING about archival, and a default
-- would make a claim on behalf of 3,108 rows that nobody archived.
--
-- ─── MEASURED BEFORE WRITING ───────────────────────────────────────────────────────────────────
--
-- One authorized read-only aggregate against production, 2026-09-20 (counts only; no names, ids or
-- row contents): 3,108 prospects — 3,106 anchored, 2 held; 1 closed-won, 0 closed-lost, 0 without a
-- status; 6 with a slug; 0 prospect_notes rows; 1 user; ledger head exactly
-- `008_prospect_notes_log.sql`. So this migration backfills nothing, and there is no row value that
-- can make it ambiguous: the CHECK below reads `(NULL IS NULL) = (NULL IS NULL)` for every existing
-- row, and an FK does not check NULLs.
--
-- ─── NAMING, BECAUSE grep WILL FIND BOTH ───────────────────────────────────────────────────────
--
-- `cognition/contract.ts` also has an `archived` state, and says of it: "not historical archival, not
-- deletion, not retirement". That is a COGNITIVE state on an association and is unrelated to this.
-- Two senses, two layers, no interaction.

ALTER TABLE prospects
  ADD COLUMN archived_at timestamptz,
  -- NO `ON DELETE` CLAUSE, DELIBERATELY. `ON DELETE SET NULL` would erase the attribution on a fact
  -- that survives, which is the provenance failure this schema refuses everywhere else; CASCADE
  -- would delete a business because a user record went away. Plain NO ACTION matches `assessed_by`,
  -- `assigned_to`, `created_by`, `events.actor_user_id` and `prospect_notes.author_user_id` — five
  -- existing precedents, all of them the same shape. It is also not a practical constraint: 005 added
  -- `disabled_at` precisely so users are DISABLED rather than deleted, and no code path deletes one.
  ADD COLUMN archived_by uuid REFERENCES users(id);

-- A judgment carries its author or it is not recorded — `assessment_has_provenance`, one constraint
-- over, applied to the same question. Without this a future code path can archive anonymously and
-- the row will accept it, leaving "who removed this business from the hit list?" unanswerable.
--
-- There is no system or automation archival path (no such role holds a grant below), so there is no
-- legitimate case where `archived_at` is set with a NULL actor. A future automated retention policy
-- adds a column STATING the policy; it does not relax this.
ALTER TABLE prospects ADD CONSTRAINT archival_has_provenance CHECK (
  (archived_at IS NULL) = (archived_by IS NULL)
);

-- The active set — the predicate every sales-facing reader now carries.
--
-- HONEST ABOUT WHAT THIS BUYS TODAY: nothing measurable. At 3,108 rows the planner sequential-scans
-- `prospects` whatever indexes exist, and `prospects_org_idx` is presumably unused for the same
-- reason. This is here because it is the index the active reader needs at 50,000 rows, and it costs
-- milliseconds to build and near-nothing to maintain. It is NOT here because a measurement demanded
-- it, and claiming otherwise would be an unevidenced performance claim.
--
-- PLAIN `CREATE INDEX`, NOT `CONCURRENTLY`: `applyMigrations` runs every migration inside a
-- transaction (core/db/migrate.ts), and CONCURRENTLY cannot run in one. At this size the brief SHARE
-- lock is the cheaper trade anyway. The next person to index a large table should read this first.
CREATE INDEX prospects_org_active_idx ON prospects (organization_id)
  WHERE archived_at IS NULL;

-- ─── Grants: two columns, and nothing else ─────────────────────────────────────────────────────
--
-- 2G.4.7 moved `prospects:identity` to the sales partner on purpose ("a partner may delete a
-- prospect"), but the database gave sales no DELETE and no archive column to write. The capability
-- layer and the database layer disagreed. THIS IS THAT RESOLUTION — and it resolves it in the
-- direction of least privilege: sales gains exactly the two columns the bounded operation sets.
--
-- Sales already holds UPDATE (updated_at) from 001, which the archival statement also sets, so no
-- third column is needed.
GRANT UPDATE (archived_at, archived_by) ON prospects TO ascend_sales;

-- `ascend_owner` needs NOTHING here: its grant from 001 is TABLE-level UPDATE, which covers every
-- column the table will ever have. That is the same property 005 called "a trap" for `users` and
-- fixed there by revoking the table grant. It is NOT fixed here — `prospects` still has it — and
-- the consequence is stated rather than discovered later: sales' table-level SELECT from 001 also
-- makes both new columns readable with no explicit grant. For archival state that is harmless and
-- intended (the UI shows it); it is recorded so the asymmetry between the roles is deliberate.
--
-- `ascend_automation` is granted NOTHING here, deliberately. There is no automated archival path,
-- and a research runner that could remove businesses from the hit list is not a capability anyone
-- asked for. This is the same construction 001 used to withhold `website_opportunity` and 002 used
-- to withhold the qualification fields: the absence IS the mechanism.

-- ─── The sales UPDATE policy, tightened in ONE direction only ──────────────────────────────────
--
-- THE TRAP, WRITTEN DOWN SO IT IS NOT RE-ENTERED. The obvious tightening is to add
-- `archived_at IS NULL` to BOTH halves of this policy. That makes archival STRUCTURALLY IMPOSSIBLE
-- for the role it is being built for:
--
--   USING      is evaluated against the OLD row  → archived_at IS NULL → passes
--   WITH CHECK is evaluated against the NEW row  → archived_at IS SET  → REFUSED, always
--
-- Every sales archive would fail as a zero-row update, which the application would report as a
-- generic refusal. So the predicate goes in USING and NOT in WITH CHECK, and what the pair now says
-- is exactly what is meant:
--
--   sales may write any anchored, UNARCHIVED row, and archiving it is the LAST write sales makes.
--
-- A second archive attempt fails USING, changes zero rows, and is disambiguated to `already_archived`
-- by reading the row back. Un-archival by sales becomes impossible, which is correct: D1b defines no
-- un-archive verb, and `ascend_owner` (FOR ALL, unchanged below) retains the ability to reverse one.
--
-- HELD ROWS ARE UNCHANGED AND STILL REFUSED FOR SALES. `identity_state = 'anchored'` stays in both
-- halves, so a held prospect is not archivable by a sales principal — owner decision 2, and the
-- existing P3 policy carried forward rather than reinvented.
--
-- LOCK NOTE: DROP POLICY / CREATE POLICY takes ACCESS EXCLUSIVE on `prospects` — the same hazard 007
-- documented for `invitations`. At 3,108 rows and single-operator traffic the window is
-- sub-millisecond, and both DDL steps are atomic with the rest of this file.
DROP POLICY prospects_update_sales ON prospects;
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING      (organization_id = current_org() AND identity_state = 'anchored'
              AND archived_at IS NULL)
  WITH CHECK (organization_id = current_org() AND identity_state = 'anchored');

-- `prospects_read` is NOT changed, and that is load-bearing. Archived rows stay SELECT-visible to
-- every role, for the same reason 001 gives for held ones: "a hold is a WRITE barrier, not an
-- information barrier". The identity matcher must SEE an archived business or it will classify an
-- import row for it as `new` and create a duplicate — the failure that "creates a third Tapia
-- record", one state over. Exclusion is a READER decision (core/db/prospects.ts), never an RLS one.
--
-- `prospects_write_owner` is NOT changed either: the owner keeps FOR ALL on archived rows, which is
-- what makes any future correction possible without a new grant.

COMMENT ON COLUMN prospects.archived_at IS
  'When this prospect left the active hit list. NULL means ACTIVE — not "never archived", which '
  'would be a claim. Archival destroys nothing: the row, its notes column, its prospect_notes log '
  'and its events all survive, because archival is an UPDATE and only DELETE cascades.';
COMMENT ON COLUMN prospects.archived_by IS
  'The human who archived it, always (archival_has_provenance). Never a system or automation actor: '
  'no such role holds a grant on this column, so an anonymous archival is not representable.';
