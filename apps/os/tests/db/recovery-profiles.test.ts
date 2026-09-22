// RT-3B — APPLICATION VERIFICATION PROFILES: the business-level half of a recovery proof is historical too.
//
// RT-3 bound the DATABASE half of recovery verification to the artifact (its manifest, its ledger).
// This suite proves the APPLICATION half is bound the same way: an artifact's contract names a reviewed
// profile written for its exact ledger, and that profile — fixed SQL, run as the application roles —
// verifies it without calling today's readers. Two fixture sources are built, one per historical
// schema (001–008 and 001–009), dumped, sealed and restored exactly as the canonical path does:
//
//   · each verifies under its own profile, sealed (v3) or pinned (v2)
//   · a CURRENT reader that assumes a newer column breaks on the older restore — and the profile does not
//   · every way to name no profile, an unknown one, or the wrong one fails closed
//
// Run with `npm run recovery:verify` (empty environment; the restore refuses otherwise).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { applyMigrations, backfillLedger, listProspects, loadMigrations, provisionAppLogin, type SqlClient } from "@/core/db";
import { hashPassword } from "@/core/auth/credentials";
import { adapt } from "@/tests/support/provisioned-partner";
import {
  APPLICATION_PROFILE_ID, FORMAT_V2, FORMAT_V3, MANIFEST_MEMBER, generateKey, keyForId, open, readHeader, seal, sealEnvelope, sha256,
  type Provenance,
} from "@/core/recovery/artifact";
import { resolveRecoveryContract, type RecoveryContract, type ResolutionSeams } from "@/core/recovery/contract";
import { LEGACY_CONTRACTS, type LegacyContract } from "@/core/recovery/legacy-contracts";
import { APPLICATION_PROFILES, PROFILE_ID, profileForNewArtifact } from "@/core/recovery/profile-registry";
import { IMPLEMENTED_PROFILES, ProfileRefused, runApplicationProfile } from "@/core/recovery/profiles";
import { compareManifests, formatManifest, manifestOf, parseManifest, restoreInto, RestoreRefused } from "@/core/recovery/restore";
import { globalsInDumpallFormat, sessionOf, targetOf } from "@/tests/support/recovery-fixture";

const OWNER = "owner@profiles.test";
const PASSWORD = "fixture-profile-passphrase";
const COMMIT = "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";
const PINNED_MANIFEST = readFileSync(path.join(process.cwd(), "core", "recovery", "contracts", "manifest-4f20059f.sql"), "utf8");

type Built = { envelopeV2: Buffer; envelopeV3?: Buffer; entry: LegacyContract };
let keyring: string;
let key: Buffer;
const built: Record<"pre" | "post", Built> = {} as never;

/** A source with exactly `count` migrations, populated by raw SQL only — no current writer touches it. */
async function source(count: 8 | 9): Promise<PGlite> {
  const pg = new PGlite();
  const db: SqlClient = adapt(pg);
  const migrations = loadMigrations().slice(0, count);
  for (const m of migrations.slice(0, 3)) await pg.exec(m.sql);
  await applyMigrations(db, migrations.slice(3));
  await backfillLedger(db, migrations.slice(0, 3).map((m) => ({
    version: m.name, appliedAt: "2026-08-20T00:00:00Z", appliedBy: "postgres", note: "fixture",
  })));
  await provisionAppLogin(db, "fixture-app-login-password");
  const q = async (sql: string, p: unknown[] = []) => (await pg.query<{ id: string }>(sql, p)).rows[0]?.id;
  const org = await q("INSERT INTO organizations (slug, name) VALUES ('p-org', 'Profiles Org') RETURNING id");
  await q("INSERT INTO organizations (slug, name) VALUES ('other-org', 'Another tenant') RETURNING id");
  const { hash, algo } = await hashPassword(PASSWORD);
  const owner = await q(`INSERT INTO users (email, display_name, password_hash, password_algo, password_set_at)
                         VALUES ($1, 'Owner', $2, $3, now()) RETURNING id`, [OWNER, hash, algo]);
  const sales = await q("INSERT INTO users (email, display_name) VALUES ('sales@profiles.test', 'Sales') RETURNING id");
  await pg.query("INSERT INTO memberships (user_id, organization_id, role) VALUES ($1,$2,'owner'), ($3,$2,'sales')", [owner, org, sales]);
  const p1 = await q(`INSERT INTO prospects (organization_id, prospect_id, name, notes, status, created_by)
                      VALUES ($1, gen_random_uuid(), 'Anchored Café', 'legacy body', 'lead', $2) RETURNING id`, [org, owner]);
  await q(`INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, name)
           VALUES ($1, NULL, 'held', 'two candidate listings', 'Held Bakery') RETURNING id`, [org]);
  const p3 = await q(`INSERT INTO prospects (organization_id, prospect_id, name, status, created_by)
                      VALUES ($1, gen_random_uuid(), 'Closed Diner', 'closed-lost', $2) RETURNING id`, [org, owner]);
  for (const [p, body] of [[p1, "first call"], [p3, "history that must survive"]]) {
    await pg.query("INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
      [org, p, owner, body]);
  }
  if (count === 9) await pg.query("UPDATE prospects SET archived_at = now(), archived_by = $2 WHERE id = $1", [p3, owner]);
  for (const seq of [7, 8, 400]) {
    await pg.query(`INSERT INTO events (seq, event_id, organization_id, type, occurred_at, actor, actor_user_id, subject_entity, subject_entity_id, data)
                    VALUES ($1::bigint, gen_random_uuid(), $2, 'prospect.note_added', now() - make_interval(mins => $1::int), 'operator', $3, 'prospect', $4, '{}')`,
      [seq, org, owner, p1]);
  }
  await pg.query("SELECT setval('events_seq_seq', 400)");
  await pg.query(`INSERT INTO invitations (organization_id, user_id, token_hash, created_by, expires_at)
                  VALUES ($1, $2, $3, $4, now() + interval '7 days')`, [org, sales, sha256("fixture-token"), owner]);
  return pg;
}

async function build(which: "pre" | "post"): Promise<Built> {
  const pg = await source(which === "pre" ? 8 : 9);
  const manifest = await manifestOf(pg, PINNED_MANIFEST);
  const members = [
    { name: "ascend-public-portable.sql", bytes: Buffer.from(await (await pgDump({ pg, args: ["--schema=public", "--inserts"] })).text()) },
    { name: "globals-nopw.sql", bytes: Buffer.from(await globalsInDumpallFormat(pg)) },
    { name: "source-manifest.tsv", bytes: Buffer.from(formatManifest(manifest)) },
  ];
  await pg.close();
  const envelopeV2 = sealEnvelope(members, key, { format: FORMAT_V2 });
  const real = LEGACY_CONTRACTS.find((c) => c.id === (which === "pre" ? "pre-009-20260919" : "post-009-20260920"))!;
  const entry: LegacyContract = { ...real, id: `fixture-${which}-009`, artifact: "fixture", artifactSha256: sha256(envelopeV2), keyId: readHeader(envelopeV2).keyId };
  const envelopeV3 = which === "post"
    ? seal([...members, { name: MANIFEST_MEMBER, bytes: Buffer.from(PINNED_MANIFEST) }], key, { sourceCommit: COMMIT, applicationProfile: "post-009-v1" })
    : undefined;
  return { envelopeV2, envelopeV3, entry };
}

beforeAll(async () => {
  keyring = mkdtempSync(path.join(tmpdir(), "ascend-rt3b-keys-"));
  key = keyForId(generateKey(keyring).keyId, keyring);
  built.pre = await build("pre");
  built.post = await build("post");
}, 240_000);
afterAll(() => rmSync(keyring, { recursive: true, force: true }));

const resolve = (env: Buffer, legacyContract?: string, seams: ResolutionSeams = {}) => {
  const { header, files } = open(env, key);
  return resolveRecoveryContract({ envelope: env, header, files }, { legacyContract }, seams);
};
const registry = () => [built.pre.entry, built.post.entry];

/** Restore through the canonical path and verify BOTH halves: the contract's manifest, then its profile. */
async function prove(env: Buffer, contract: RecoveryContract) {
  const { files } = open(env, key);
  const get = (n: string) => files.find((f) => f.name === n)!.bytes.toString("utf8");
  const pg = new PGlite();
  await restoreInto(targetOf(pg), { dump: get("ascend-public-portable.sql"), globals: get("globals-nopw.sql") });
  const source = parseManifest(get("source-manifest.tsv"));
  const cmp = compareManifests(source, await manifestOf(pg, contract.manifestSql));
  const s = sessionOf(pg);
  const profile = await runApplicationProfile(contract, { admin: s, app: s, ownerEmail: OWNER, ownerPassword: PASSWORD,
    sourceEventOrderDigest: source.get("F6.events.order.digest") });
  return { pg, cmp, profile };
}

describe("RT-3B · each historical schema verifies under ITS OWN application profile", () => {
  it.each([
    ["1 · post-009 legacy (v2) — pinned profile post-009-v1", "post", "v2"],
    ["pre-009 legacy (v2) — pinned profile pre-009-v1", "pre", "v2"],
    ["post-009 self-describing (v3) — sealed profile post-009-v1", "post", "v3"],
  ] as const)("%s: manifest and application profile both pass", async (_label, which, fmt) => {
    const b = built[which];
    const env = fmt === "v2" ? b.envelopeV2 : b.envelopeV3!;
    const contract = fmt === "v2" ? resolve(env, b.entry.id, { registry: registry() }) : resolve(env);
    expect(contract.applicationProfile).toBe(which === "pre" ? "pre-009-v1" : "post-009-v1");
    const r = await prove(env, contract);
    try {
      expect({ differing: r.cmp.differing, missing: r.cmp.missing, unexpected: r.cmp.unexpected }).toEqual({ differing: [], missing: [], unexpected: [] });
      expect(r.profile.profile).toBe(contract.applicationProfile);
      expect(r.profile.checks.filter((c) => !c.ok).map((c) => `${c.id} (${c.detail})`)).toEqual([]);
      if (which === "post") expect(r.profile.measured.prospects).toEqual({ total: [3, 3], active: [2, 2], archived: [1, 1] });
      else expect(r.profile.measured.prospects).toEqual({ visible: 3, restored: 3 });
    } finally { await r.pg.close(); }
  }, 120_000);

  it("the profiles are not vacuous: a restore whose owner cannot log in, sees too little, or sees another tenant FAILS its profile", async () => {
    const contract = resolve(built.post.envelopeV2, built.post.entry.id, { registry: registry() });
    const r = await prove(built.post.envelopeV2, contract);
    try {
      const s = sessionOf(r.pg);
      const wrongPassword = await runApplicationProfile(contract, { admin: s, app: s, ownerEmail: OWNER, ownerPassword: "not-it" });
      expect(wrongPassword.checks.find((c) => c.id === "APP.credential")!.ok).toBe(false);
      await r.pg.exec("DROP POLICY IF EXISTS prospects_read ON prospects; DROP POLICY IF EXISTS prospects_select ON prospects;");
      const policies = (await r.pg.query<{ p: string }>("SELECT policyname AS p FROM pg_policies WHERE tablename = 'prospects' AND cmd IN ('SELECT','ALL')")).rows;
      for (const { p } of policies) await r.pg.exec(`DROP POLICY "${p}" ON prospects`);
      const blind = await runApplicationProfile(contract, { admin: s, app: s, ownerEmail: OWNER, ownerPassword: PASSWORD });
      expect(blind.checks.find((c) => c.id === "APP.prospects")!.ok).toBe(false);
      // A restore that leaks across tenants: a policy exposing every note to any organization.
      await r.pg.exec("CREATE POLICY rt3b_leak ON prospect_notes FOR SELECT TO ascend_owner USING (true)");
      const leaky = await runApplicationProfile(contract, { admin: s, app: s, ownerEmail: OWNER, ownerPassword: PASSWORD });
      expect(leaky.checks.find((c) => c.id === "APP.tenant-isolation")!.ok).toBe(false);
    } finally { await r.pg.close(); }
  }, 120_000);
});

describe("RT-3B · 2 · a CURRENT reader that assumes a newer schema does not decide a historical proof", () => {
  it("today's listProspects cannot read the pre-009 restore (it selects archived_at) — and the pre-009 profile verifies it anyway", async () => {
    const contract = resolve(built.pre.envelopeV2, built.pre.entry.id, { registry: registry() });
    const r = await prove(built.pre.envelopeV2, contract);
    try {
      // The incompatibility is real, not hypothetical: HEAD's reader breaks on this schema.
      await expect(listProspects(adapt(r.pg), { includeArchived: true })).rejects.toThrow(/archived_at/);
      // …and the recovery proof never asks it.
      expect(r.profile.checks.filter((c) => !c.ok)).toEqual([]);
    } finally { await r.pg.close(); }
  }, 120_000);

  it("profiles import no application reader: only Node builtins and the registry", () => {
    const src = readFileSync(path.join(process.cwd(), "core", "recovery", "profiles.ts"), "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./profile-registry", "node:crypto"]);
    const registrySrc = readFileSync(path.join(process.cwd(), "core", "recovery", "profile-registry.ts"), "utf8");
    expect([...registrySrc.matchAll(/^import /gm)]).toHaveLength(0);
  });

  it("9/10 · R1b and BOTH R1c legs run the contract's profile, and import no application reader", () => {
    for (const suite of ["restore-independence.test.ts", "restore-same-version.test.ts"]) {
      const src = readFileSync(path.join(process.cwd(), "tests", "db", suite), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src, suite).toMatch(/runApplicationProfile\(artifact\.contract, \{/);
      expect([...src.matchAll(/runApplicationProfile\(/g)], suite).toHaveLength(1);
      for (const banned of ["@/core/db\"", "@/core/auth/", "recovery-readers", "listProspects", "readEvents", "credentialFor", "resolvePrincipal"]) {
        expect(src.includes(banned), `${suite} uses ${banned}`).toBe(false);
      }
    }
    // R1c: the profile runs inside `leg(…)`, which both restore paths instantiate.
    const r1c = readFileSync(path.join(process.cwd(), "tests", "db", "restore-same-version.test.ts"), "utf8");
    const legBody = r1c.slice(r1c.indexOf("function leg("), r1c.indexOf("// ─── the suite"));
    expect(legBody).toContain("runApplicationProfile(artifact.contract");
    expect([...r1c.matchAll(/^\s*leg\("leg[12]"/gm)]).toHaveLength(2);
  });
});

describe("RT-3B · fail closed: no profile, an unknown profile, or the wrong one", () => {
  it("3 · an unknown profile is refused — at resolution and at run time", () => {
    const e = { ...built.post.entry, applicationProfile: "post-010-v1" };
    expect(() => resolve(built.post.envelopeV2, e.id, { registry: [e] })).toThrow(/unknown application verification profile post-010-v1/);
    return expect(runApplicationProfile({ applicationProfile: "latest", ledger: built.post.entry.ledger },
      { admin: null as never, app: null as never, ownerEmail: "", ownerPassword: "" })).rejects.toThrow(ProfileRefused);
  });

  it("4 · a missing profile is refused: legacy contract without one, run without one, v3 provenance without one", () => {
    const e = { ...built.post.entry, applicationProfile: undefined } as unknown as LegacyContract;
    expect(() => resolve(built.post.envelopeV2, e.id, { registry: [e] })).toThrow(/names no application verification profile/);
    const blank = { ...built.post.entry, applicationProfile: "" };
    expect(() => resolve(built.post.envelopeV2, blank.id, { registry: [blank] })).toThrow(/names no application verification profile/);
    // v3: a key holder re-seals with a provenance that has no profile — refused as provenance.
    const { header, files } = open(built.post.envelopeV3!, key);
    const rest: Partial<Provenance> = { ...header.provenance! }; delete rest.applicationProfile;
    const noProfile = sealEnvelope(files.filter((f) => f.name !== "PROVENANCE.json")
      .concat({ name: "PROVENANCE.json", bytes: Buffer.from(JSON.stringify(rest) + "\n") }), key, { format: FORMAT_V3, provenance: rest as Provenance });
    expect(() => resolve(noProfile)).toThrow(/provenance was refused.*(fields are|applicationProfile)/s);
  });

  it("5/7 · a profile written for a different ledger is refused — legacy contract, v3 provenance, and direct run", async () => {
    const wrong = { ...built.post.entry, applicationProfile: "pre-009-v1" };
    expect(() => resolve(built.post.envelopeV2, wrong.id, { registry: [wrong] })).toThrow(/pre-009-v1, which is not written for this artifact's ledger/);
    const wrongPre = { ...built.pre.entry, applicationProfile: "post-009-v1" };
    expect(() => resolve(built.pre.envelopeV2, wrongPre.id, { registry: [wrongPre] })).toThrow(/post-009-v1, which is not written/);
    await expect(runApplicationProfile({ applicationProfile: "pre-009-v1", ledger: built.post.entry.ledger },
      { admin: null as never, app: null as never, ownerEmail: "", ownerPassword: "" })).rejects.toThrow(/not written for this artifact's ledger/);
  });

  it("5 · a contract whose ledger CLAIM disagrees with the restored schema fails the profile's own schema check", async () => {
    const pre = resolve(built.pre.envelopeV2, built.pre.entry.id, { registry: registry() });
    const post = resolve(built.post.envelopeV2, built.post.entry.id, { registry: registry() });
    const onPost = await prove(built.post.envelopeV2, post);
    const onPre = await prove(built.pre.envelopeV2, pre);
    try {
      const run = (c: RecoveryContract, pg: PGlite) => runApplicationProfile(c, { admin: sessionOf(pg), app: sessionOf(pg), ownerEmail: OWNER, ownerPassword: PASSWORD });
      const preOnPost = await run(pre, onPost.pg);    // "001–008" claimed for a 001–009 database
      expect(preOnPost.checks.find((c) => c.id === "APP.schema-is-the-profile's")!.ok).toBe(false);
      const postOnPre = await run(post, onPre.pg);    // "001–009" claimed for a 001–008 database
      expect(postOnPre.checks.find((c) => c.id === "APP.schema-is-the-profile's")!.ok).toBe(false);
    } finally { await onPost.pg.close(); await onPre.pg.close(); }
  }, 120_000);

  it("6 · v3: tampering with the profile — header only, or header and record together — is refused", () => {
    const { header, files } = open(built.post.envelopeV3!, key);
    const swapped = { ...header.provenance!, applicationProfile: "pre-009-v1" };
    const headerOnly = sealEnvelope(files, key, { format: FORMAT_V3, provenance: swapped });
    expect(() => resolve(headerOnly)).toThrow(/disagrees with the header/);
    // Consistent claims, sealed by a key holder: the profile is still not written for this ledger.
    const both = seal(files.filter((f) => f.name !== "PROVENANCE.json"), key, { sourceCommit: COMMIT, applicationProfile: "pre-009-v1" });
    expect(() => resolve(both)).toThrow(/pre-009-v1, which is not written for this artifact's ledger/);
    const unknown = seal(files.filter((f) => f.name !== "PROVENANCE.json"), key, { sourceCommit: COMMIT, applicationProfile: "latest" });
    expect(() => resolve(unknown)).toThrow(/unknown application verification profile latest/);
  });

  it("8 · a profile executes nothing from the artifact: it ignores the contract's manifest text entirely", async () => {
    const contract = resolve(built.post.envelopeV2, built.post.entry.id, { registry: registry() });
    const r = await prove(built.post.envelopeV2, contract);
    try {
      const s = sessionOf(r.pg);
      const poisoned = { ...contract, manifestSql: "DROP TABLE prospects; -- never run" };
      const out = await runApplicationProfile(poisoned, { admin: s, app: s, ownerEmail: OWNER, ownerPassword: PASSWORD });
      expect(out.checks.filter((c) => !c.ok)).toEqual([]);
      expect(Number((await r.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM prospects")).rows[0].n)).toBe(3);
    } finally { await r.pg.close(); }
    const src = readFileSync(path.join(process.cwd(), "core", "recovery", "profiles.ts"), "utf8");
    for (const banned of ["manifestSql", ".exec(", "BundleFile", "readFileSync", "eval(", "Function("]) expect(src.includes(banned), banned).toBe(false);
  }, 120_000);

  it("there is no implicit or 'latest' profile: registration, implementation and ledgers agree exactly", () => {
    expect(APPLICATION_PROFILES.map((p) => p.id).sort()).toEqual([...IMPLEMENTED_PROFILES]);
    expect(String(APPLICATION_PROFILE_ID)).toBe(String(PROFILE_ID));
    for (const p of APPLICATION_PROFILES) expect(PROFILE_ID.test(p.id), p.id).toBe(true);
    for (const c of LEGACY_CONTRACTS) {
      const p = APPLICATION_PROFILES.find((x) => x.id === c.applicationProfile);
      expect(p, c.id).toBeDefined();
      expect(p!.ledger, c.id).toEqual(c.ledger);
    }
    expect(LEGACY_CONTRACTS.map((c) => [c.id, c.applicationProfile])).toEqual([["pre-009-20260919", "pre-009-v1"], ["post-009-20260920", "post-009-v1"]]);
    const ledgers = APPLICATION_PROFILES.filter((p) => p.forNewArtifacts).map((p) => p.ledger.join(","));
    expect(new Set(ledgers).size).toBe(ledgers.length);
  });

  it("3 · the NEXT backup's profile: exactly one for the repository's ledger — adding a migration without a profile fails here and in the backup", () => {
    const repo = loadMigrations().map((m) => `${m.name}:${m.checksum}`);
    expect(profileForNewArtifact(repo)).toBe("post-009-v1");
    expect(() => profileForNewArtifact([...repo, `010_future.sql:${"0".repeat(64)}`])).toThrow(/no single application verification profile/);
  });

  it("the backup selects the profile for the ledger production reported, and seals it", () => {
    const sh = readFileSync(path.join(process.cwd(), "scripts", "backup-production.sh"), "utf8");
    expect(sh).toMatch(/profile-registry\.ts" for-ledger "\$ACTUAL"/);
    expect(sh).toMatch(/--application-profile "\$APPLICATION_PROFILE"/);
  });

  it("a profile failure at resolution is a RestoreRefused — the operator sees one kind of refusal", () => {
    const e = { ...built.post.entry, applicationProfile: "nope-v1" };
    expect(() => resolve(built.post.envelopeV2, e.id, { registry: [e] })).toThrow(RestoreRefused);
  });
});
