-- 005 — PER-USER CREDENTIALS, and the role that reads them.
--
-- Credential columns only. NO authorization behaviour changes here: nothing in this migration
-- alters who may read a prospect or reach a route. That comes later in 2F, deliberately separated
-- so the first production mutation of this stage is one a reviewer can read in a minute.
--
-- ─── THE TABLE GRANT WAS A TRAP ───────────────────────────────────────────────────────────────
--
-- `users` carried a TABLE-level `GRANT SELECT` to all three application roles. A table grant covers
-- columns added later, so the instant `password_hash` existed, `ascend_sales` could read every
-- user's credential material — without anybody writing a line of code. Adding the column and
-- leaving the grant alone would have been a silent privilege escalation shipped by a migration
-- whose diff looked like "four new columns".
--
-- So the table grant is REVOKED and replaced with an explicit COLUMN list. Every future column on
-- `users` is now private by default and must be granted deliberately — the fail-closed direction.

ALTER TABLE users
  ADD COLUMN password_hash   text,
  ADD COLUMN password_algo   text,
  ADD COLUMN password_set_at timestamptz,
  ADD COLUMN disabled_at     timestamptz;

-- A credential is whole or absent. A half-set credential is the state in which "can this person log
-- in?" has no answer, and the answer to an authentication question may never be "it depends".
ALTER TABLE users ADD CONSTRAINT credential_is_whole CHECK (
  (password_hash IS NULL) = (password_set_at IS NULL)
  AND (password_hash IS NULL) = (password_algo IS NULL)
);

COMMENT ON COLUMN users.password_hash IS
  'KDF output, never a password and never reversible. Readable ONLY by ascend_auth.';
COMMENT ON COLUMN users.password_algo IS
  'The KDF actually used for this row, so an algorithm can be rotated per user rather than globally.';
COMMENT ON COLUMN users.disabled_at IS
  'Immediate revocation without deleting the person. A disabled user fails authentication even '
  'holding a valid unexpired session, because principal resolution runs per request.';

-- ─── Column-scoped grants replace the table grant ─────────────────────────────────────────────

REVOKE SELECT ON users FROM ascend_owner, ascend_sales, ascend_automation;

-- What the application legitimately needs: who someone is, not how they prove it.
GRANT SELECT (id, email, display_name, created_at, disabled_at)
  ON users TO ascend_owner, ascend_sales, ascend_automation;

-- ─── ascend_auth — the ONLY role that may read credential material ────────────────────────────
--
-- A fourth DATABASE role. It is not a fourth membership role: `memberships.role` remains exactly
-- ('owner','sales'), and this changes nothing a human can be. `ascend_auth` is infrastructure, in
-- the same sense as `ascend_automation` — a principal for one job, holding the minimum to do it.
--
-- WHY IT MUST EXIST. Principal resolution is a chicken-and-egg problem: to learn which organization
-- and role a user has, something must read `memberships` — but the application roles' policies key
-- on `current_org()`, which is the value being resolved. Every application role is therefore
-- structurally unable to answer "who is this?". `ascend_auth` answers it, and can do nothing else:
-- it holds no grant on prospects, events, or organizations.
--
-- RESIDUAL RISK, STATED PLAINLY. `ascend_app` can assume this role, so SQL injection reaching the
-- database as `ascend_app` could read password hashes. That exposure is inherent — the application
-- must verify passwords somehow — and is bounded by the hashes being memory-hard KDF output, which
-- yields no password and cannot be replayed as one. F48 confines which source files may reference
-- these columns so the reachable surface stays one directory.

DO $$ BEGIN
  CREATE ROLE ascend_auth NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO ascend_auth;
GRANT SELECT (id, email, display_name, disabled_at, password_hash, password_algo, password_set_at)
  ON users TO ascend_auth;
GRANT SELECT ON memberships TO ascend_auth;

-- RLS is FORCED on both tables and every existing policy keys on `current_org()`, which the auth
-- path does not yet have. These policies are scoped TO ascend_auth alone, so widening them cannot
-- widen anything an application role sees.
CREATE POLICY auth_reads_users ON users
  FOR SELECT TO ascend_auth USING (true);
CREATE POLICY auth_reads_memberships ON memberships
  FOR SELECT TO ascend_auth USING (true);

-- Deliberately absent: any INSERT, UPDATE or DELETE for ascend_auth. It authenticates; it never
-- writes. Setting a credential is an administrative act performed over the direct connection.
