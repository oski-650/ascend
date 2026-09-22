// core/recovery/legacy-contracts — THE PINNED RECOVERY CONTRACTS OF LEGACY (`ascend-backup/2`) ARTIFACTS (RT-3).
//
// A v2 artifact does not say which manifest it was taken with. Before RT-3 the verifier simply ran
// the repository's current `core/recovery/manifest.sql` — correct only while that file never changed.
// Migration 010 must change it, and at that moment the accepted recovery points would have become
// unverifiable (the current manifest would query tables their restores do not have) or, worse,
// verifiable against a contract they were never taken under.
//
// So every accepted v2 artifact is named here, by the SHA-256 of its envelope, with the contract it
// was accepted under: the exact manifest bytes (a frozen, content-addressed copy under
// `contracts/`, checked by hash before use), the migration ledger its source reported, and the RT-2
// exclusions in force. The verifier uses an entry only when the operator NAMES it
// (`--legacy-contract <id>`) and the artifact's own hash matches it. There is no fallback: a v2
// artifact without a named contract, or with the wrong one, is refused.
//
// APPEND-ONLY. An entry is a recorded fact about an artifact that has already been accepted; it is
// never edited to make a later check pass. Artifacts are never re-sealed to acquire provenance.

export type LegacyContract = Readonly<{
  /** What the operator names: `--legacy-contract <id>`. */
  id: string;
  /** The artifact's file name, for the operator. Identity is `artifactSha256`, not the name. */
  artifact: string;
  /** SHA-256 of the whole envelope — the value in the artifact's `.sha256` sidecar. */
  artifactSha256: string;
  artifactFormat: "ascend-backup/2";
  keyId: string;
  /** The frozen manifest copy, in core/recovery/contracts/. */
  manifestFile: string;
  manifestSha256: string;
  /** A commit whose `apps/os/core/recovery/manifest.sql` has exactly these bytes. */
  manifestCommit: string;
  /** `name:checksum` of every migration the artifact's source ledger reported (F17), in order. */
  ledger: readonly string[];
  coverageExclusions: Readonly<Record<string, string>>;
  /** RT-3B: the application verification profile (core/recovery/profile-registry.ts). Required. */
  applicationProfile: string;
  /** Where the artifact's acceptance is recorded. */
  acceptedIn: string;
  /** What is and is not known about the manifest the backup itself ran. */
  provenanceNote: string;
}>;

const LEDGER_001_008 = [
  "001_substrate.sql:992f0caccaee0e42c8450115e6efb2a8308bc13274d6425208658e4f4c5e92be",
  "002_prospect_fields.sql:ffd2a00944de21028c4065211e5d592654de1a63374e75b3ebac7784d33eb912",
  "003_prospect_notes.sql:648d41432f940ef8067d32b0dd5391cede393e4bae229f8cb91ab8058659c7df",
  "004_schema_migrations.sql:43c8109a68143a53ab818896652f9c1aac9ce79a9c116594d0f48fe0e364f55f",
  "005_user_credentials.sql:d3b4fdbb8e8779a6defe6168d43700f96891c3062aa27d3e6f338fa538d943e3",
  "006_invitations.sql:b0c6c5aa5b358fd60ab78a4fcee12252a0a72cfb2a36178f7c333ceb1e817990",
  "007_invitation_membership.sql:cf55f6f63ab7088454ffde08cf87975d2a46d714a65601ad94dd3b074d89fb9a",
  "008_prospect_notes_log.sql:62ca23d811452e3651c11bec539ed8c74404338dec8b2394588f9bc78bdde823",
] as const;

export const LEGACY_CONTRACTS: readonly LegacyContract[] = Object.freeze([
  {
    id: "pre-009-20260919",
    artifact: "ascend-backup-20260919T120457Z-r1b.ascbk",
    artifactSha256: "3dda24871a7649dc0a1632406f89b2f5db600b99166350feaeb65e0e94f75c00",
    artifactFormat: "ascend-backup/2",
    keyId: "3b44ac35c74f2ff0",
    manifestFile: "manifest-4f20059f.sql",
    manifestSha256: "4f20059f61e0f8e55d0a1c33dac7358a454a0d321da1849ca967afc1ff3457a2",
    manifestCommit: "dd46b957d3af87faca1b37cbb06a9a14ee1e99b1",
    ledger: LEDGER_001_008,
    coverageExclusions: {},
    applicationProfile: "pre-009-v1",
    acceptedIn: "docs/DEPENDENCY-R1B-CHECKPOINT.md (R1b, 2026-09-19); HISTORICAL since D1b.2",
    provenanceNote:
      "RECONSTRUCTED, not recorded: the pinned manifest is the one this artifact was accepted under at R1b " +
      "(dd46b95). It is NOT proven byte-identical to the unrecorded manifest bytes the backup itself ran — " +
      "the artifact was taken during R1b, while the F5 `contype <> 'n'` filter was being added. On a " +
      "PostgreSQL 17 source both candidate versions produce identical output. Re-proven under this pinned " +
      "contract and application profile pre-009-v1 on PostgreSQL 17.6 (R1b and two-leg R1c), 2026-09-22.",
  },
  {
    id: "post-009-20260920",
    artifact: "ascend-backup-20260920T104952Z-post-009.ascbk",
    artifactSha256: "5958f3fcbde0e0e6f942017bf68e1cbc261ee11042489af70e8526e5302e314f",
    artifactFormat: "ascend-backup/2",
    keyId: "3b44ac35c74f2ff0",
    manifestFile: "manifest-4f20059f.sql",
    manifestSha256: "4f20059f61e0f8e55d0a1c33dac7358a454a0d321da1849ca967afc1ff3457a2",
    manifestCommit: "dd46b957d3af87faca1b37cbb06a9a14ee1e99b1",
    ledger: [...LEDGER_001_008, "009_prospect_archival.sql:f1c3b225e557fdb520984befb6742eaa3d3772e8ae7386ca8de3f3f40cd7062d"],
    coverageExclusions: {},
    applicationProfile: "post-009-v1",
    acceptedIn: "docs/DEPENDENCY-D1B2-CHECKPOINT.md (D1b.2, 2026-09-20); CURRENT recovery point",
    provenanceNote:
      "manifest.sql was last changed in dd46b95 (2026-09-19) and is byte-identical at 9ed881e, so these " +
      "are the bytes the 2026-09-20 backup ran; R1b and R1c key-for-key comparisons passed under them.",
  },
] satisfies LegacyContract[]);
