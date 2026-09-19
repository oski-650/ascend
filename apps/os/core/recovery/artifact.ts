// core/recovery/artifact — THE DURABLE RECOVERY ARTIFACT: bundle, encryption, keys (Dependency R1a).
//
// ─── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
//
// A production backup of Ascend contains PII (3,108 prospect businesses, the owner's email, event
// payloads, operator notes) and credential-derived material (`users.password_hash`, scrypt;
// `invitations.token_hash`). The previous script called that bundle "CLEAN" and told the operator to
// copy it off the machine unencrypted. Owner decision (R1a): durable backups are ENCRYPTED AT REST.
//
// ─── FORMAT `ascend-backup/2` ──────────────────────────────────────────────────────────────────
//
//   envelope  = MAGIC "ASCBKUP2" (8) | u32be headerLength | header (UTF-8 JSON) | ciphertext | tag (16)
//   header    = { format, cipher: "aes-256-gcm", keyId, nonce (b64), createdAt, bundleSha256, files }
//   plaintext = bundle = u32be indexLength | index (JSON [{name,size,sha256}]) | file bytes, in order
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

export const FORMAT = "ascend-backup/2";
const MAGIC = Buffer.from("ASCBKUP2", "ascii");
const CIPHER = "aes-256-gcm";
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export class ArtifactError extends Error {}

export type BundleFile = { name: string; bytes: Buffer };
export type IndexEntry = { name: string; size: number; sha256: string };
export type Header = {
  format: typeof FORMAT;
  cipher: typeof CIPHER;
  keyId: string;
  nonce: string;
  createdAt: string;
  bundleSha256: string;
  files: IndexEntry[];
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

export function seal(files: readonly BundleFile[], key: Buffer, createdAt = new Date().toISOString()): Buffer {
  if (key.length !== KEY_BYTES) throw new ArtifactError("encryption key must be 32 bytes");
  assertKeyAbsent(files, key);
  const { bundle, index } = buildBundle(files);
  const nonce = randomBytes(NONCE_BYTES);
  const header: Header = {
    format: FORMAT, cipher: CIPHER, keyId: keyIdOf(key), nonce: nonce.toString("base64"),
    createdAt, bundleSha256: sha256(bundle), files: index,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const cipher = createCipheriv(CIPHER, key, nonce);
  cipher.setAAD(headerBytes);
  const body = Buffer.concat([cipher.update(bundle), cipher.final()]);
  return Buffer.concat([MAGIC, u32(headerBytes.length), headerBytes, body, cipher.getAuthTag()]);
}

/** The plaintext header. Safe to read without a key; it is authenticated when the body is opened. */
export function readHeader(envelope: Buffer): Header {
  if (envelope.length < MAGIC.length + 4 || !timingSafeEqual(envelope.subarray(0, MAGIC.length), MAGIC)) {
    throw new ArtifactError(`not an ${FORMAT} artifact`);
  }
  const n = envelope.readUInt32BE(MAGIC.length);
  const header = JSON.parse(envelope.subarray(MAGIC.length + 4, MAGIC.length + 4 + n).toString("utf8")) as Header;
  if (header.format !== FORMAT || header.cipher !== CIPHER) throw new ArtifactError(`unsupported artifact format ${header.format}`);
  return header;
}

/** Decrypt and verify. Returns the members, or throws having released nothing. */
export function open(envelope: Buffer, key: Buffer): { header: Header; files: BundleFile[] } {
  const header = readHeader(envelope);
  if (keyIdOf(key) !== header.keyId) {
    throw new ArtifactError(`wrong key: this artifact is sealed under key ${header.keyId}`);
  }
  const n = envelope.readUInt32BE(MAGIC.length);
  const headerBytes = envelope.subarray(MAGIC.length + 4, MAGIC.length + 4 + n);
  const body = envelope.subarray(MAGIC.length + 4 + n, envelope.length - TAG_BYTES);
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
//   node core/recovery/artifact.ts seal    --work DIR --out FILE --key-file FILE [--forbid DIR]...
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
    if (!work || !out || !keyFile) throw new ArtifactError("seal needs --work, --out and --key-file");
    const key = readKey(keyFile, [...forbid, work, path.dirname(out)]);
    const files = readdirSync(work).sort().map((name) => ({ name, bytes: readFileSync(path.join(work, name)) }));
    if (files.length === 0) throw new ArtifactError(`nothing to seal in ${work}`);
    writeSealed(out, seal(files, key), key);
    const h = readHeader(readFileSync(out));
    console.log(`sealed   : ${out}\nkey id   : ${h.keyId}\nmembers  : ${h.files.map((f) => `${f.name} (${f.size} B)`).join(", ")}\nsha256   : ${sha256(readFileSync(out))}`);
  } else if (cmd === "inspect") {
    const h = readHeader(readFileSync(args[0]));
    console.log(JSON.stringify({ ...h, nonce: "(omitted)" }, null, 2));
  } else if (cmd === "verify") {
    const env = readFileSync(args[0]);
    const h = readHeader(env);
    const { files } = open(env, keyForId(h.keyId, keyring, forbid));
    console.log(`verified : ${args[0]}\nkey id   : ${h.keyId}\nmembers  : ${files.length}, every checksum agrees`);
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
