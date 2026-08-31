-- 006_invitations — THE FIRST INTENTIONALLY UNAUTHENTICATED WRITE PATH (Stage 2G.2, STAGE2G §27).
--
-- ─── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────────────────────────
--
-- 005 says it plainly: `ascend_auth` holds no INSERT, UPDATE or DELETE. It authenticates; it never
-- writes. But ACCEPTING AN INVITATION IS A WRITE PERFORMED BY SOMEBODY WHO IS NOT AUTHENTICATED —
-- setting a password and consuming a token happen at the one moment there is no principal, no
-- membership and no capability. Every other write in this system requires authority. This one
-- structurally cannot have it.
--
-- Two answers were rejected before this one. Granting the writes to `ascend_auth` would let the role
-- that READS credential material also write it. Accepting over the owner's connection would have the
-- application perform privileged writes on behalf of an anonymous caller.
--
-- ─── THE PROPERTY WORTH FOREGROUNDING ──────────────────────────────────────────────────────────
--
--   ascend_auth     SELECT password_hash    · cannot write it
--   ascend_invite   UPDATE password_hash    · cannot read it
--
-- The role that reads credentials cannot write them; the role that writes them cannot read them.
-- Neither can do the other's job, and a compromise of either yields strictly less than the pair.
--
-- ─── ascend_invite IS NOT A PRINCIPAL ──────────────────────────────────────────────────────────
--
-- Stated here because a future reader will otherwise see "special role for unauthenticated requests"
-- and reach for it as a general-purpose bypass:
--
--   `ascend_invite` grants NO application authority. It is a database capability restricted to the
--   invitation-acceptance transaction. It has no ResolvedPrincipal, cannot be resolved into one, and
--   no `requireCapability` call may ever be satisfied by it.
--
-- Membership remains the only source of authority. An invitation grants no role: it names a user the
-- owner ALREADY provisioned, and accepting it sets a password and nothing else.

CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The user ALREADY EXISTS, with a membership the owner wrote. Acceptance creates neither.
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A DIGEST, never the token.
  --
  -- SHA-256 rather than the scrypt used for passwords, and the difference is a threat model rather
  -- than an inconsistency: a password is low-entropy and human-chosen, so its resistance must come
  -- from KDF cost. This token is 32 bytes of CSPRNG output — its resistance comes from entropy, and
  -- a slow KDF would buy nothing while making every lookup expensive. The digest exists so that a
  -- database disclosure does not hand over live tokens.
  token_hash       text NOT NULL UNIQUE,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  -- NULL until accepted. The single-use marker, and the thing the acceptance transaction flips.
  consumed_at      timestamptz,
  CONSTRAINT invitation_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX invitations_user ON invitations (user_id);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

-- ─── THE OWNER SIDE — issuing ────────────────────────────────────────────────────────────────
--
-- Scoped by `current_org()` like every other application policy, so an owner cannot issue into an
-- organization they are not acting for. No UPDATE and no DELETE: revocation is not built in 2G.2,
-- and an invitation that could be edited after issue is a record whose provenance is negotiable.

GRANT SELECT, INSERT ON invitations TO ascend_owner;

CREATE POLICY invitations_owner_reads ON invitations
  FOR SELECT TO ascend_owner USING (organization_id = current_org());
CREATE POLICY invitations_owner_issues ON invitations
  FOR INSERT TO ascend_owner WITH CHECK (organization_id = current_org());

-- Deliberately absent: any grant to ascend_sales or ascend_automation. A partner cannot issue an
-- invitation, cannot see one, and cannot learn that one exists.

-- ─── THE ACCEPTANCE SIDE — ascend_invite ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE ROLE ascend_invite NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO ascend_invite;

-- Column-level, and the omissions are the design: no organization_id, no created_by, no created_at.
-- The acceptance transaction needs to find the row, judge whether it is live, and burn it.
GRANT SELECT (id, user_id, token_hash, expires_at, consumed_at) ON invitations TO ascend_invite;
GRANT UPDATE (consumed_at)                                      ON invitations TO ascend_invite;

-- `SELECT (id)` exists ONLY because Postgres requires SELECT on columns named in an UPDATE's WHERE
-- clause. It is a mechanics requirement, not an appetite for reading users.
GRANT SELECT (id)                                            ON users TO ascend_invite;
GRANT UPDATE (password_hash, password_algo, password_set_at) ON users TO ascend_invite;

-- ─── WHY THE SELECT POLICY IS `true`, AND NOT "ONLY LIVE ROWS" ───────────────────────────────
--
-- It was written as `USING (consumed_at IS NULL AND expires_at > now())`, to make uniform refusal
-- STRUCTURAL — a dead invitation invisible rather than merely rejected. MEASURED: that makes the
-- token impossible to consume.
--
--   as written                            → 42501 new row violates row-level security policy
--   same statement, SELECT policy `true`  → burn OK, 1 row
--
-- Postgres checks the SELECT policy against the NEW row of an UPDATE. Setting `consumed_at` makes
-- the row fail the very predicate that made it visible, so the restrictive policy forbade exactly
-- the transition it was meant to protect. `WITH CHECK (true)` on the UPDATE policy does not help:
-- the SELECT policy is applied independently.
--
-- Rejected alternatives: DELETE-on-acceptance (a wider authority than UPDATE, and it discards the
-- provenance of when the invitation was used) and a SECURITY DEFINER consume function (a privileged
-- bypass, which is the shape §27 exists to prevent).
--
-- So liveness moves into the acceptance query's WHERE clause. Uniform refusal is preserved — unknown,
-- expired and consumed all return ZERO ROWS from ONE predicate, so there is still no branch that
-- could distinguish them — but it is now a property of one line of SQL rather than of row
-- visibility, and `core/auth/invitations` says so at the call site.
--
-- What this widens, stated plainly: `ascend_invite` can read dead invitation rows. It sees only
-- (id, user_id, token_hash, expires_at, consumed_at) — no organization, no issuer — and token_hash
-- is a SHA-256 digest, so the rows yield no usable token.
CREATE POLICY invitations_acceptance_reads ON invitations
  FOR SELECT TO ascend_invite USING (true);

-- Burning it. WITH CHECK (true) is required and deliberate: the row AFTER the update has
-- `consumed_at` set, so it no longer satisfies the USING predicate above — without an explicit
-- WITH CHECK the update would fail the very policy that made the row visible.
CREATE POLICY invitations_acceptance_burns ON invitations
  FOR UPDATE TO ascend_invite
  USING (consumed_at IS NULL AND expires_at > now())
  WITH CHECK (true);

-- ─── THE CREDENTIAL WRITE IS SCOPED BY A LIVE INVITATION ─────────────────────────────────────
--
-- `ascend_invite` may set the credential of a user ONLY while that user holds a live, unconsumed,
-- unexpired invitation. The row scope is therefore structural rather than something the application
-- passes in — and it has a second effect worth naming:
--
--   IT ENFORCES THE ORDER. The password must be written BEFORE the token is burned, because burning
--   it removes the very row this policy depends on. An implementation that consumed first would find
--   the credential write refused by the database rather than silently half-accepting.
-- ─── AN UNSCOPED POLICY IS A PRIVILEGE DEPENDENCY FOR EVERY FUTURE ROLE ──────────────────────
--
-- MEASURED while building this migration: `ascend_invite` could not touch `users` at all, and the
-- error was `permission denied for table MEMBERSHIPS`. 001's `users_same_org` policy carries no
-- `TO` clause, so it applies to every role — and evaluating its expression requires SELECT on
-- `memberships`, which this role deliberately does not have. `ascend_auth` escapes it only because
-- 005 happened to grant it membership reads.
--
-- Adding a second permissive policy does not help: permissive policies are OR-ed, but the planner
-- still checks privileges on every relation an applicable policy references.
--
-- So the policy is SCOPED to the roles it was always written for. This is a NARROWING, not a
-- widening — the three application roles see exactly what they saw before, and the policy stops
-- silently imposing a `memberships` read requirement on roles added later. 005 set this precedent
-- when it scoped its own policies `TO ascend_auth` rather than widening an existing one.
DROP POLICY users_same_org ON users;
CREATE POLICY users_same_org ON users
  FOR SELECT TO ascend_owner, ascend_sales, ascend_automation
  USING (EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = users.id AND m.organization_id = current_org()
  ));

-- `ascend_invite` must read `users.id` to name the row it updates. USING (true) is safe because the
-- COLUMN grant already limits it to `id`, and the UPDATE policy below is what actually constrains
-- which row may be written.
CREATE POLICY invite_reads_user_id ON users
  FOR SELECT TO ascend_invite USING (true);

CREATE POLICY invite_sets_credential ON users
  FOR UPDATE TO ascend_invite
  USING (EXISTS (
    SELECT 1 FROM invitations i
     WHERE i.user_id = users.id AND i.consumed_at IS NULL AND i.expires_at > now()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM invitations i
     WHERE i.user_id = users.id AND i.consumed_at IS NULL AND i.expires_at > now()
  ));

-- Deliberately absent for ascend_invite: any SELECT of password_hash (it writes credentials and
-- cannot read them), any access to memberships, any INSERT or DELETE anywhere, and any grant on
-- prospects, clients, finance, documents or events. Its authority is the acceptance transaction and
-- nothing else.

-- ─── THE LOGIN ROLE MAY ASSUME IT, DELIBERATELY AND NEVER PASSIVELY ──────────────────────────
--
-- Same shape and same reasoning as 001's grant of the three application roles: `INHERIT FALSE` means
-- the login role acquires nothing on a bare connection and gains this capability ONLY by explicitly
-- assuming it inside the acceptance transaction. Without it, every unwrapped connection would carry
-- the ability to write credentials by inheritance — which is the opposite of what this role is for.
--
-- 001's header records why this block exists at all: superusers may assume any role unconditionally,
-- so PGlite passed a schema that was unusable on managed Postgres until the grant was made explicit.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT ascend_invite TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT ascend_invite TO %I', current_user);
  END IF;
END $$;
