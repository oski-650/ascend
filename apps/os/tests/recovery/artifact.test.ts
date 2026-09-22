// Dependency R1a — THE ENCRYPTED RECOVERY ARTIFACT.
//
// Production backups carry credential-derived material and PII, so they are sealed with AES-256-GCM
// under a key that lives in a 0600 file outside the repository, the backup directory and iCloud.
// This suite proves the properties the runbook relies on — every one of them by trying to break it:
//
//   · what is sealed opens, byte for byte, and nothing else does
//   · tampering with ANY part (header, body, tag) refuses to open and releases no plaintext
//   · the wrong key and a missing key are refused by id, and the id cannot open anything
//   · the key never appears inside an artifact, and a key that leaked into the inputs is refused
//   · rotation: an old artifact opens with the key it names, from the keyring, after a new key exists
//   · an interrupted write leaves nothing under the final name
//
// Keys here are generated into temporary keyrings and never printed.

import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  ArtifactError, FORMAT, FORMAT_V2, FORMAT_V3, MANIFEST_MEMBER, PROVENANCE_MEMBER, SEALED_COVERAGE_EXCLUSIONS,
  assertKeyLocation, canonicalProvenance, generateKey, keyForId, keyIdOf, open, readHeader, readKey, seal, sealEnvelope,
  sha256, verifyProvenance, writeSealed, type ArtifactFormat, type BundleFile, type Provenance,
} from "@/core/recovery/artifact";
import { COVERAGE_EXCLUSIONS } from "@/core/recovery/restore";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const dirs: string[] = [];
const temp = (p: string) => { const d = mkdtempSync(path.join(tmpdir(), p)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FILES: BundleFile[] = [
  { name: "ascend-public-portable.sql", bytes: Buffer.from("INSERT INTO public.users VALUES ('ü', '\\n');\n") },
  { name: "recovery-manifest.sql", bytes: Buffer.from("WITH m(k, v) AS (\n  SELECT 'meta.format', 'ascend-recovery-manifest/1'\n)\nSELECT k, v FROM m;\n") },
  { name: "source-manifest.tsv", bytes: Buffer.from(`F17.ledger\t001_substrate.sql:${"a".repeat(64)}:backfilled\nmeta.format\tascend-recovery-manifest/1\n`) },
  { name: "empty.txt", bytes: Buffer.alloc(0) },
];
/** A commit id for sealing. The artifact format proof needs one; it names no real commit. */
const SEAL = { sourceCommit: "0".repeat(40), applicationProfile: "post-009-v1" };
/** Every member as sealed: the inputs plus the PROVENANCE.json `seal` writes. */
const SEALED_NAMES = [...FILES.map((f) => f.name), "PROVENANCE.json"];

function freshKey() {
  const ring = temp("ascend-keys-");
  const { keyId, keyFile } = generateKey(ring);
  return { ring, keyId, keyFile, key: keyForId(keyId, ring) };
}

describe("sealing and opening", () => {
  it("round-trips every member exactly, and the header names the key and the members", () => {
    const { key, keyId } = freshKey();
    const env = seal(FILES, key, SEAL);
    const h = readHeader(env);
    expect(h.format).toBe(FORMAT);
    expect(h.keyId).toBe(keyId);
    expect(h.files.map((f) => f.name)).toEqual(SEALED_NAMES);
    const { files } = open(env, key);
    expect(files.slice(0, FILES.length).map((f) => [f.name, f.bytes.toString("hex")]))
      .toEqual(FILES.map((f) => [f.name, f.bytes.toString("hex")]));
  });

  it("the ciphertext does not contain the plaintext", () => {
    const { key } = freshKey();
    expect(seal(FILES, key, SEAL).includes(FILES[0].bytes)).toBe(false);
  });

  it("two seals of the same content differ (fresh nonce), and both open", () => {
    const { key } = freshKey();
    const a = seal(FILES, key, SEAL), b = seal(FILES, key, SEAL);
    expect(a.equals(b)).toBe(false);
    expect(open(a, key).files.map((f) => f.name)).toEqual(SEALED_NAMES);
    expect(open(b, key).files.map((f) => f.name)).toEqual(SEALED_NAMES);
  });
});

describe("tampering is refused, and nothing is released", () => {
  const { key } = freshKey();
  const env = seal(FILES, key, SEAL);
  const headerLen = env.readUInt32BE(8);
  const flip = (at: number) => { const c = Buffer.from(env); c[at] ^= 0x01; return c; };

  it.each([
    ["a byte of the header (authenticated as AAD)", 12 + Math.floor(headerLen / 2)],
    ["a byte of the ciphertext", 12 + headerLen + 3],
    ["a byte of the authentication tag", env.length - 1],
  ])("flipping %s", (_label, at) => {
    const tampered = flip(at);
    let released: unknown = "nothing";
    try { released = open(tampered, key); } catch (e) { expect(e).toBeInstanceOf(Error); }
    expect(released).toBe("nothing");
  });

  it("a header rewritten to a DIFFERENT BUT VALID value is refused — only the AAD binding can catch this", () => {
    // A random flip is caught by the header's own consistency (JSON, nonce, checksums) even without
    // AAD — mutation-probed in R1a, that test survived AAD's removal. This one does not: `createdAt`
    // is cross-checked by nothing else, so a same-length, well-formed edit opens cleanly unless the
    // header is authenticated.
    const h = readHeader(env);
    const forged = h.createdAt.replace(/^\d{4}/, (y) => String(Number(y) - 1));
    const text = env.subarray(12, 12 + headerLen).toString("utf8").replace(h.createdAt, forged);
    expect(Buffer.byteLength(text)).toBe(headerLen);
    const edited = Buffer.concat([env.subarray(0, 12), Buffer.from(text, "utf8"), env.subarray(12 + headerLen)]);
    expect(readHeader(edited).createdAt).toBe(forged); // the forgery is well-formed
    expect(() => open(edited, key)).toThrow(/failed authentication/);
  });

  it("a truncated artifact is refused", () => {
    expect(() => open(env.subarray(0, env.length - 20), key)).toThrow(ArtifactError);
  });

  it("something that is not an artifact is refused before any key is used", () => {
    expect(() => readHeader(Buffer.from("PGDMP custom dump"))).toThrow(/not an ascend-backup artifact/);
  });
});

describe("keys", () => {
  it("the wrong key is refused by id — and never tried against the body", () => {
    const a = freshKey(), b = freshKey();
    expect(() => open(seal(FILES, a.key, SEAL), b.key)).toThrow(new RegExp(`sealed under key ${a.keyId}`));
  });

  it("a missing key is named by its id, so the operator knows which escrowed key to recover", () => {
    const a = freshKey();
    const env = seal(FILES, a.key, SEAL);
    const emptyRing = temp("ascend-empty-ring-");
    expect(() => keyForId(readHeader(env).keyId, emptyRing)).toThrow(new RegExp(`needs key ${a.keyId}`));
  });

  it("the key id is derived from the key but cannot stand in for it", () => {
    const { key, keyId } = freshKey();
    expect(keyIdOf(key)).toBe(keyId);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(() => open(seal(FILES, key, SEAL), Buffer.from(keyId.padEnd(64, "0"), "hex"))).toThrow(ArtifactError);
  });

  it("ROTATION: after a new key exists, an old artifact still opens with the key it names", () => {
    const ring = temp("ascend-rotating-ring-");
    const first = generateKey(ring);
    const oldEnv = seal(FILES, keyForId(first.keyId, ring), SEAL);
    const second = generateKey(ring); // rotation
    const newEnv = seal(FILES, keyForId(second.keyId, ring), SEAL);
    expect(second.keyId).not.toBe(first.keyId);
    expect(open(oldEnv, keyForId(readHeader(oldEnv).keyId, ring)).files.map((f) => f.name)).toEqual(SEALED_NAMES);
    expect(open(newEnv, keyForId(readHeader(newEnv).keyId, ring)).files.map((f) => f.name)).toEqual(SEALED_NAMES);
  });

  it("a key file readable beyond its owner is refused", () => {
    const { keyFile } = freshKey();
    chmodSync(keyFile, 0o644);
    expect(() => readKey(keyFile)).toThrow(/mode 644/);
  });

  it.each([
    ["inside the repository", path.join(process.cwd(), "k.key"), [process.cwd()]],
    ["inside the backup directory", path.join(homedir(), "AscendBackups", "k.key"), [path.join(homedir(), "AscendBackups")]],
    ["in iCloud Drive", path.join(homedir(), "Library", "Mobile Documents", "k.key"), []],
    ["on the iCloud-synced Desktop", path.join(homedir(), "Desktop", "k.key"), []],
  ])("a key %s is refused", (_label, file, forbidden) => {
    expect(() => assertKeyLocation(file, forbidden)).toThrow(ArtifactError);
  });
});

describe("the key never enters an artifact", () => {
  it("no encoding of the key appears in a sealed artifact", () => {
    const { key } = freshKey();
    const env = seal(FILES, key, SEAL);
    for (const form of [key, Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex"))]) {
      expect(env.includes(form)).toBe(false);
    }
  });

  it.each(["raw", "base64", "hex"] as const)("an input that carries the key (%s) is refused before sealing", (enc) => {
    const { key } = freshKey();
    const leaked = enc === "raw" ? key : Buffer.from(key.toString(enc));
    expect(() => seal([...FILES, { name: "leak.txt", bytes: Buffer.concat([Buffer.from("x"), leaked]) }], key, SEAL))
      .toThrow(/contains the encryption key/);
  });
});

describe("writing is atomic", () => {
  it("a completed write verifies from disk and leaves no partial", () => {
    const { key } = freshKey();
    const out = path.join(temp("ascend-out-"), "a.ascbk");
    writeSealed(out, seal(FILES, key, SEAL), key);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(`${out}.partial`)).toBe(false);
    expect(open(readFileSync(out), key).files.map((f) => f.name)).toEqual(SEALED_NAMES);
  });

  it("a write that fails verification leaves nothing under the final name, and no partial", () => {
    const a = freshKey(), b = freshKey();
    const out = path.join(temp("ascend-out-"), "b.ascbk");
    // Sealed under `a` but verified with `b`: the post-write check fails, as a corrupted write would.
    expect(() => writeSealed(out, seal(FILES, a.key, SEAL), b.key)).toThrow();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it("an existing artifact is never overwritten", () => {
    const { key } = freshKey();
    const out = path.join(temp("ascend-out-"), "c.ascbk");
    writeSealed(out, seal(FILES, key, SEAL), key);
    expect(() => writeSealed(out, seal(FILES, key, SEAL), key)).toThrow(/refusing to overwrite/);
  });
});

// ─── RT-3 · a new artifact carries its own recovery contract, and every claim about it is bound ──
//
// The v3 format seals `recovery-manifest.sql` — the exact bytes the backup ran against production —
// and a provenance record naming its checksum, the source commit and the ledger. These tests take the
// position of someone who HOLDS THE KEY and re-seals an artifact whose claims disagree: GCM cannot
// catch that (the tag is valid), so `verifyProvenance` must.

describe("RT-3 · provenance: sealed, bound, and refused when any claim disagrees", () => {
  const { key } = freshKey();
  const env = seal(FILES, key, SEAL);
  const opened = open(env, key);
  const good = opened.header.provenance!;
  /** Re-seal as a key holder could: `members` and `provenance` exactly as given, no consistency applied. */
  const forge = (members: BundleFile[], provenance: Provenance | undefined, format: ArtifactFormat = FORMAT_V3) =>
    open(sealEnvelope(members, key, { format, provenance }), key);
  const withMember = (name: string, bytes: Buffer) => opened.files.map((f) => (f.name === name ? { name, bytes } : f));
  const record = (p: Provenance) => Buffer.from(canonicalProvenance(p) + "\n");

  it("a new artifact is ascend-backup/3 and its provenance is derived from what it seals", () => {
    expect(FORMAT).toBe(FORMAT_V3);
    expect(opened.header.format).toBe(FORMAT_V3);
    const manifest = FILES.find((f) => f.name === MANIFEST_MEMBER)!.bytes;
    expect(good.manifestSha256).toBe(sha256(manifest));
    expect(good.sourceCommit).toBe(SEAL.sourceCommit);
    expect(good.ledger).toEqual([`001_substrate.sql:${"a".repeat(64)}`]);
    expect(good.ledgerHead).toBe("001_substrate.sql");
    const v = verifyProvenance(opened.header, opened.files);
    expect(v.manifestSql).toBe(manifest.toString("utf8"));
  });

  it("the sealed RT-2 exclusions are the repository's registry at the time of sealing (both empty)", () => {
    expect(SEALED_COVERAGE_EXCLUSIONS).toEqual(COVERAGE_EXCLUSIONS);
    expect(good.coverageExclusions).toEqual({});
  });

  it("seal refuses a supplied PROVENANCE.json, a missing manifest, a missing ledger, and a short commit id", () => {
    expect(() => seal([...FILES, { name: PROVENANCE_MEMBER, bytes: Buffer.from("{}") }], key, SEAL)).toThrow(/written by seal/);
    expect(() => seal(FILES.filter((f) => f.name !== MANIFEST_MEMBER), key, SEAL)).toThrow(/has no recovery-manifest.sql/);
    expect(() => seal(FILES.map((f) => f.name === "source-manifest.tsv"
      ? { name: f.name, bytes: Buffer.from("meta.format\tascend-recovery-manifest/1\n") } : f), key, SEAL)).toThrow(/no migration ledger/);
    expect(() => seal(FILES, key, { ...SEAL, sourceCommit: "9ed881e" })).toThrow(/40-hex/);
    expect(() => seal(FILES, key, { ...SEAL, applicationProfile: "" })).toThrow(/application verification profile id is required/);
    expect(() => seal(FILES, key, { ...SEAL, applicationProfile: "Latest!" })).toThrow(/application verification profile id is required/);
  });

  it("TAMPER · embedded manifest bytes changed after sealing (valid tag, stale checksum) are refused", () => {
    const f = forge(withMember(MANIFEST_MEMBER, Buffer.from(FILES[1].bytes.toString() + "-- edited\n")), good);
    expect(() => verifyProvenance(f.header, f.files)).toThrow(/does not match the manifestSha256/);
  });

  it("TAMPER · a flipped ciphertext bit, or an edited header, fails authentication before any claim is read", () => {
    const flipped = Buffer.from(env); flipped[flipped.length - 40] ^= 1;
    expect(() => open(flipped, key)).toThrow(/failed authentication/);
    const n = env.readUInt32BE(8);
    const text = env.subarray(12, 12 + n).toString("utf8").replace(good.manifestSha256, "f".repeat(64));
    const edited = Buffer.concat([env.subarray(0, 12), Buffer.from(text), env.subarray(12 + n)]);
    expect(() => open(edited, key)).toThrow(/failed authentication/);
  });

  it("TAMPER · provenance metadata: a different manifest hash, commit or ledger in the header is refused", () => {
    const other = { ...good, manifestSha256: "f".repeat(64) };
    const a = forge(withMember(PROVENANCE_MEMBER, record(other)), other);
    expect(() => verifyProvenance(a.header, a.files)).toThrow(/does not match the manifestSha256/);
    const moved = { ...good, sourceCommit: "1".repeat(40) };
    const b = forge(opened.files, moved);                                   // header says one commit, member another
    expect(() => verifyProvenance(b.header, b.files)).toThrow(/disagrees with the header/);
    const ledger = { ...good, ledger: [`001_substrate.sql:${"b".repeat(64)}`] };
    const c = forge(withMember(PROVENANCE_MEMBER, record(ledger)), ledger);
    expect(() => verifyProvenance(c.header, c.files)).toThrow(/not the ledger production reported/);
    const head = { ...good, ledgerHead: "002_other.sql" };
    const d = forge(withMember(PROVENANCE_MEMBER, record(head)), head);
    expect(() => verifyProvenance(d.header, d.files)).toThrow(/ledgerHead/);
    const swapped = { ...good, applicationProfile: "pre-009-v1" };                 // header names another profile
    const g = forge(opened.files, swapped);
    expect(() => verifyProvenance(g.header, g.files)).toThrow(/disagrees with the header/);
    const noProfile: Partial<Provenance> = { ...good }; delete noProfile.applicationProfile;   // no profile at all
    const h = forge(withMember(PROVENANCE_MEMBER, Buffer.from(JSON.stringify(noProfile) + "\n")), noProfile as Provenance);
    expect(() => verifyProvenance(h.header, h.files)).toThrow(/fields are|applicationProfile/);
    const extra = { ...good, trustMe: true } as unknown as Provenance;
    const e = forge(withMember(PROVENANCE_MEMBER, record(good)), extra);
    expect(() => verifyProvenance(e.header, e.files)).toThrow(/fields are/);
  });

  it("TAMPER · a non-canonical PROVENANCE.json with the same meaning is refused", () => {
    const pretty = Buffer.from(JSON.stringify(JSON.parse(canonicalProvenance(good)), null, 2) + "\n");
    const f = forge(withMember(PROVENANCE_MEMBER, pretty), good);
    expect(() => verifyProvenance(f.header, f.files)).toThrow(/canonical form/);
  });

  it("MISSING · a v3 artifact without PROVENANCE.json, without its manifest, or without a header provenance is refused", () => {
    const a = forge(opened.files.filter((f) => f.name !== PROVENANCE_MEMBER), good);
    expect(() => verifyProvenance(a.header, a.files)).toThrow(/has no PROVENANCE.json/);
    const b = forge(opened.files.filter((f) => f.name !== MANIFEST_MEMBER), good);
    expect(() => verifyProvenance(b.header, b.files)).toThrow(/has no recovery-manifest.sql/);
    expect(() => sealEnvelope(opened.files, key, { format: FORMAT_V3 })).toThrow(/requires provenance/);
    // Forged at the byte level: a v3 magic whose header omits provenance is refused on read.
    const v2 = sealEnvelope(opened.files, key, { format: FORMAT_V2 });
    const relabelled = Buffer.concat([Buffer.from("ASCBKUP3"), v2.subarray(8)]);
    expect(() => readHeader(relabelled)).toThrow(/unsupported artifact format|no provenance/);
    // Forged at the byte level with the format AGREEING with the magic: a v3 header with its provenance
    // removed, and a v2 header claiming one. Refused on read, before any key is used.
    const rewrite = (envelope: Buffer, edit: (h: Record<string, unknown>) => void) => {
      const n = envelope.readUInt32BE(8);
      const h = JSON.parse(envelope.subarray(12, 12 + n).toString("utf8")) as Record<string, unknown>;
      edit(h);
      const bytes = Buffer.from(JSON.stringify(h), "utf8");
      const len = Buffer.alloc(4); len.writeUInt32BE(bytes.length);
      return Buffer.concat([envelope.subarray(0, 8), len, bytes, envelope.subarray(12 + n)]);
    };
    expect(() => readHeader(rewrite(env, (h) => { delete h.provenance; }))).toThrow(/has no provenance in its header/);
    expect(() => readHeader(rewrite(v2, (h) => { h.provenance = good; }))).toThrow(/claims a provenance it cannot have/);
  });

  it("LEGACY · a v2 artifact opens, carries no provenance, and is refused by verifyProvenance (it needs a pinned contract)", () => {
    const v2 = open(sealEnvelope(FILES, key, { format: FORMAT_V2 }), key);
    expect(v2.header.format).toBe(FORMAT_V2);
    expect(v2.header.provenance).toBeUndefined();
    expect(() => verifyProvenance(v2.header, v2.files)).toThrow(/needs a pinned legacy contract/);
    expect(() => sealEnvelope(FILES, key, { format: FORMAT_V2, provenance: good })).toThrow(/carries no provenance/);
  });

  it("the CLI the backup script runs seals v3 from a work directory, and refuses without a source commit", () => {
    const work = temp("ascend-rt3-work-");
    for (const f of FILES) writeFileSync(path.join(work, f.name), f.bytes);
    const { keyFile } = freshKey();
    const outDir = temp("ascend-rt3-out-");
    const run = (...args: string[]) => spawnSync(process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "core/recovery/artifact.ts", ...args], { encoding: "utf8" });
    const refused = run("seal", "--work", work, "--out", path.join(outDir, "a.ascbk"), "--key-file", keyFile);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/--source-commit/);
    const commit = "c".repeat(40);
    const noProfile = run("seal", "--work", work, "--out", path.join(outDir, "c.ascbk"), "--key-file", keyFile, "--source-commit", commit);
    expect(noProfile.status).not.toBe(0);
    expect(noProfile.stderr).toMatch(/--application-profile/);
    const ok = run("seal", "--work", work, "--out", path.join(outDir, "b.ascbk"), "--key-file", keyFile, "--source-commit", commit,
      "--application-profile", "post-009-v1");
    expect(ok.status, ok.stderr).toBe(0);
    const h = readHeader(readFileSync(path.join(outDir, "b.ascbk")));
    expect(h.format).toBe(FORMAT_V3);
    expect(h.provenance!.sourceCommit).toBe(commit);
    expect(h.provenance!.applicationProfile).toBe("post-009-v1");
    const verified = run("verify", path.join(outDir, "b.ascbk"), "--keyring", path.dirname(keyFile));
    expect(verified.status, verified.stderr).toBe(0);
    expect(verified.stdout).toMatch(/provenance: every binding agrees/);
  });
});
