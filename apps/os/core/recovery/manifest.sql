-- core/recovery/manifest.sql — THE FIDELITY MANIFEST (Dependency R1, contract §5).
--
-- ONE TEXT, TWO SIDES. This exact file runs read-only against the SOURCE at dump time (psql, from
-- scripts/backup-production.sh) and against the RESTORED target (PGlite, from core/recovery/restore.ts).
-- Recovery fidelity is the two outputs being equal key for key. Nothing is compared that was computed
-- by different code on each side.
--
-- WHAT LEAVES THE DATABASE: counts, flags, object NAMES, and sha256 digests computed INSIDE the
-- database. Never a row, never a hash, never a token. Credential columns are hashed a second time
-- before they are aggregated, so the output cannot be used to recover even the KDF output.
--
-- DETERMINISM IS SET, NOT ASSUMED. Row text depends on TimeZone, DateStyle, float digits, bytea and
-- interval output; deparsed definitions depend on search_path; and every ORDER BY on text is pinned to
-- COLLATE "C" because production and PGlite do not share a default collation — without it the same
-- rows sort differently and every digest disagrees for a reason that has nothing to do with recovery.
--
-- EVERY SET HERE IS SESSION-LOCAL AND WRITES NOTHING. Safe inside a read-only transaction.
--
-- The eight tables are NAMED. `tests/db/restore-fidelity.test.ts` fails if a migration adds a table
-- this file does not digest, so the manifest cannot silently fall behind the schema again.

SET TimeZone = 'UTC';
SET DateStyle = 'ISO, MDY';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';
SET search_path = public, pg_catalog;

WITH m(k, v) AS (
  SELECT 'meta.format', 'ascend-recovery-manifest/1'

  -- F1 · tables ----------------------------------------------------------------------------------
  UNION ALL SELECT 'F1.tables', string_agg(c.relname, ',' ORDER BY c.relname COLLATE "C")
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'

  -- F2 · columns and types -----------------------------------------------------------------------
  UNION ALL SELECT 'F2.columns.count', count(*)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL SELECT 'F2.columns.digest', encode(sha256(convert_to(coalesce(string_agg(
      c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull
      || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
      E'\n' ORDER BY c.relname COLLATE "C", a.attnum), ''), 'UTF8')), 'hex')
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped

  -- F3 · row counts ------------------------------------------------------------------------------
  UNION ALL SELECT 'F3.rows.events',            count(*)::text FROM events
  UNION ALL SELECT 'F3.rows.invitations',       count(*)::text FROM invitations
  UNION ALL SELECT 'F3.rows.memberships',       count(*)::text FROM memberships
  UNION ALL SELECT 'F3.rows.organizations',     count(*)::text FROM organizations
  UNION ALL SELECT 'F3.rows.prospect_notes',    count(*)::text FROM prospect_notes
  UNION ALL SELECT 'F3.rows.prospects',         count(*)::text FROM prospects
  UNION ALL SELECT 'F3.rows.schema_migrations', count(*)::text FROM schema_migrations
  UNION ALL SELECT 'F3.rows.users',             count(*)::text FROM users

  -- F4 · row content: an order-independent digest of every row's canonical text ------------------
  UNION ALL SELECT 'F4.digest.events', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM events t
  UNION ALL SELECT 'F4.digest.invitations', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM invitations t
  UNION ALL SELECT 'F4.digest.memberships', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM memberships t
  UNION ALL SELECT 'F4.digest.organizations', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM organizations t
  UNION ALL SELECT 'F4.digest.prospect_notes', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM prospect_notes t
  UNION ALL SELECT 'F4.digest.prospects', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM prospects t
  UNION ALL SELECT 'F4.digest.schema_migrations', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM schema_migrations t
  UNION ALL SELECT 'F4.digest.users', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex') FROM users t
  -- Representative rows, by digest: held prospects are the identity edge case.
  UNION ALL SELECT 'F4.held.count', count(*)::text FROM prospects WHERE identity_state = 'held'
  UNION ALL SELECT 'F4.held.digest', encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' ORDER BY t::text COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM prospects t WHERE t.identity_state = 'held'

  -- F5 · keys and constraints, and the indexes that back them -------------------------------------
  -- CROSS-VERSION-STABLE RELATIONAL CONSTRAINTS ONLY: `contype = 'n'` is excluded from BOTH F5 keys.
  -- PostgreSQL 18 records every NOT NULL column property a second time, as a `pg_constraint` row of
  -- type 'n'; PostgreSQL 17 does not. Found in R1b: production (17.6) reported 43 constraints, the
  -- isolated restore (18.3) 85 — the same 43 plus one 'n' row for each of the 42 NOT NULL columns, with
  -- the digest of the 43 identical. NOT NULL is NOT dropped from the contract: F2 digests
  -- `attnotnull` for every column on both versions, and remains the authority for nullability.
  UNION ALL SELECT 'F5.constraints.count', count(*)::text
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE c.relnamespace = 'public'::regnamespace AND k.contype <> 'n'
  UNION ALL SELECT 'F5.constraints.digest', encode(sha256(convert_to(coalesce(string_agg(
      c.relname || '|' || k.conname || '|' || k.contype::text || '|' || pg_get_constraintdef(k.oid),
      E'\n' ORDER BY c.relname COLLATE "C", k.conname COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE c.relnamespace = 'public'::regnamespace AND k.contype <> 'n'
  UNION ALL SELECT 'F5.indexes.count', count(*)::text FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'F5.indexes.digest', encode(sha256(convert_to(coalesce(string_agg(
      indexname || '|' || indexdef, E'\n' ORDER BY indexname COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_indexes WHERE schemaname = 'public'

  -- F6 · sequence state and event ordering --------------------------------------------------------
  UNION ALL SELECT 'F6.sequences', coalesce(string_agg(sequencename || '=' || coalesce(last_value::text, 'null'),
      ',' ORDER BY sequencename COLLATE "C"), '')
    FROM pg_sequences WHERE schemaname = 'public'
  UNION ALL SELECT 'F6.events.seq.min', coalesce(min(seq)::text, 'none') FROM events
  UNION ALL SELECT 'F6.events.seq.max', coalesce(max(seq)::text, 'none') FROM events
  UNION ALL SELECT 'F6.events.seq.distinct', count(DISTINCT seq)::text FROM events
  -- The ordering signal itself, gaps included: renumbering would change this and nothing else.
  UNION ALL SELECT 'F6.events.seq.digest', encode(sha256(convert_to(coalesce(string_agg(seq::text, ',' ORDER BY seq), ''), 'UTF8')), 'hex') FROM events
  UNION ALL SELECT 'F6.events.order.digest', encode(sha256(convert_to(coalesce(string_agg(
      seq::text || '|' || event_id::text, ',' ORDER BY seq), ''), 'UTF8')), 'hex') FROM events

  -- F7 · the legacy notes body --------------------------------------------------------------------
  UNION ALL SELECT 'F7.notes.legacy.count', count(*)::text FROM prospects WHERE coalesce(notes, '') <> ''
  UNION ALL SELECT 'F7.notes.legacy.digest', encode(sha256(convert_to(coalesce(string_agg(
      id::text || '|' || notes, E'\n' ORDER BY id::text COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM prospects WHERE coalesce(notes, '') <> ''

  -- F8 · the notes log ----------------------------------------------------------------------------
  UNION ALL SELECT 'F8.notes.log.authored', count(DISTINCT author_user_id)::text FROM prospect_notes

  -- F9 · credentials — hashed AGAIN before aggregation; the KDF output never leaves ---------------
  UNION ALL SELECT 'F9.credentials.count', count(*)::text FROM users WHERE password_hash IS NOT NULL
  UNION ALL SELECT 'F9.credentials.digest', encode(sha256(convert_to(coalesce(string_agg(
      id::text || '|' || encode(sha256(convert_to(password_hash, 'UTF8')), 'hex') || '|' || password_algo
      || '|' || password_set_at::text, E'\n' ORDER BY id::text COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM users WHERE password_hash IS NOT NULL
  UNION ALL SELECT 'F9.credentials.disabled', count(*)::text FROM users WHERE disabled_at IS NOT NULL

  -- F10 · invitation secrets, the same treatment --------------------------------------------------
  UNION ALL SELECT 'F10.invitations.digest', encode(sha256(convert_to(coalesce(string_agg(
      id::text || '|' || encode(sha256(convert_to(token_hash, 'UTF8')), 'hex') || '|' || expires_at::text
      || '|' || coalesce(consumed_at::text, 'live'), E'\n' ORDER BY id::text COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM invitations

  -- F11 · row-level security ----------------------------------------------------------------------
  UNION ALL SELECT 'F11.rls', string_agg(c.relname || ':' || c.relrowsecurity || '/' || c.relforcerowsecurity,
      ',' ORDER BY c.relname COLLATE "C")
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  UNION ALL SELECT 'F11.policies.count', count(*)::text FROM pg_policies WHERE schemaname = 'public'
  UNION ALL SELECT 'F11.policies.digest', encode(sha256(convert_to(coalesce(string_agg(
      tablename || '|' || policyname || '|' || permissive || '|' || array_to_string(roles, ';') || '|' || cmd
      || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
      E'\n' ORDER BY tablename COLLATE "C", policyname COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_policies WHERE schemaname = 'public'

  -- F13 · grants to Ascend's roles. Grantee and privilege only: the GRANTOR is whoever ran the
  -- restore, which is correctly different from whoever ran the migration.
  UNION ALL SELECT 'F13.grants.relations.digest', encode(sha256(convert_to(coalesce(string_agg(
      c.relname || '|' || r.rolname || '|' || x.privilege_type || '|' || x.is_grantable,
      E'\n' ORDER BY c.relname COLLATE "C", r.rolname COLLATE "C", x.privilege_type COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.relnamespace = 'public'::regnamespace AND r.rolname LIKE 'ascend\_%'
  UNION ALL SELECT 'F13.grants.relations.count', count(*)::text
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.relnamespace = 'public'::regnamespace AND r.rolname LIKE 'ascend\_%'
  UNION ALL SELECT 'F13.grants.columns.digest', encode(sha256(convert_to(coalesce(string_agg(
      c.relname || '.' || a.attname || '|' || r.rolname || '|' || x.privilege_type,
      E'\n' ORDER BY c.relname COLLATE "C", a.attname COLLATE "C", r.rolname COLLATE "C", x.privilege_type COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND r.rolname LIKE 'ascend\_%'
  UNION ALL SELECT 'F13.grants.columns.count', count(*)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND r.rolname LIKE 'ascend\_%'
  -- PUBLIC's USAGE is carried here deliberately: Ascend's application roles hold no schema grant of
  -- their own and see `public` only through it. A restore that loses it looks complete and serves nothing.
  UNION ALL SELECT 'F13.grants.schema', coalesce(string_agg(g.who || ':' || g.privilege_type,
      ',' ORDER BY g.who COLLATE "C", g.privilege_type COLLATE "C"), '')
    FROM (SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS who, x.privilege_type
            FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
           WHERE n.nspname = 'public' AND (x.grantee = 0 OR r.rolname LIKE 'ascend\_%')) g

  -- F14 · roles and their memberships among themselves (platform memberships are not Ascend's) ----
  UNION ALL SELECT 'F14.roles', string_agg(rolname || ':' ||
      CASE WHEN rolcanlogin THEN 'login' ELSE 'nologin' END || ',' ||
      CASE WHEN rolinherit THEN 'inherit' ELSE 'noinherit' END || ',' ||
      CASE WHEN rolbypassrls THEN 'bypassrls' ELSE 'rls' END || ',' ||
      CASE WHEN rolsuper THEN 'super' ELSE 'nosuper' END || ',' ||
      CASE WHEN rolcreaterole THEN 'createrole' ELSE 'nocreaterole' END || ',' ||
      CASE WHEN rolcreatedb THEN 'createdb' ELSE 'nocreatedb' END,
      ';' ORDER BY rolname COLLATE "C")
    FROM pg_roles WHERE rolname LIKE 'ascend\_%'
  UNION ALL SELECT 'F14.memberships', coalesce(string_agg(m.rolname || '>' || r.rolname || ':' ||
      a.admin_option || '/' || a.inherit_option || '/' || a.set_option,
      ',' ORDER BY m.rolname COLLATE "C", r.rolname COLLATE "C"), '')
    FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
    WHERE r.rolname LIKE 'ascend\_%' AND m.rolname LIKE 'ascend\_%'

  -- F15 · functions and triggers ------------------------------------------------------------------
  UNION ALL SELECT 'F15.functions', coalesce(string_agg(p.proname, ',' ORDER BY p.proname COLLATE "C"), '')
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'F15.functions.digest', encode(sha256(convert_to(coalesce(string_agg(
      pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'F15.triggers', coalesce(string_agg(t.tgname || '@' || c.relname, ',' ORDER BY t.tgname COLLATE "C"), '')
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  UNION ALL SELECT 'F15.triggers.digest', encode(sha256(convert_to(coalesce(string_agg(
      pg_get_triggerdef(t.oid), E'\n' ORDER BY t.tgname COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace

  -- F16 · extensions: none belongs to Ascend. Proven, so the exclusion is a fact and not a hope. ---
  UNION ALL SELECT 'F16.extension_dependencies', count(*)::text
    FROM pg_depend d
    WHERE d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
      AND ((d.classid = 'pg_proc'::regclass AND d.objid IN (SELECT oid FROM pg_proc WHERE pronamespace = 'public'::regnamespace))
        OR (d.classid = 'pg_class'::regclass AND d.objid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)))
  UNION ALL SELECT 'F16.foreign_column_types', count(*)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_type ty ON ty.oid = a.atttypid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND ty.typnamespace NOT IN ('pg_catalog'::regnamespace, 'public'::regnamespace)

  -- F17 · the migration ledger, with its provenance ----------------------------------------------
  UNION ALL SELECT 'F17.ledger', coalesce(string_agg(version || ':' || checksum || ':' ||
      CASE WHEN applied_at_is_backfilled THEN 'backfilled' ELSE 'witnessed' END, ',' ORDER BY version COLLATE "C"), '')
    FROM schema_migrations
)
SELECT k, coalesce(v, '') AS v FROM m ORDER BY k COLLATE "C";
