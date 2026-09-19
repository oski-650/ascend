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
  ArtifactError, FORMAT, assertKeyLocation, generateKey, keyForId, keyIdOf, open, readHeader, readKey, seal,
  writeSealed, type BundleFile,
} from "@/core/recovery/artifact";

const dirs: string[] = [];
const temp = (p: string) => { const d = mkdtempSync(path.join(tmpdir(), p)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FILES: BundleFile[] = [
  { name: "ascend-public-portable.sql", bytes: Buffer.from("INSERT INTO public.users VALUES ('ü', '\\n');\n") },
  { name: "source-manifest.tsv", bytes: Buffer.from("meta.format\tascend-recovery-manifest/1\n") },
  { name: "empty.txt", bytes: Buffer.alloc(0) },
];

function freshKey() {
  const ring = temp("ascend-keys-");
  const { keyId, keyFile } = generateKey(ring);
  return { ring, keyId, keyFile, key: keyForId(keyId, ring) };
}

describe("sealing and opening", () => {
  it("round-trips every member exactly, and the header names the key and the members", () => {
    const { key, keyId } = freshKey();
    const env = seal(FILES, key);
    const h = readHeader(env);
    expect(h.format).toBe(FORMAT);
    expect(h.keyId).toBe(keyId);
    expect(h.files.map((f) => f.name)).toEqual(FILES.map((f) => f.name));
    const { files } = open(env, key);
    expect(files.map((f) => [f.name, f.bytes.toString("hex")])).toEqual(FILES.map((f) => [f.name, f.bytes.toString("hex")]));
  });

  it("the ciphertext does not contain the plaintext", () => {
    const { key } = freshKey();
    expect(seal(FILES, key).includes(FILES[0].bytes)).toBe(false);
  });

  it("two seals of the same content differ (fresh nonce), and both open", () => {
    const { key } = freshKey();
    const a = seal(FILES, key), b = seal(FILES, key);
    expect(a.equals(b)).toBe(false);
    expect(open(a, key).files).toHaveLength(3);
    expect(open(b, key).files).toHaveLength(3);
  });
});

describe("tampering is refused, and nothing is released", () => {
  const { key } = freshKey();
  const env = seal(FILES, key);
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
    expect(() => readHeader(Buffer.from("PGDMP custom dump"))).toThrow(/not an ascend-backup\/2 artifact/);
  });
});

describe("keys", () => {
  it("the wrong key is refused by id — and never tried against the body", () => {
    const a = freshKey(), b = freshKey();
    expect(() => open(seal(FILES, a.key), b.key)).toThrow(new RegExp(`sealed under key ${a.keyId}`));
  });

  it("a missing key is named by its id, so the operator knows which escrowed key to recover", () => {
    const a = freshKey();
    const env = seal(FILES, a.key);
    const emptyRing = temp("ascend-empty-ring-");
    expect(() => keyForId(readHeader(env).keyId, emptyRing)).toThrow(new RegExp(`needs key ${a.keyId}`));
  });

  it("the key id is derived from the key but cannot stand in for it", () => {
    const { key, keyId } = freshKey();
    expect(keyIdOf(key)).toBe(keyId);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(() => open(seal(FILES, key), Buffer.from(keyId.padEnd(64, "0"), "hex"))).toThrow(ArtifactError);
  });

  it("ROTATION: after a new key exists, an old artifact still opens with the key it names", () => {
    const ring = temp("ascend-rotating-ring-");
    const first = generateKey(ring);
    const oldEnv = seal(FILES, keyForId(first.keyId, ring));
    const second = generateKey(ring); // rotation
    const newEnv = seal(FILES, keyForId(second.keyId, ring));
    expect(second.keyId).not.toBe(first.keyId);
    expect(open(oldEnv, keyForId(readHeader(oldEnv).keyId, ring)).files).toHaveLength(3);
    expect(open(newEnv, keyForId(readHeader(newEnv).keyId, ring)).files).toHaveLength(3);
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
    const env = seal(FILES, key);
    for (const form of [key, Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex"))]) {
      expect(env.includes(form)).toBe(false);
    }
  });

  it.each(["raw", "base64", "hex"] as const)("an input that carries the key (%s) is refused before sealing", (enc) => {
    const { key } = freshKey();
    const leaked = enc === "raw" ? key : Buffer.from(key.toString(enc));
    expect(() => seal([...FILES, { name: "leak.txt", bytes: Buffer.concat([Buffer.from("x"), leaked]) }], key))
      .toThrow(/contains the encryption key/);
  });
});

describe("writing is atomic", () => {
  it("a completed write verifies from disk and leaves no partial", () => {
    const { key } = freshKey();
    const out = path.join(temp("ascend-out-"), "a.ascbk");
    writeSealed(out, seal(FILES, key), key);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(`${out}.partial`)).toBe(false);
    expect(open(readFileSync(out), key).files).toHaveLength(3);
  });

  it("a write that fails verification leaves nothing under the final name, and no partial", () => {
    const a = freshKey(), b = freshKey();
    const out = path.join(temp("ascend-out-"), "b.ascbk");
    // Sealed under `a` but verified with `b`: the post-write check fails, as a corrupted write would.
    expect(() => writeSealed(out, seal(FILES, a.key), b.key)).toThrow();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it("an existing artifact is never overwritten", () => {
    const { key } = freshKey();
    const out = path.join(temp("ascend-out-"), "c.ascbk");
    writeSealed(out, seal(FILES, key), key);
    expect(() => writeSealed(out, seal(FILES, key), key)).toThrow(/refusing to overwrite/);
  });
});
