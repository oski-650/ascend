// core/recovery/recovery-points — THE ACCEPTED `ascend-backup/3` RECOVERY POINTS (RECOVERY-CURRENT-001).
//
// A v3 artifact seals its own recovery contract (manifest, ledger, application profile) in its
// authenticated provenance, so it needs no entry in legacy-contracts.ts and no `--legacy-contract`
// id. What it still needs is a PIN: which artifact, by the SHA-256 of its whole envelope, the owner
// proof restores. `selectArtifact` (scripts/proof-orchestrator.mjs) takes exactly one entry marked
// "CURRENT recovery point" across this file and LEGACY_CONTRACTS together, and refuses zero or two.
//
// APPEND-ONLY, like legacy-contracts.ts. An entry is a recorded fact about an artifact that was
// already produced and proven; when a newer point replaces it, only its `acceptedIn` changes, from
// CURRENT to HISTORICAL, and every other field stays byte-identical.

export type RecoveryPoint = Readonly<{
  /** The artifact's file name in ~/AscendBackups. Identity is `artifactSha256`, not the name. */
  artifact: string;
  /** SHA-256 of the whole envelope — the value in the artifact's `.sha256` sidecar. */
  artifactSha256: string;
  artifactFormat: "ascend-backup/3";
  keyId: string;
  /** The last migration of the ledger the artifact sealed. */
  ledgerHead: string;
  /** The application verification profile the artifact sealed (core/recovery/profile-registry.ts). */
  applicationProfile: string;
  /** The commit the backup ran from, as sealed in its provenance. */
  sourceCommit: string;
  /** Where the artifact's acceptance is recorded, and whether it is the CURRENT recovery point. */
  acceptedIn: string;
}>;

export const RECOVERY_POINTS: readonly RecoveryPoint[] = Object.freeze([
  {
    artifact: "ascend-backup-20260930T030242Z-post-010.ascbk",
    artifactSha256: "3fddddcf37cb6b6abe97e6f848311d4c463f52287547b2df97fb5691d1b1a70f",
    artifactFormat: "ascend-backup/3",
    keyId: "3b44ac35c74f2ff0",
    ledgerHead: "010_sales_actions.sql",
    applicationProfile: "post-010-v1",
    sourceCommit: "ad86aa20c1c9aa53004fe71bc220c02ac741b74a",
    acceptedIn: "2A.3a-2 T12 (2026-09-30), R1b and R1c proven; docs/RECOVERY-CURRENT-001-CHECKPOINT.md; CURRENT recovery point",
  },
] satisfies RecoveryPoint[]);
