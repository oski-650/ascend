// tests/support/recovery-artifact — RT-3: how every artifact-backed recovery proof OPENS its artifact
// and RESOLVES its contract. One implementation for R1b and R1c.
//
// Opening and contract resolution happen together, before any restore: the key the artifact names,
// authenticated decryption, then `resolveRecoveryContract` — the artifact's own sealed contract
// (`ascend-backup/3`), or the legacy contract the operator named for it (`ascend-backup/2`,
// `--legacy-contract <id>` → ASCEND_RECOVERY_LEGACY_CONTRACT). Every manifest run, ledger check and
// per-table sweep afterwards takes its manifest from `contract`, never from the repository.

import { readFileSync } from "node:fs";
import { keyForId, open, readHeader, type BundleFile, type Header } from "@/core/recovery/artifact";
import { resolveRecoveryContract, type RecoveryContract } from "@/core/recovery/contract";
import { parseManifest, type Manifest } from "@/core/recovery/restore";

export type RecoveryArtifact = {
  envelope: Buffer;
  header: Header;
  files: readonly BundleFile[];
  member(name: string): Buffer;
  contract: RecoveryContract;
  /** The manifest production reported at dump time (`source-manifest.tsv`). */
  source: Manifest;
};

export function openRecoveryArtifact(artifactPath: string, keyring: string, legacyContract?: string): RecoveryArtifact {
  const envelope = readFileSync(artifactPath);
  const header = readHeader(envelope);
  const { files } = open(envelope, keyForId(header.keyId, keyring));
  const contract = resolveRecoveryContract({ envelope, header, files }, { legacyContract: legacyContract || undefined });
  const member = (n: string) => {
    const f = files.find((x) => x.name === n);
    if (!f) throw new Error(`the artifact has no ${n}`);
    return f.bytes;
  };
  return { envelope, header, files, member, contract, source: parseManifest(member("source-manifest.tsv").toString("utf8")) };
}

/** F17 as `name:checksum`, from a manifest — the form a contract's ledger is recorded in. */
export const ledgerOf = (m: Manifest): string[] =>
  (m.get("F17.ledger") ?? "").split(",").filter(Boolean).map((l) => l.split(":").slice(0, 2).join(":"));
