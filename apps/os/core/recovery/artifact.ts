// core/recovery/artifact — THE DURABLE RECOVERY ARTIFACT: bundle, encryption, keys (Dependency R1a).
//
// ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
//
// A production backup of Ascend contains PII (3,108 prospect businesses, the owner's email, event
// payloads, operator notes) and credential-derived material (`users.password_hash`, scrypt;
// `invitations.token_hash`). The previous script called that bundle "CLEAN" and told the operator to
// copy it off the machine unencrypted. Owner decision (R1a): durable backups are ENCRYPTED AT REST.
//
// ─── FORMATS ───────────────────────────────────────────────────────────────────────────────────
//
//   envelope  = MAGIC (8) | u32be headerLength | header (UTF-8 JSON) | ciphertext | tag (16)
//   plaintext = bundle = u32be indexLength | index (JSON [{name,size,sha256}]) | file bytes, in order
//
//   `ascend-backup/2`  MAGIC "ASCBKUP2"   LEGACY. Read, never written.
//       header = { format, cipher: "aes-256-gcm", keyId, nonce (b64), createdAt, bundleSha256, files }
//       It does not say which recovery contract (which `manifest.sql`) it was taken with, so it can be
//       verified only against a contract PINNED for it by name (core/recovery/legacy-contracts.ts).
//
//   `ascend-backup/3`  MAGIC "ASCBKUP3"   CURRENT. Every new artifact. SELF-DESCRIBING (RT-3).
//       header = the v2 fields + `provenance` (below)
//       members additionally include `recovery-manifest.sql` — the EXACT bytes the backup ran against
//       production — and `PROVENANCE.json`, the same `provenance` object in canonical form.
//
//   The two are different formats because their recovery contracts differ: a v3 artifact carries the
//   specification it must be verified against; a v2 artifact must be given one. Neither is ever
//   verified against whatever `manifest.sql` the repository holds today.
//
// ─── PROVENANCE (RT-3) ─────────────────────────────────────────────────────────────────────────
//
//   { provenanceFormat, artifactFormat, manifestFormat, manifestMember, manifestSha256,
//     sourceCommit, ledger: ["NNN_name.sql:<sha256>", …], ledgerHead, coverageExclusions,
//     applicationProfile }
//
// `applicationProfile` (RT-3B) SELECTS the reviewed application verification profile, by id, from
// core/recovery/profile-registry.ts. It is an id, never code; an unknown id, or one written for a
// different ledger, is refused at resolution (core/recovery/contract.ts).
//
// Bound three ways, all authenticated by the one GCM tag: it is in the HEADER (additional
// authenticated data), it is a MEMBER whose checksum is in the header's index, and its
// `manifestSha256` must equal the checksum of the `recovery-manifest.sql` member. `verifyProvenance`
// checks every one of those agreements, and that the ledger it claims is the ledger production
// reported in `source-manifest.tsv`, before a single byte of the embedded manifest is executed. Nothing
// is derived from what the caller would like to be true: `seal` computes the provenance from the
// members it is sealing, and takes only the source commit from outside.
//
// AES-256-GCM is authenticated: a flipped bit anywhere in the ciphertext, the tag OR THE HEADER fails
// decryption, because the header is bound in as additional authenticated data. The header is
// plaintext on purpose and carries nothing sensitive — which key to use, when, and checksums — so an
// operator can tell which key a file needs without holding it.
//
// ─── THE KEY ───────────────────────────────────────────────────────────────────────────────────
//
//   · 32 random bytes, stored base64 in a FILE with mode 0600. Never in the repository, never in the
//     backup directory, never under iCloud-synced paths — `assertKeyLocation` refuses all three.
//   · Identified by `keyId` = the first 16 hex of sha256("ascend-backup-key-id\0" + key). The id
//     names the key; it cannot be used to derive it.
//   · THE KEY IS NEVER WRITTEN INTO AN ARTIFACT. `seal` refuses input files whose bytes contain the
//     key in raw, base64 or hex form, and the tests prove the finished envelope does not contain it.
//   · ROTATION: a new key gets a new id. Old keys stay in the keyring directory, named by id, so every
//     old artifact stays decryptable by the key it names. Losing a key loses every artifact encrypted
//     under it — so the key needs its OWN off-machine escrow, which is part of the still-open
//     off-machine destination decision (recorded in docs/RECOVERY-RUNBOOK.md).
//
// ─── FAILURE BEHAVIOUR ─────────────────────────────────────────────────────────────────────────
//
//   · Encryption writes `<out>.partial` and renames only after the bytes are on disk and re-verified.
//     Any failure removes the partial; there is never a half-written artifact under the final name.
//   · Decryption with the wrong key, a missing key, a tampered header, ciphertext or tag, or a bundle
//     whose per-file checksums disagree THROWS — and returns no plaintext at all.
//   · Verification never needs the key printed: it is read from the file into memory and nowhere else.
//
// NODE BUILTINS ONLY. `scripts/backup-production.sh` runs this file directly with `node`, so it must
// not import through the `@/` alias or any package.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Legacy: read with a pinned contract, never written. */
export const FORMAT_V2 = "ascend-backup/2";
/** Current: self-describing, provenance-bound. Every new artifact. */
export const FORMAT_V3 = "ascend-backup/3";
/** The format `seal` writes. */
export const FORMAT = FORMAT_V3;
export type ArtifactFormat = typeof FORMAT_V2 | typeof FORMAT_V3;
const MAGIC: Readonly<Record<ArtifactFormat, Buffer>> = {
  [FORMAT_V2]: Buffer.from("ASCBKUP2", "ascii"),
  [FORMAT_V3]: Buffer.from("ASCBKUP3", "ascii"),
};
const MAGIC_BYTES = 8;
const CIPHER = "aes-256-gcm";

export const PROVENANCE_FORMAT = "ascend-recovery-provenance/1";
export const MANIFEST_FORMAT = "ascend-recovery-manifest/1";
export const MANIFEST_MEMBER = "recovery-manifest.sql";
export const PROVENANCE_MEMBER = "PROVENANCE.json";
export const SOURCE_MANIFEST_MEMBER = "source-manifest.tsv";
/**
 * The RT-2 exclusions a new artifact is sealed with. EMPTY, like `COVERAGE_EXCLUSIONS` in
 * core/recovery/restore.ts, which a test holds this equal to. Sealed so that a later change to the
 * repository's registry cannot change how an existing artifact verifies.
 */
export const SEALED_COVERAGE_EXCLUSIONS: Readonly<Record<string, string>> = Object.freeze({});
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export class ArtifactError extends Error {}

export type BundleFile = { name: string; bytes: Buffer };
export type IndexEntry = { name: string; size: number; sha256: string };
export type Provenance = {
  provenanceFormat: typeof PROVENANCE_FORMAT;
  artifactFormat: typeof FORMAT_V3;
  manifestFormat: typeof MANIFEST_FORMAT;
  manifestMember: typeof MANIFEST_MEMBER;
  /** sha256 of the `recovery-manifest.sql` member: the exact bytes run against production. */
  manifestSha256: string;
  /** The repository commit the backup ran from (a clean tree for the manifest and the schema). */
  sourceCommit: string;
  /** `name:checksum` for every migration production's ledger reported (F17), in order. */
  ledger: string[];
  ledgerHead: string;
  coverageExclusions: Record<string, string>;
  /** RT-3B: the application verification profile this artifact is proven with. An id only. */
  applicationProfile: string;
};

export type Header = {
  format: ArtifactFormat;
  cipher: typeof CIPHER;
  keyId: string;
  nonce: string;
  createdAt: string;
  bundleSha256: string;
  files: IndexEntry[];
  /** Present exactly when `format` is `ascend-backup/3`. */
  provenance?: Provenance;
};

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

// ─── Keys ──────────────────────────────────────────────────────────────────────────────────────

export const DEFAULT_KEYRING = path.join(homedir(), ".config", "ascend", "backup-keys");

export function keyIdOf(key: Buffer): string {
  return sha256(Buffer.concat([Buffer.from("ascend-backup-key-id\0"), key])).slice(0, 16);
}

/**
 * Where a key may NOT live. Each refusal is a way the key would end up beside, inside, or synced
 * alongside the thing it protects.
 */
export function assertKeyLocation(keyFile: string, forbiddenRoots: readonly string[]): void {
  const abs = path.resolve(keyFile);
  for (const root of forbiddenRoots) {
    const r = path.resolve(root);
    if (abs === r || abs.startsWith(r + path.sep)) {
      throw new ArtifactError(`refusing key at ${abs}: it is inside ${r}, which the key must never share`);
    }
  }
  const home = homedir();
  const synced = [
    path.join(home, "Library", "Mobile Documents"), // iCloud Drive
    path.join(home, "Desktop"), path.join(home, "Documents"), // iCloud Desktop & Documents sync
  ];
  for (const s of synced) {
    if (abs === s || abs.startsWith(s + path.sep)) {
      throw new ArtifactError(`refusing key at ${abs}: ${s} is cloud-synced, and a synced key is a copied key`);
    }
  }
}

/** Read a key file, refusing anything a key file must not be. Returns the raw 32 bytes. */
export function readKey(keyFile: string, forbiddenRoots: readonly string[] = []): Buffer {
  assertKeyLocation(keyFile, forbiddenRoots);
  if (!existsSync(keyFile)) throw new ArtifactError(`no key file at ${keyFile}`);
  const mode = statSync(keyFile).mode & 0o777;
  if (mode & 0o077) {
    throw new ArtifactError(`refusing key file ${keyFile}: mode ${mode.toString(8)} is readable beyond its owner (want 600)`);
  }
  const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64");
  if (key.length !== KEY_BYTES) throw new ArtifactError(`key file ${keyFile} does not hold a ${KEY_BYTES}-byte key`);
  return key;
}

/** Create a new key in the keyring, named by its id. Returns the id — never the key. */
export function generateKey(keyring = DEFAULT_KEYRING, forbiddenRoots: readonly string[] = []): { keyId: string; keyFile: string } {
  mkdirSync(keyring, { recursive: true, mode: 0o700 });
  chmodSync(keyring, 0o700);
  const key = randomBytes(KEY_BYTES);
  const keyId = keyIdOf(key);
  const keyFile = path.join(keyring, `${keyId}.key`);
  assertKeyLocation(keyFile, forbiddenRoots);
  const fd = openSync(keyFile, "wx", 0o600); // wx: never overwrite an existing key
  try { writeSync(fd, key.toString("base64") + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  return { keyId, keyFile };
}

/** Find the key an artifact names. The keyring is searched by id; nothing is guessed. */
export function keyForId(keyId: string, keyring = DEFAULT_KEYRING, forbiddenRoots: readonly string[] = []): Buffer {
  if (!/^[0-9a-f]{16}$/.test(keyId)) throw new ArtifactError(`malformed key id in artifact header`);
  const file = path.join(keyring, `${keyId}.key`);
  if (!existsSync(file)) {
    throw new ArtifactError(`this artifact needs key ${keyId}, which is not in ${keyring}. ` +
      `Recover that key from its escrow; no other key can open it.`);
  }
  const key = readKey(file, forbiddenRoots);
  if (keyIdOf(key) !== keyId) throw new ArtifactError(`key file ${file} does not hold key ${keyId}`);
  return key;
}

// ─── Bundle ────────────────────────────────────────────────────────────────────────────────────

function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }

export function buildBundle(files: readonly BundleFile[]): { bundle: Buffer; index: IndexEntry[] } {
  const names = new Set<string>();
  for (const f of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(f.name)) throw new ArtifactError(`unsafe bundle member name ${JSON.stringify(f.name)}`);
    if (names.has(f.name)) throw new ArtifactError(`duplicate bundle member ${f.name}`);
    names.add(f.name);
  }
  const index = files.map((f) => ({ name: f.name, size: f.bytes.length, sha256: sha256(f.bytes) }));
  const idx = Buffer.from(JSON.stringify(index), "utf8");
  return { bundle: Buffer.concat([u32(idx.length), idx, ...files.map((f) => f.bytes)]), index };
}

export function parseBundle(bundle: Buffer): BundleFile[] {
  const n = bundle.readUInt32BE(0);
  const index = JSON.parse(bundle.subarray(4, 4 + n).toString("utf8")) as IndexEntry[];
  let at = 4 + n;
  const out: BundleFile[] = [];
  for (const e of index) {
    const bytes = bundle.subarray(at, at + e.size);
    at += e.size;
    if (bytes.length !== e.size || sha256(bytes) !== e.sha256) {
      throw new ArtifactError(`bundle member ${e.name} fails its checksum`);
    }
    out.push({ name: e.name, bytes: Buffer.from(bytes) });
  }
  if (at !== bundle.length) throw new ArtifactError("bundle has trailing bytes beyond its index");
  return out;
}

// ─── Envelope ──────────────────────────────────────────────────────────────────────────────────

/** Refuse to seal a key into the artifact it protects, in any encoding a careless step might use. */
function assertKeyAbsent(files: readonly BundleFile[], key: Buffer): void {
  const forms = [key, Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex"))];
  for (const f of files) {
    for (const form of forms) {
      if (f.bytes.includes(form)) throw new ArtifactError(`refusing to seal: ${f.name} contains the encryption key`);
    }
  }
}

/**
 * THE ENVELOPE PRIMITIVE: encrypt `files` under `key` in `format`, exactly as given.
 *
 * It checks only structure — a v2 header carries no provenance, a v3 header must — and NOT whether a
 * v3 provenance is true. That is deliberate: it is how the tests construct what a key holder could
 * forge (an embedded manifest that disagrees with its own claims) and prove `verifyProvenance` refuses
 * it. New artifacts are sealed with `seal`, which derives the provenance from the members.
 */
export function sealEnvelope(
  files: readonly BundleFile[], key: Buffer,
  opts: { format: ArtifactFormat; provenance?: Provenance; createdAt?: string },
): Buffer {
  if (key.length !== KEY_BYTES) throw new ArtifactError("encryption key must be 32 bytes");
  if ((opts.format === FORMAT_V3) !== (opts.provenance !== undefined)) {
    throw new ArtifactError(`${opts.format} ${opts.format === FORMAT_V3 ? "requires" : "carries no"} provenance`);
  }
  assertKeyAbsent(files, key);
  const { bundle, index } = buildBundle(files);
  const nonce = randomBytes(NONCE_BYTES);
  const header: Header = {
    format: opts.format, cipher: CIPHER, keyId: keyIdOf(key), nonce: nonce.toString("base64"),
    createdAt: opts.createdAt ?? new Date().toISOString(), bundleSha256: sha256(bundle), files: index,
    ...(opts.provenance ? { provenance: opts.provenance } : {}),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const cipher = createCipheriv(CIPHER, key, nonce);
  cipher.setAAD(headerBytes);
  const body = Buffer.concat([cipher.update(bundle), cipher.final()]);
  return Buffer.concat([MAGIC[opts.format], u32(headerBytes.length), headerBytes, body, cipher.getAuthTag()]);
}

/**
 * Seal a NEW artifact: always `ascend-backup/3`, with its provenance DERIVED from the members being
 * sealed — the manifest's checksum from `recovery-manifest.sql`, the ledger from the F17 line of
 * `source-manifest.tsv` — plus the one fact that comes from outside, the source commit.
 */
export function seal(
  files: readonly BundleFile[], key: Buffer, opts: { sourceCommit: string; applicationProfile: string; createdAt?: string },
): Buffer {
  if (files.some((f) => f.name === PROVENANCE_MEMBER)) {
    throw new ArtifactError(`${PROVENANCE_MEMBER} is written by seal, never supplied`);
  }
  const provenance = deriveProvenance(files, opts.sourceCommit, opts.applicationProfile);
  const record = { name: PROVENANCE_MEMBER, bytes: Buffer.from(canonicalProvenance(provenance) + "\n", "utf8") };
  return sealEnvelope([...files, record], key, { format: FORMAT_V3, provenance, createdAt: opts.createdAt });
}

/** The plaintext header. Safe to read without a key; it is authenticated when the body is opened. */
export function readHeader(envelope: Buffer): Header {
  const magic = envelope.length >= MAGIC_BYTES + 4 ? envelope.subarray(0, MAGIC_BYTES) : Buffer.alloc(0);
  const format = (Object.keys(MAGIC) as ArtifactFormat[]).find((f) => magic.length === MAGIC_BYTES && timingSafeEqual(magic, MAGIC[f]));
  if (!format) throw new ArtifactError(`not an ascend-backup artifact (${FORMAT_V2} or ${FORMAT_V3})`);
  const n = envelope.readUInt32BE(MAGIC_BYTES);
  const header = JSON.parse(envelope.subarray(MAGIC_BYTES + 4, MAGIC_BYTES + 4 + n).toString("utf8")) as Header;
  if (header.format !== format || header.cipher !== CIPHER) {
    throw new ArtifactError(`unsupported artifact format ${String(header.format)} (magic says ${format})`);
  }
  if ((format === FORMAT_V3) !== (header.provenance !== undefined)) {
    throw new ArtifactError(format === FORMAT_V3
      ? `${FORMAT_V3} artifact has no provenance in its header` : `${FORMAT_V2} artifact claims a provenance it cannot have`);
  }
  return header;
}

/** Decrypt and verify. Returns the members, or throws having released nothing. */
export function open(envelope: Buffer, key: Buffer): { header: Header; files: BundleFile[] } {
  const header = readHeader(envelope);
  if (keyIdOf(key) !== header.keyId) {
    throw new ArtifactError(`wrong key: this artifact is sealed under key ${header.keyId}`);
  }
  const n = envelope.readUInt32BE(MAGIC_BYTES);
  const headerBytes = envelope.subarray(MAGIC_BYTES + 4, MAGIC_BYTES + 4 + n);
  const body = envelope.subarray(MAGIC_BYTES + 4 + n, envelope.length - TAG_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  let bundle: Buffer;
  try {
    const d = createDecipheriv(CIPHER, key, Buffer.from(header.nonce, "base64"));
    d.setAAD(headerBytes);
    d.setAuthTag(tag);
    bundle = Buffer.concat([d.update(body), d.final()]);
  } catch {
    throw new ArtifactError("artifact failed authentication: it was altered, truncated, or sealed under a different key");
  }
  if (sha256(bundle) !== header.bundleSha256) throw new ArtifactError("bundle checksum disagrees with the header");
  const files = parseBundle(bundle);
  const names = files.map((f) => f.name).join(",");
  if (names !== header.files.map((f) => f.name).join(",")) throw new ArtifactError("bundle index disagrees with the header");
  return { header, files };
}

// ─── Provenance (RT-3) ─────────────────────────────────────────────────────────────────────────

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LEDGER_ENTRY = /^([0-9]{3}_[a-z0-9_]+\.sql):([0-9a-f]{64})$/;
/** Same pattern as `PROFILE_ID` in profile-registry.ts (a test holds them equal); duplicated to keep this file builtins-only. */
export const APPLICATION_PROFILE_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

/** One value of a `psql -At -F<TAB>` manifest, by key — or undefined. */
function tsvValue(tsv: string, key: string): string | undefined {
  for (const line of tsv.split("\n")) {
    const i = line.indexOf("\t");
    if (i > 0 && line.slice(0, i) === key) return line.slice(i + 1);
  }
  return undefined;
}

/**
 * The ledger production reported, as `name:checksum` (F17 without its witnessed/backfilled flag, which
 * the manifest comparison already holds equal). Refuses a manifest with no ledger at all.
 */
export function ledgerOfSourceManifest(tsv: string): string[] {
  if (tsvValue(tsv, "meta.format") !== MANIFEST_FORMAT) throw new ArtifactError(`${SOURCE_MANIFEST_MEMBER} is not an ${MANIFEST_FORMAT} manifest`);
  const raw = tsvValue(tsv, "F17.ledger");
  if (!raw) throw new ArtifactError(`${SOURCE_MANIFEST_MEMBER} reports no migration ledger (F17)`);
  return raw.split(",").map((e) => {
    const entry = e.split(":").slice(0, 2).join(":");
    if (!LEDGER_ENTRY.test(entry)) throw new ArtifactError(`${SOURCE_MANIFEST_MEMBER} has a malformed ledger entry`);
    return entry;
  });
}

/** The provenance object with its keys in one fixed order, serialized. Equality is on this text. */
export function canonicalProvenance(p: Provenance): string {
  return JSON.stringify({
    provenanceFormat: p.provenanceFormat, artifactFormat: p.artifactFormat, manifestFormat: p.manifestFormat,
    manifestMember: p.manifestMember, manifestSha256: p.manifestSha256, sourceCommit: p.sourceCommit,
    ledger: p.ledger, ledgerHead: p.ledgerHead,
    coverageExclusions: Object.fromEntries(Object.entries(p.coverageExclusions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    applicationProfile: p.applicationProfile,
  });
}

/** Refuse anything that is not exactly a provenance record this code knows how to honour. */
export function assertProvenanceShape(p: unknown): asserts p is Provenance {
  const fail = (what: string): never => { throw new ArtifactError(`provenance refused: ${what}`); };
  if (typeof p !== "object" || p === null || Array.isArray(p)) fail("not an object");
  const o = p as Record<string, unknown>;
  const expected = ["provenanceFormat", "artifactFormat", "manifestFormat", "manifestMember", "manifestSha256",
    "sourceCommit", "ledger", "ledgerHead", "coverageExclusions", "applicationProfile"];
  const keys = Object.keys(o).sort();
  if (keys.join(",") !== [...expected].sort().join(",")) fail(`fields are [${keys.join(",")}]`);
  if (o.provenanceFormat !== PROVENANCE_FORMAT) fail(`unknown provenance format ${String(o.provenanceFormat)}`);
  if (o.artifactFormat !== FORMAT_V3) fail(`artifact format ${String(o.artifactFormat)}`);
  if (o.manifestFormat !== MANIFEST_FORMAT) fail(`unknown manifest format ${String(o.manifestFormat)}`);
  if (o.manifestMember !== MANIFEST_MEMBER) fail(`manifest member ${String(o.manifestMember)}`);
  if (typeof o.manifestSha256 !== "string" || !SHA256.test(o.manifestSha256)) fail("manifestSha256 is not a sha256");
  if (typeof o.sourceCommit !== "string" || !COMMIT.test(o.sourceCommit)) fail("sourceCommit is not a full commit id");
  if (!Array.isArray(o.ledger) || o.ledger.length === 0 || !o.ledger.every((e) => typeof e === "string" && LEDGER_ENTRY.test(e))) {
    fail("ledger is not a non-empty list of name:checksum");
  }
  const ledger = o.ledger as string[];
  if (o.ledgerHead !== ledger[ledger.length - 1].split(":")[0]) fail("ledgerHead is not the last ledger entry");
  if (typeof o.applicationProfile !== "string" || !APPLICATION_PROFILE_ID.test(o.applicationProfile)) {
    fail("applicationProfile is missing or not a profile id");
  }
  const ex = o.coverageExclusions;
  if (typeof ex !== "object" || ex === null || Array.isArray(ex)
    || !Object.values(ex).every((v) => typeof v === "string" && v.trim() !== "")) {
    fail("coverageExclusions must map table names to stated reasons");
  }
}

function memberOf(files: readonly BundleFile[], name: string): BundleFile {
  const f = files.filter((x) => x.name === name);
  if (f.length !== 1) throw new ArtifactError(`the artifact ${f.length === 0 ? "has no" : "has more than one"} ${name}`);
  return f[0];
}

/** What `seal` records: computed from the members themselves, plus the commit. */
export function deriveProvenance(files: readonly BundleFile[], sourceCommit: string, applicationProfile: string): Provenance {
  if (!COMMIT.test(sourceCommit)) throw new ArtifactError("the source commit must be a full 40-hex commit id");
  if (!APPLICATION_PROFILE_ID.test(applicationProfile ?? "")) throw new ArtifactError("an application verification profile id is required");
  const manifest = memberOf(files, MANIFEST_MEMBER);
  if (!manifest.bytes.toString("utf8").includes(`'meta.format', '${MANIFEST_FORMAT}'`)) {
    throw new ArtifactError(`${MANIFEST_MEMBER} does not declare ${MANIFEST_FORMAT}`);
  }
  const ledger = ledgerOfSourceManifest(memberOf(files, SOURCE_MANIFEST_MEMBER).bytes.toString("utf8"));
  const p: Provenance = {
    provenanceFormat: PROVENANCE_FORMAT, artifactFormat: FORMAT_V3, manifestFormat: MANIFEST_FORMAT,
    manifestMember: MANIFEST_MEMBER, manifestSha256: sha256(manifest.bytes), sourceCommit,
    ledger, ledgerHead: ledger[ledger.length - 1].split(":")[0],
    coverageExclusions: { ...SEALED_COVERAGE_EXCLUSIONS },
    applicationProfile,
  };
  assertProvenanceShape(p);
  return p;
}

/**
 * Every agreement a v3 artifact's provenance must satisfy, checked on an OPENED artifact (so the GCM
 * tag has already authenticated header and body). Returns the provenance and the embedded manifest
 * text — the only manifest a v3 artifact may be verified with. Fails closed on any disagreement.
 */
export function verifyProvenance(header: Header, files: readonly BundleFile[]): { provenance: Provenance; manifestSql: string } {
  if (header.format !== FORMAT_V3) throw new ArtifactError(`${header.format} carries no provenance; it needs a pinned legacy contract`);
  if (header.provenance === undefined) throw new ArtifactError(`${FORMAT_V3} artifact has no provenance in its header`);
  assertProvenanceShape(header.provenance);
  const record = memberOf(files, PROVENANCE_MEMBER);
  let claimed: unknown;
  try { claimed = JSON.parse(record.bytes.toString("utf8")); } catch { throw new ArtifactError(`${PROVENANCE_MEMBER} is not JSON`); }
  assertProvenanceShape(claimed);
  const canonical = canonicalProvenance(header.provenance);
  if (canonicalProvenance(claimed) !== canonical) throw new ArtifactError(`${PROVENANCE_MEMBER} disagrees with the header's provenance`);
  if (!record.bytes.equals(Buffer.from(canonical + "\n", "utf8"))) throw new ArtifactError(`${PROVENANCE_MEMBER} is not in canonical form`);
  const p = header.provenance;

  const manifest = memberOf(files, MANIFEST_MEMBER);
  if (sha256(manifest.bytes) !== p.manifestSha256) throw new ArtifactError(`${MANIFEST_MEMBER} does not match the manifestSha256 its provenance records`);
  const indexed = header.files.find((f) => f.name === MANIFEST_MEMBER);
  if (!indexed || indexed.sha256 !== p.manifestSha256) throw new ArtifactError(`the header index disagrees with the provenance about ${MANIFEST_MEMBER}`);
  const manifestSql = manifest.bytes.toString("utf8");
  if (!Buffer.from(manifestSql, "utf8").equals(manifest.bytes)) throw new ArtifactError(`${MANIFEST_MEMBER} is not valid UTF-8`);
  if (!manifestSql.includes(`'meta.format', '${p.manifestFormat}'`)) throw new ArtifactError(`${MANIFEST_MEMBER} does not declare ${p.manifestFormat}`);

  const source = memberOf(files, SOURCE_MANIFEST_MEMBER).bytes.toString("utf8");
  if (ledgerOfSourceManifest(source).join(",") !== p.ledger.join(",")) {
    throw new ArtifactError("the provenance ledger is not the ledger production reported (F17) in source-manifest.tsv");
  }
  return { provenance: p, manifestSql };
}

/** Write atomically: `<out>.partial`, fsync, re-open and verify, then rename. Never a half artifact. */
export function writeSealed(outFile: string, envelope: Buffer, key: Buffer): void {
  const partial = `${outFile}.partial`;
  if (existsSync(outFile)) throw new ArtifactError(`refusing to overwrite ${outFile}`);
  try {
    const fd = openSync(partial, "wx", 0o600);
    try { writeSync(fd, envelope); fsyncSync(fd); } finally { closeSync(fd); }
    open(readFileSync(partial), key); // what is on disk must open, not merely what was in memory
    renameSync(partial, outFile);
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
}

// ─── CLI (used by scripts/backup-production.sh and the runbook) ────────────────────────────────
//
//   node core/recovery/artifact.ts keygen  [--keyring DIR]
//   node core/recovery/artifact.ts check-key --key-file FILE [--forbid DIR]...
//   node core/recovery/artifact.ts seal    --work DIR --out FILE --key-file FILE --source-commit SHA --application-profile ID [--forbid DIR]...
//   node core/recovery/artifact.ts inspect FILE
//   node core/recovery/artifact.ts verify  FILE [--keyring DIR]
//
// Every command prints ids, names, sizes and checksums. None prints a key or a member's content.

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function flags(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
}

function main(argv: string[]): void {
  const [cmd, ...args] = argv;
  const forbid = flags(args, "--forbid");
  const keyring = flag(args, "--keyring") ?? DEFAULT_KEYRING;
  if (cmd === "keygen") {
    const { keyId, keyFile } = generateKey(keyring, forbid);
    console.log(`key id   : ${keyId}\nkey file : ${keyFile} (mode 600)\nESCROW THIS KEY OFF-MACHINE: without it, every artifact sealed under ${keyId} is unrecoverable.`);
  } else if (cmd === "check-key") {
    const keyFile = flag(args, "--key-file");
    if (!keyFile) throw new ArtifactError("check-key needs --key-file");
    console.log(keyIdOf(readKey(keyFile, forbid))); // the id only
  } else if (cmd === "seal") {
    const work = flag(args, "--work"), out = flag(args, "--out"), keyFile = flag(args, "--key-file");
    const sourceCommit = flag(args, "--source-commit"), applicationProfile = flag(args, "--application-profile");
    if (!work || !out || !keyFile || !sourceCommit || !applicationProfile) {
      throw new ArtifactError("seal needs --work, --out, --key-file, --source-commit and --application-profile");
    }
    const key = readKey(keyFile, [...forbid, work, path.dirname(out)]);
    const files = readdirSync(work).sort().map((name) => ({ name, bytes: readFileSync(path.join(work, name)) }));
    if (files.length === 0) throw new ArtifactError(`nothing to seal in ${work}`);
    writeSealed(out, seal(files, key, { sourceCommit, applicationProfile }), key);
    const h = readHeader(readFileSync(out));
    console.log(`sealed   : ${out}\nformat   : ${h.format}\nkey id   : ${h.keyId}\nmembers  : ${h.files.map((f) => `${f.name} (${f.size} B)`).join(", ")}\nsha256   : ${sha256(readFileSync(out))}`);
    console.log(`manifest : sha256 ${h.provenance!.manifestSha256}\ncommit   : ${h.provenance!.sourceCommit}\nledger   : ${h.provenance!.ledger.length} migrations, head ${h.provenance!.ledgerHead}\nprofile  : ${h.provenance!.applicationProfile}`);
  } else if (cmd === "inspect") {
    const h = readHeader(readFileSync(args[0]));
    console.log(JSON.stringify({ ...h, nonce: "(omitted)" }, null, 2));
  } else if (cmd === "verify") {
    const env = readFileSync(args[0]);
    const h = readHeader(env);
    const { files } = open(env, keyForId(h.keyId, keyring, forbid));
    console.log(`verified : ${args[0]}\nformat   : ${h.format}\nkey id   : ${h.keyId}\nmembers  : ${files.length}, every checksum agrees`);
    if (h.format === FORMAT_V3) {
      const { provenance: p } = verifyProvenance(h, files);
      console.log(`provenance: every binding agrees · manifest sha256 ${p.manifestSha256} · commit ${p.sourceCommit} · ledger head ${p.ledgerHead} · application profile ${p.applicationProfile}`);
    } else {
      console.log(`provenance: none (${FORMAT_V2}) — recovery verification needs a pinned legacy contract`);
    }
  } else {
    throw new ArtifactError("usage: artifact.ts keygen|check-key|seal|inspect|verify …");
  }
}

// Run as a CLI only when invoked directly — importing this module (the tests do) must do nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.error(`artifact: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
