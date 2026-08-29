-- Ascend OS · shared operational substrate (Stage 2A)
-- docs/STAGE2-MULTIUSER-ARCHITECTURE.md
--
-- PORTABLE POSTGRES. No Supabase-specific constructs: no `auth.uid()`, no `auth.users` FK, no
-- storage or realtime dependencies. Identity is bound through two session GUCs that ANY host can
-- set — Supabase maps its JWT claims onto them, a plain Postgres deployment sets them directly.
-- That is what makes Decision 1's "Supabase is infrastructure, not the domain abstraction" true in
-- the schema rather than only in prose.
--
--   ascend.org_id    the organization this request acts within
--   ascend.user_id   the human this request acts as ('' for system/automation)
--
-- WHAT THIS FILE ENCODES. Three rules that Stages 0.5 and 1 could only enforce with tests now
-- become constraints the database will not let anyone violate:
--
--   1. an anchored prospect HAS an identity; a held prospect has NONE and states why
--   2. automation may not write a held prospect, and may not write a human judgment at all
--   3. an "operator" event must name the human who caused it (so §19 stays scoped)

-- ─── Roles ─────────────────────────────────────────────────────────────────────────────────────
-- Least privilege, expressed as grants rather than as application checks. `ascend_automation` is
-- the research/import runner: it can create and update prospects, and it is STRUCTURALLY incapable
-- of touching `website_opportunity` because the column grant is withheld.

DO $$ BEGIN
  CREATE ROLE ascend_owner NOLOGIN;      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE ascend_sales NOLOGIN;      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE ascend_automation NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The connecting role must be able to BECOME these roles, and creating them is not enough.
--
-- On PostgreSQL 16+, a role with CREATEROLE that creates a role receives ADMIN but NOT SET. It may
-- administer the role and may not assume it, so `SET LOCAL ROLE ascend_owner` fails outright with
-- "permission denied to set role". Every principal in this system is bound by exactly that
-- statement, which means the entire authorization model is inert without the grant below.
--
-- SUPERUSERS NEVER HIT THIS — they may assume any role unconditionally. PGlite runs as a superuser,
-- so the whole Stage 2A/2B test suite passed while the schema was unusable on any managed Postgres,
-- Supabase included. The defect surfaced the first time these roles met a non-superuser login.
--
-- INHERIT FALSE keeps authority DELIBERATE: the login role acquires these privileges only by
-- assuming the role inside `asPrincipal`, never passively on a bare connection. Without it the
-- grant would hand every unwrapped connection ascend_owner's rights by inheritance — quietly
-- contradicting the isolation suite's claim that a released connection carries no principal.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format(
      'GRANT ascend_owner, ascend_sales, ascend_automation TO %I WITH INHERIT FALSE, SET TRUE',
      current_user);
  ELSE
    -- Before 16 there is no SET/INHERIT option: membership alone confers SET ROLE.
    EXECUTE format('GRANT ascend_owner, ascend_sales, ascend_automation TO %I', current_user);
  END IF;
END $$;

-- ─── Organizations, users, membership ──────────────────────────────────────────────────────────
-- `organization_id` already exists on every event and every structural_meta in the vault; D9
-- deferred the MACHINERY, not the field. This is that machinery, and it arrives now precisely so
-- that multi-tenancy later is a policy change rather than a schema migration.

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner','sales')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

-- ─── Prospects ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE prospects (
  -- SURROGATE KEY. This is NOT the business identity and nothing may treat it as one. `prospect_id`
  -- below is the anchor (Stage 0.5 D-4); using this column as identity would re-commit the exact
  -- defect that stage removed, where a storage detail stood in for a business fact.
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- THE IDENTITY ANCHOR. Nullable on purpose: a held prospect has no identity, and Postgres permits
  -- many NULLs under a UNIQUE index, so "several unidentified records" is representable while
  -- "two records claiming one identity" is not.
  prospect_id     uuid UNIQUE,
  identity_state  text NOT NULL DEFAULT 'anchored' CHECK (identity_state IN ('anchored','held')),
  hold_reason     text,

  -- Display alias. Renameable, non-identifying, and deliberately NOT unique across organizations.
  slug            text,

  name            text,
  business_type   text,
  location        text,
  website         text,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  source          text,

  -- ABSENCE STAYS ABSENCE. Every one of these is nullable with NO default. An unstated status is
  -- not a status, and an unstated website quality is not "none" — the D-1/D-2 repairs, carried into
  -- the schema so no future writer can reintroduce a default that makes a claim.
  status          text CHECK (status IN ('lead','contacted','proposal','closed-won','closed-lost')),
  website_quality text CHECK (website_quality IN ('none','outdated','acceptable','modern')),

  -- HUMAN JUDGMENT. Written by people only; `ascend_automation` holds no grant on these columns.
  website_opportunity text CHECK (website_opportunity IN ('green','yellow','red')),
  assessed_by     uuid REFERENCES users(id),
  assessed_at     timestamptz,

  assigned_to     uuid REFERENCES users(id),
  created_by      uuid REFERENCES users(id),   -- NULL when Ascend authored it (import, research)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Stage 1's semantics, as constraints rather than as tests.
  CONSTRAINT anchored_iff_identified CHECK ((identity_state = 'anchored') = (prospect_id IS NOT NULL)),
  CONSTRAINT held_states_its_reason  CHECK ((identity_state = 'held')     = (hold_reason IS NOT NULL)),
  -- A judgment carries its provenance or it is not recorded. Prevents an assessment appearing with
  -- no author — the shape that made "who decided this?" unanswerable in the vault.
  CONSTRAINT assessment_has_provenance CHECK (
    (website_opportunity IS NULL) = (assessed_at IS NULL)
    AND (website_opportunity IS NULL) = (assessed_by IS NULL)
  )
);

CREATE INDEX prospects_org_idx        ON prospects (organization_id);
CREATE INDEX prospects_org_state_idx  ON prospects (organization_id, identity_state);
CREATE INDEX prospects_assigned_idx   ON prospects (organization_id, assigned_to);
-- Corroboration keys for identity matching. These are what make the O(N^2) import scan disappear:
-- the uniqueness check becomes an index probe instead of a full read of every prospect.
CREATE INDEX prospects_website_idx    ON prospects (organization_id, lower(website));
CREATE INDEX prospects_phone_idx      ON prospects (organization_id, contact_phone);
CREATE INDEX prospects_email_idx      ON prospects (organization_id, lower(contact_email));

-- ─── Event spine ───────────────────────────────────────────────────────────────────────────────
-- The whole spine moves; splitting it would break core/events' unified reader and its ordering
-- contract. Moving it whole IMPROVES that contract: `seq` is durable, total and immune to file
-- merges, where log position was merely the strongest signal a JSONL file could offer.

CREATE TABLE events (
  -- THE ORDERING SIGNAL. Not event_id: a UUIDv7's sub-millisecond bits are pure random, which
  -- inverted same-millisecond pairs ~52% of the time. That finding carries over unchanged.
  seq             bigserial PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE,          -- identity. NEVER ordering.
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type            text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  actor           text NOT NULL,                 -- KIND: operator | client | system | agent:*
  actor_user_id   uuid REFERENCES users(id),     -- WHICH human; NULL for system/client/agent
  subject_entity    text NOT NULL,
  subject_entity_id text NOT NULL,
  data            jsonb,
  correlation_id  text,

  -- §19 PROTECTION, enforced rather than trusted. An operator event that cannot name its human is
  -- exactly the shape that would let a second person's activity be counted as the first's.
  CONSTRAINT operator_events_name_their_human CHECK (actor <> 'operator' OR actor_user_id IS NOT NULL),
  -- And the converse: a system event may not claim a human caused it.
  CONSTRAINT system_events_name_no_human      CHECK (actor <> 'system'   OR actor_user_id IS NULL)
);

CREATE INDEX events_org_seq_idx     ON events (organization_id, seq);
CREATE INDEX events_subject_idx     ON events (organization_id, subject_entity, subject_entity_id, seq);
CREATE INDEX events_type_idx        ON events (organization_id, type, seq);
CREATE INDEX events_operator_idx    ON events (organization_id, actor_user_id, occurred_at)
  WHERE actor = 'operator';

-- APPEND-ONLY, structurally. The vault achieved this by convention ("events are immutable facts:
-- never mutated, never deleted"). Here it is a trigger, so a mistaken UPDATE fails loudly instead
-- of quietly rewriting memory.
CREATE FUNCTION events_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only: % is not permitted', TG_OP;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_are_append_only();
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_are_append_only();

-- ─── Row-level security ────────────────────────────────────────────────────────────────────────
-- DEFAULT DENY. Every table has RLS enabled AND forced, so even a table owner is subject to policy.
-- The application is not the only gate; this is.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;  ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;  ALTER TABLE users         FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;  ALTER TABLE memberships   FORCE ROW LEVEL SECURITY;
ALTER TABLE prospects     ENABLE ROW LEVEL SECURITY;  ALTER TABLE prospects     FORCE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;  ALTER TABLE events        FORCE ROW LEVEL SECURITY;

CREATE FUNCTION current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('ascend.org_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('ascend.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Organizations / memberships / users: visible only through the caller's own membership.
CREATE POLICY org_self ON organizations FOR SELECT USING (id = current_org());
CREATE POLICY membership_own_org ON memberships FOR SELECT USING (organization_id = current_org());
CREATE POLICY users_same_org ON users FOR SELECT USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = current_org())
);

-- Prospects: readable within the organization by every role INCLUDING held ones.
--
-- THE LOAD-BEARING POLICY PAIR. A hold is a WRITE barrier, not an information barrier: the matcher
-- must still SEE a held prospect, because its existence is what stops an import creating a third
-- copy of the same business. So SELECT is unrestricted within the org, and only UPDATE is narrowed.
CREATE POLICY prospects_read ON prospects FOR SELECT USING (organization_id = current_org());

CREATE POLICY prospects_write_owner ON prospects FOR ALL TO ascend_owner
  USING (organization_id = current_org()) WITH CHECK (organization_id = current_org());

CREATE POLICY prospects_insert_sales ON prospects FOR INSERT TO ascend_sales
  WITH CHECK (organization_id = current_org());
CREATE POLICY prospects_update_sales ON prospects FOR UPDATE TO ascend_sales
  USING (organization_id = current_org() AND identity_state = 'anchored')
  WITH CHECK (organization_id = current_org() AND identity_state = 'anchored');

CREATE POLICY prospects_insert_automation ON prospects FOR INSERT TO ascend_automation
  WITH CHECK (organization_id = current_org());
-- P3: automation may not write a held prospect. USING filters the rows it may target; WITH CHECK
-- stops it moving a row INTO held (or out of it) as a way around the filter.
CREATE POLICY prospects_update_automation ON prospects FOR UPDATE TO ascend_automation
  USING (organization_id = current_org() AND identity_state = 'anchored')
  WITH CHECK (organization_id = current_org() AND identity_state = 'anchored');

CREATE POLICY events_read ON events FOR SELECT USING (organization_id = current_org());
CREATE POLICY events_append ON events FOR INSERT
  WITH CHECK (organization_id = current_org());

-- ─── Grants: least privilege, column-level where it matters ────────────────────────────────────

GRANT SELECT ON organizations, users, memberships TO ascend_owner, ascend_sales, ascend_automation;
GRANT SELECT, INSERT, UPDATE, DELETE ON prospects TO ascend_owner;
GRANT SELECT, INSERT ON events TO ascend_owner, ascend_sales, ascend_automation;
GRANT USAGE, SELECT ON SEQUENCE events_seq_seq TO ascend_owner, ascend_sales, ascend_automation;

-- Sales may record judgment and sales state, and may not invent research findings.
GRANT SELECT, INSERT ON prospects TO ascend_sales;
GRANT UPDATE (name, business_type, location, contact_name, contact_phone, contact_email,
              status, website_opportunity, assessed_by, assessed_at, assigned_to, updated_at)
  ON prospects TO ascend_sales;

-- AUTOMATION MAY NOT JUDGE. `website_opportunity`, `assessed_by` and `assessed_at` are absent from
-- this grant, so the research runner cannot write a human assessment even if a future code path
-- tried to. This is F31 as a database permission rather than as a source-text rule.
GRANT SELECT, INSERT ON prospects TO ascend_automation;
GRANT UPDATE (name, business_type, location, website, contact_name, contact_phone, contact_email,
              website_quality, source, updated_at)
  ON prospects TO ascend_automation;
