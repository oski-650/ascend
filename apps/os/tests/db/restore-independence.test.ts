// Layer A — CAN THE BACKUP REBUILD ASCEND WITHOUT SUPABASE?
//
// The restore verification in the recovery gate proves the artifact restores correctly — but it
// restores into a database ON THE SAME SUPABASE INSTANCE. That covers the likely disaster (a
// corrupted migration, a bad deploy) and says nothing at all about the one that would end the
// business: losing the Supabase project itself.
//
// So this suite restores the plain-SQL dump into PGlite: a vanilla PostgreSQL with no Supabase
// platform, no `supabase_admin`, no extensions, no pooler, running in this process. If the schema
// stands up there, the recovery artifact is genuinely independent of the vendor.
//
// TWO KINDS OF LINE ARE STRIPPED, and neither is Ascend's schema:
//
//   · `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` — Supabase platform grants for `anon`,
//     `authenticated` and `service_role`, which a non-superuser cannot apply anyway and which mean
//     nothing off-platform.
//
//   · psql META-COMMANDS. A discovery worth recording: **`pg_dump`'s "plain" output is not pure
//     SQL.** Version 18 wraps the dump in `\restrict` / `\unrestrict` (a guard against a malicious
//     dump escaping into psql). These are instructions to PSQL, not statements for a server, so any
//     executor that is not psql chokes on line 5.
//
// THE DUMP THIS SUITE READS MUST BE `--inserts`. The default plain dump carries table data in
// `COPY … FROM stdin` blocks, whose tab-separated payload is likewise a psql streaming convention
// rather than SQL — stripping the `\.` terminator merely turns the data rows into syntax errors.
// `--inserts` emits ordinary INSERT statements instead, which any executor can replay. That is why
// the backup set contains a `-portable.sql` artifact alongside the custom-format one: the custom
// dump is for `pg_restore`, the portable dump is for everything else.
//
// Everything else — every CREATE TABLE, CONSTRAINT, INDEX, POLICY, TRIGGER, FUNCTION and GRANT that
// belongs to Ascend — is executed exactly as dumped.
//
// The roles are pre-created because a cluster is not a database: `pg_dump` of one schema records
// GRANTs to roles but cannot carry the roles themselves. That is the gap `pg_dumpall --globals-only`
// fills, and the recovery procedure runs it first for exactly this reason.
//
// SKIPPED WITHOUT A DUMP, loudly. Point `ASCEND_BACKUP_SQL` at a plain-format dump to run it.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const DUMP = process.env.ASCEND_BACKUP_SQL;
const available = Boolean(DUMP && existsSync(DUMP));
const describeIfDump = available ? describe : describe.skip;

/** Roles the dump grants to. A cluster's roles are not inside a single-schema dump. */
const ROLES = [
  "anon", "authenticated", "service_role", "postgres",
  "ascend_app", "ascend_owner", "ascend_sales", "ascend_automation", "ascend_auth",
];

/** Lines that are not Ascend schema: Supabase platform ACLs, and psql meta-commands. */
function stripNonSchema(sql: string): { sql: string; platform: number; meta: number } {
  let platform = 0, meta = 0;
  const kept = sql.split("\n").filter((l) => {
    if (/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/.test(l)) { platform++; return false; }
    // `\restrict` / `\unrestrict` — psql directives, not SQL.
    if (/^\\/.test(l)) { meta++; return false; }
    return true;
  });
  return { sql: kept.join("\n"), platform, meta };
}

describeIfDump("RESTORE INDEPENDENCE — rebuilding Ascend on vanilla PostgreSQL", () => {
  async function rebuilt(): Promise<PGlite> {
    const pg = new PGlite();
    // The dump contains `CREATE SCHEMA public`, and every fresh database already has one. The same
    // collision appears with `pg_restore`, so this is a step of the documented recovery procedure
    // rather than a quirk of PGlite.
    await pg.exec(`DROP SCHEMA IF EXISTS public CASCADE`);
    for (const r of ROLES) {
      // NOLOGIN: this is a structural stand-in for the cluster roles, not a working login.
      await pg.exec(`DO $$ BEGIN CREATE ROLE ${r} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
    const { sql, platform, meta } = stripNonSchema(readFileSync(DUMP!, "utf8"));
    // Both counts are asserted so that a future dump which stops containing them is noticed rather
    // than silently making this filter a no-op.
    expect(platform, "expected Supabase platform DEFAULT PRIVILEGES lines").toBeGreaterThan(0);
    expect(meta, "expected psql meta-commands — pg_dump plain output is not pure SQL").toBeGreaterThan(0);
    // A COPY block here means the dump was taken without `--inserts`, and its data rows would be
    // parsed as SQL. Caught explicitly, because the resulting error ("trailing junk after numeric
    // literal") points at the data rather than at the real cause.
    expect(sql, "this dump uses COPY blocks — re-take it with --inserts").not.toMatch(/^COPY /m);
    await pg.exec(sql);
    // pg_dump sets `search_path` to '' and schema-qualifies everything it creates, so a session
    // that has just replayed a dump cannot resolve an unqualified table name. Restoring a normal
    // path is what any real session would do next, and is a step of the recovery procedure.
    await pg.exec(`SET search_path TO public`);
    return pg;
  }

  it("the dump applies cleanly to a server that has never heard of Supabase", async () => {
    const pg = await rebuilt();
    const v = await pg.query<{ v: string }>(`SELECT version() AS v`);
    expect(v.rows[0].v).toMatch(/PostgreSQL/);
    await pg.close();
  }, 120_000);

  it("every table, constraint, index, policy and trigger is reconstructed", async () => {
    const pg = await rebuilt();
    const one = async (sql: string) => (await pg.query<{ x: string }>(sql)).rows[0].x;

    expect(await one(
      `SELECT string_agg(tablename, ', ' ORDER BY tablename) AS x
       FROM pg_tables WHERE schemaname = 'public'`
    )).toBe("events, memberships, organizations, prospects, schema_migrations, users");

    // The named constraints that carry Stage 0.5 and Stage 1's semantics.
    const checks = await one(
      `SELECT string_agg(conname, ',' ORDER BY conname) AS x
       FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'public' AND c.contype = 'c'`
    );
    for (const name of [
      "anchored_iff_identified", "held_states_its_reason", "assessment_has_provenance",
      "operator_events_name_their_human", "system_events_name_no_human",
      "backfilled_rows_state_their_source",
    ]) {
      expect(checks, `missing CHECK ${name}`).toContain(name);
    }

    // Lower bounds, not pinned integers: 005 added two auth policies and a pinned 11 would have
    // failed for a correct schema. What matters is that the policies came back, not their census.
    expect(Number(await one(`SELECT count(*)::text AS x FROM pg_policies WHERE schemaname='public'`)))
      .toBeGreaterThanOrEqual(11);
    expect(Number(await one(
      `SELECT count(*)::text AS x FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname='public' AND NOT t.tgisinternal`
    ))).toBe(2);
    expect(Number(await one(`SELECT count(*)::text AS x FROM pg_indexes WHERE schemaname='public'`)))
      .toBeGreaterThanOrEqual(20);
    await pg.close();
  }, 120_000);

  it("row-level security survives — ENABLED and FORCED", async () => {
    // The half that is easiest to lose in a restore, and the one that matters: without FORCE, the
    // table owner bypasses every policy, and the owner is who a restore runs as.
    const pg = await rebuilt();
    const rows = (await pg.query<{ relname: string; e: boolean; f: boolean }>(
      `SELECT relname, relrowsecurity AS e, relforcerowsecurity AS f
       FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname='public' AND relkind='r' ORDER BY relname`
    )).rows;
    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.e, `${r.relname}: RLS not enabled`).toBe(true);
      expect(r.f, `${r.relname}: RLS not FORCED`).toBe(true);
    }
    await pg.close();
  }, 120_000);

  it("the migration ledger came back, WITH its backfill provenance intact", async () => {
    // A ledger restored without the flag would silently upgrade three reconstructed timestamps into
    // observations — the precise misreading the flag exists to prevent.
    const pg = await rebuilt();
    const rows = (await pg.query<{ version: string; b: boolean; note: string | null }>(
      `SELECT version, applied_at_is_backfilled AS b, note FROM schema_migrations ORDER BY version`
    )).rows;
    expect(rows.map((r) => r.version)).toEqual(expect.arrayContaining([
      "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql", "004_schema_migrations.sql",
    ]));
    expect(rows.filter((r) => r.b).map((r) => r.version)).toEqual([
      "001_substrate.sql", "002_prospect_fields.sql", "003_prospect_notes.sql",
    ]);
    for (const r of rows.filter((x) => x.b)) expect(r.note).toContain("did not witness");
    await pg.close();
  }, 120_000);

  it("the rebuilt schema still ENFORCES: held prospects, identity, append-only events", async () => {
    // Structure restored is not the same as structure enforcing. These are the same negative
    // controls the production gate runs, re-run on a server with no Supabase in it.
    const pg = await rebuilt();
    await pg.exec(`
      INSERT INTO organizations (id,slug,name) VALUES ('11111111-1111-4111-8111-111111111111','v','V');
      INSERT INTO users (id,email) VALUES ('22222222-2222-4222-8222-222222222222','v@t');
      INSERT INTO prospects (organization_id,prospect_id,identity_state,slug,contact_name,first_contact)
      VALUES ('11111111-1111-4111-8111-111111111111','0198f3a1-2b4c-7d8e-9f01-234567890abc','anchored','v','','2026-06-10');
      INSERT INTO events (seq,event_id,organization_id,type,occurred_at,actor,actor_user_id,subject_entity,subject_entity_id)
      VALUES (500,gen_random_uuid(),'11111111-1111-4111-8111-111111111111','t',now(),'operator','22222222-2222-4222-8222-222222222222','prospect','p');
    `);

    const fails = async (sql: string) => {
      try { await pg.exec(sql); return null; } catch (e) { return (e as Error).message; }
    };

    expect(await fails(
      `INSERT INTO prospects (organization_id,prospect_id,identity_state,slug)
       VALUES ('11111111-1111-4111-8111-111111111111',NULL,'anchored','x')`
    )).toMatch(/anchored_iff_identified/);

    expect(await fails(
      `INSERT INTO prospects (organization_id,prospect_id,identity_state,slug)
       VALUES ('11111111-1111-4111-8111-111111111111',NULL,'held','y')`
    )).toMatch(/held_states_its_reason/);

    expect(await fails(`UPDATE events SET type='rewritten' WHERE seq=500`)).toMatch(/append-only/);
    expect(await fails(`DELETE FROM events WHERE seq=500`)).toMatch(/append-only/);

    // …and the value semantics that a naive round-trip loses.
    const p = (await pg.query<{ d: string; cn: string | null; pid: string }>(
      `SELECT first_contact::text AS d, contact_name AS cn, prospect_id::text AS pid FROM prospects WHERE slug='v'`
    )).rows[0];
    expect(p.d, "a date must not shift by a timezone it never had").toBe("2026-06-10");
    expect(p.cn, "empty string must not become NULL").toBe("");
    expect(p.pid).toBe("0198f3a1-2b4c-7d8e-9f01-234567890abc");
    await pg.close();
  }, 120_000);
});

describe("restore independence — guard", () => {
  it("announces when vendor-independence has NOT been verified", () => {
    if (!available) {
      console.warn(
        "\n  ⚠️  RESTORE INDEPENDENCE NOT VERIFIED — set ASCEND_BACKUP_SQL to a plain-format dump.\n" +
        "      Without it, nothing shows the backup can rebuild Ascend off Supabase.\n"
      );
    }
    expect(true).toBe(true);
  });
});
