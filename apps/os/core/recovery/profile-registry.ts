// core/recovery/profile-registry — THE APPLICATION VERIFICATION PROFILES a recovery contract may name (RT-3B).
//
// ─── WHY ───────────────────────────────────────────────────────────────────────────────────────
//
// RT-3 made the DATABASE half of a recovery proof historical: an artifact is verified with the
// manifest and ledger it was taken or accepted under. The APPLICATION half — "the owner can log in,
// resolves to their organization, sees every prospect, note and event" — still ran TODAY's readers,
// so an old artifact could have the right manifest and still fail because a current reader expects a
// newer column. An application verification PROFILE fixes the business-level assertions for one
// exact schema, as reviewed repository code (core/recovery/profiles.ts), so old artifacts never
// depend on today's readers staying backwards compatible.
//
// ─── RULES ─────────────────────────────────────────────────────────────────────────────────────
//
//   · A profile applies to EXACTLY ONE ledger (`name:checksum`, in order). A contract naming a profile
//     for any other ledger is refused. There is no "latest" and no default.
//   · An artifact SELECTS a profile by id — sealed in its authenticated provenance (v3) or pinned in
//     its legacy contract (v2). It never supplies profile code.
//   · APPEND-ONLY once an accepted artifact depends on a profile. A correction is a NEW profile id; a
//     change to an existing profile is permitted only to fix a proven verifier bug, recorded in
//     `corrections` with the date and evidence.
//   · `forNewArtifacts: true` marks the ONE profile the backup seals for a given ledger. When a
//     migration changes the ledger, a new profile must be added with it, or the backup refuses to seal
//     and a test fails.
//
// NODE BUILTINS ONLY (none needed): `scripts/backup-production.sh` runs this file directly with `node`.

export type ApplicationProfileSpec = Readonly<{
  id: string;
  /** The exact ledger this profile's assertions are written for. */
  ledger: readonly string[];
  /** Whether a NEW backup whose ledger is `ledger` seals this profile. At most one per ledger. */
  forNewArtifacts: boolean;
  description: string;
  /** Recorded verifier-bug fixes, if any. Semantics never change silently. */
  corrections: readonly string[];
}>;

export const PROFILE_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

const L001_008 = [
  "001_substrate.sql:992f0caccaee0e42c8450115e6efb2a8308bc13274d6425208658e4f4c5e92be",
  "002_prospect_fields.sql:ffd2a00944de21028c4065211e5d592654de1a63374e75b3ebac7784d33eb912",
  "003_prospect_notes.sql:648d41432f940ef8067d32b0dd5391cede393e4bae229f8cb91ab8058659c7df",
  "004_schema_migrations.sql:43c8109a68143a53ab818896652f9c1aac9ce79a9c116594d0f48fe0e364f55f",
  "005_user_credentials.sql:d3b4fdbb8e8779a6defe6168d43700f96891c3062aa27d3e6f338fa538d943e3",
  "006_invitations.sql:b0c6c5aa5b358fd60ab78a4fcee12252a0a72cfb2a36178f7c333ceb1e817990",
  "007_invitation_membership.sql:cf55f6f63ab7088454ffde08cf87975d2a46d714a65601ad94dd3b074d89fb9a",
  "008_prospect_notes_log.sql:62ca23d811452e3651c11bec539ed8c74404338dec8b2394588f9bc78bdde823",
] as const;
const L009 = "009_prospect_archival.sql:f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d";

export const APPLICATION_PROFILES: readonly ApplicationProfileSpec[] = Object.freeze([
  {
    id: "pre-009-v1",
    ledger: L001_008,
    forNewArtifacts: false,
    description:
      "Schema 001–008 (before prospect archival). The R1b/R1c application acceptance of 2026-09-19: owner " +
      "credential, principal resolution, organization membership, every prospect (no archival exists), " +
      "notes in both stores, every event in contracted order, invitations under RLS, tenant isolation, " +
      "role grants.",
    corrections: [],
  },
  {
    id: "post-009-v1",
    ledger: [...L001_008, L009],
    forNewArtifacts: true,
    description:
      "Schema 001–009 (prospect archival). The D1b.2 / 2A.0 application acceptance: everything in " +
      "pre-009-v1, with prospects counted as total, active and archived separately, and notes on " +
      "archived prospects verified as their own line.",
    corrections: [],
  },
]);

export function profileSpec(id: string): ApplicationProfileSpec | undefined {
  return APPLICATION_PROFILES.find((p) => p.id === id);
}

/** Is `id` a registered profile written for exactly `ledger`? */
export function profileFitsLedger(id: string, ledger: readonly string[]): boolean {
  const p = profileSpec(id);
  return p !== undefined && p.ledger.join(",") === ledger.join(",");
}

/** The ONE profile a new backup with `ledger` seals. Throws when there is none, or more than one. */
export function profileForNewArtifact(ledger: readonly string[]): string {
  const fits = APPLICATION_PROFILES.filter((p) => p.forNewArtifacts && p.ledger.join(",") === ledger.join(","));
  if (fits.length !== 1) {
    throw new Error(`no single application verification profile is registered for new artifacts with this ledger ` +
      `(head ${ledger[ledger.length - 1]?.split(":")[0] ?? "none"}); add one to core/recovery/profile-registry.ts with the migration`);
  }
  return fits[0].id;
}

// CLI, for the backup script:  node core/recovery/profile-registry.ts for-ledger <name:checksum,…>
if (process.argv[1] && process.argv[1].endsWith("profile-registry.ts") && process.argv[2] === "for-ledger") {
  try {
    console.log(profileForNewArtifact((process.argv[3] ?? "").split(",").filter(Boolean)));
  } catch (e) {
    console.error(`profile-registry: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
