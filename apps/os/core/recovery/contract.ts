// core/recovery/contract — RT-3: WHICH recovery specification an artifact is verified against.
//
// ─── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
//
// Recovery verification ran the repository's CURRENT `manifest.sql` (and compared the restored ledger
// with the repository's CURRENT migrations) against every artifact, whenever it was taken. Correct only
// while neither ever changed. Migration 010 must extend the manifest, and at that moment the accepted
// post-009 artifact could no longer be proven: the manifest would query tables its restore does not
// have, and its ledger would stop being "the repository's". (The pre-009 artifact already cannot pass
// the old ledger check at HEAD — 009 landed after it.)
//
// ─── THE RULE ──────────────────────────────────────────────────────────────────────────────────
//
// An artifact is verified against ONE contract, resolved here, and against nothing else:
//
//   ascend-backup/3   its OWN sealed contract — the embedded manifest bytes, their hash, the ledger
//                     and exclusions, every binding checked by `verifyProvenance` before any manifest
//                     byte is executed. Naming a legacy contract for it is refused (ambiguity).
//   ascend-backup/2   a contract PINNED for it in `legacy-contracts.ts`, which the operator must NAME.
//                     The artifact's hash must be the one the contract pins, the frozen manifest's
//                     hash the one it records, and the artifact's own source ledger the one it records.
//
// The repository's `manifest.sql` is never a contract for an existing artifact. It is only what the
// NEXT backup will run and seal.

import { readFileSync } from "node:fs";
import {
  FORMAT_V2, FORMAT_V3, SOURCE_MANIFEST_MEMBER, ledgerOfSourceManifest, sha256, verifyProvenance,
  type ArtifactFormat, type BundleFile, type Header,
} from "./artifact";
import { LEGACY_CONTRACTS, type LegacyContract } from "./legacy-contracts";
import { profileFitsLedger, profileSpec } from "./profile-registry";
import { RestoreRefused, assertManifestShape, type VerificationContract } from "./restore";

export type RecoveryContract = VerificationContract & {
  /** `sealed`: carried by the artifact itself. `legacy-pinned`: named from the legacy registry. */
  readonly kind: "sealed" | "legacy-pinned";
  /** For display: the legacy id, or `sealed@<commit>`. */
  readonly id: string;
  readonly artifactFormat: ArtifactFormat;
  readonly manifestSha256: string;
  /** `name:checksum` — the ledger the restored database must report (F17). */
  readonly ledger: readonly string[];
  readonly ledgerHead: string;
  /** v3: the commit the backup ran from. Legacy: a commit holding the pinned manifest bytes. */
  readonly sourceCommit: string;
  /** RT-3B: the application verification profile — registered, and written for exactly `ledger`. */
  readonly applicationProfile: string;
};

/** Refuse a profile that is missing, unknown, or written for a different ledger. No default, no "latest". */
function assertProfile(id: unknown, ledger: readonly string[], where: string): string {
  if (typeof id !== "string" || id === "") throw new RestoreRefused(`${where} names no application verification profile`);
  if (!profileSpec(id)) throw new RestoreRefused(`${where} names an unknown application verification profile ${id}`);
  if (!profileFitsLedger(id, ledger)) {
    throw new RestoreRefused(`${where} names application profile ${id}, which is not written for this artifact's ledger (head ${ledger[ledger.length - 1]?.split(":")[0]})`);
  }
  return id;
}

export type OpenedArtifact = { envelope: Buffer; header: Header; files: readonly BundleFile[] };
export type ContractSelection = { legacyContract?: string };

const CONTRACT_FILE = /^manifest-[0-9a-f]{8}\.sql$/;

/** The frozen manifest copy a legacy contract names. Its hash is checked by the caller, not trusted here. */
export function readLegacyManifest(entry: LegacyContract): Buffer {
  if (!CONTRACT_FILE.test(entry.manifestFile)) throw new RestoreRefused(`legacy contract ${entry.id} names an invalid manifest file`);
  return readFileSync(new URL(`./contracts/${entry.manifestFile}`, import.meta.url));
}

/** The ledger an artifact's own source manifest reports — the fact every contract must agree with. */
function sourceLedger(files: readonly BundleFile[]): string[] {
  const f = files.filter((x) => x.name === SOURCE_MANIFEST_MEMBER);
  if (f.length !== 1) throw new RestoreRefused(`the artifact has no single ${SOURCE_MANIFEST_MEMBER}`);
  return ledgerOfSourceManifest(f[0].bytes.toString("utf8"));
}

/**
 * Test seams, and only that: `registry` lets the fixture pin its OWN v2 artifact (the real registry
 * pins production artifacts, which a fixture cannot reproduce), and `loadLegacyManifest` lets a test
 * supply the WRONG historical bytes. Recovery never passes either.
 */
export type ResolutionSeams = {
  registry?: readonly LegacyContract[];
  loadLegacyManifest?: (entry: LegacyContract) => Buffer;
};

/** Resolve the one contract `opened` may be verified against, or refuse. */
export function resolveRecoveryContract(
  opened: OpenedArtifact,
  selection: ContractSelection = {},
  seams: ResolutionSeams = {},
): RecoveryContract {
  const registry = seams.registry ?? LEGACY_CONTRACTS;
  const loadLegacyManifest = seams.loadLegacyManifest ?? readLegacyManifest;
  const { header, files, envelope } = opened;

  if (header.format === FORMAT_V3) {
    if (selection.legacyContract !== undefined) {
      throw new RestoreRefused(`this ${FORMAT_V3} artifact carries its own recovery contract; ` +
        `a legacy contract (${selection.legacyContract}) must not be named for it`);
    }
    let v: ReturnType<typeof verifyProvenance>;
    try { v = verifyProvenance(header, files); } catch (e) {
      throw new RestoreRefused(`the artifact's provenance was refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    assertManifestShape(v.manifestSql);
    const p = v.provenance;
    return {
      kind: "sealed", id: `sealed@${p.sourceCommit}`, artifactFormat: FORMAT_V3,
      manifestSql: v.manifestSql, manifestSha256: p.manifestSha256,
      ledger: p.ledger, ledgerHead: p.ledgerHead, coverageExclusions: p.coverageExclusions, sourceCommit: p.sourceCommit,
      applicationProfile: assertProfile(p.applicationProfile, p.ledger, "the artifact's provenance"),
    };
  }

  if (header.format !== FORMAT_V2) throw new RestoreRefused(`unknown artifact format ${String(header.format)}`);
  const id = selection.legacyContract;
  if (id === undefined || id === "") {
    throw new RestoreRefused(`this ${FORMAT_V2} artifact has no embedded recovery contract. Name its pinned ` +
      `contract (--legacy-contract <id>; known: ${registry.map((c) => c.id).join(", ")}). ` +
      "The repository's current manifest.sql is never substituted for it.");
  }
  const entry = registry.find((c) => c.id === id);
  if (!entry) throw new RestoreRefused(`no legacy contract named ${id} (known: ${registry.map((c) => c.id).join(", ")})`);
  const actual = sha256(envelope);
  if (actual !== entry.artifactSha256) {
    throw new RestoreRefused(`legacy contract ${id} pins ${entry.artifact} (sha256 ${entry.artifactSha256.slice(0, 16)}…); ` +
      `this artifact is sha256 ${actual.slice(0, 16)}… — the wrong contract for it`);
  }
  if (header.keyId !== entry.keyId) throw new RestoreRefused(`legacy contract ${id} records key ${entry.keyId}; the artifact names ${header.keyId}`);
  const bytes = loadLegacyManifest(entry);
  if (sha256(bytes) !== entry.manifestSha256) {
    throw new RestoreRefused(`the frozen manifest for legacy contract ${id} does not hash to ${entry.manifestSha256.slice(0, 16)}… — refusing it`);
  }
  const manifestSql = bytes.toString("utf8");
  assertManifestShape(manifestSql);
  if (sourceLedger(files).join(",") !== entry.ledger.join(",")) {
    throw new RestoreRefused(`the artifact's source ledger (F17) is not the ledger legacy contract ${id} records`);
  }
  return {
    kind: "legacy-pinned", id, artifactFormat: FORMAT_V2,
    manifestSql, manifestSha256: entry.manifestSha256,
    ledger: entry.ledger, ledgerHead: entry.ledger[entry.ledger.length - 1].split(":")[0],
    coverageExclusions: entry.coverageExclusions, sourceCommit: entry.manifestCommit,
    applicationProfile: assertProfile(entry.applicationProfile, entry.ledger, `legacy contract ${id}`),
  };
}

/** The tables a contract's manifest counts (F3) — the list every per-table sweep must use. */
export function contractTables(contract: VerificationContract): string[] {
  return [...contract.manifestSql.matchAll(/'F3\.rows\.([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]).sort();
}
