// identity-backfill/snapshot — WHAT THE HIT LIST LOOKS LIKE BEFORE ANYTHING IS TOUCHED.
//
// The first half of the H5 discipline: snapshot, then plan against the snapshot, then apply, then
// verify the result against the snapshot you started from. Nothing here writes; there is no write
// path in this module and no import that has one.
//
// WHY A SNAPSHOT AT ALL, for a change this small. The backfill inserts ONE LINE per file. That is
// precisely why it needs a snapshot: a one-line change is easy to apply and easy to convince
// yourself about, and the only way to PROVE it changed nothing else is to hold the original bytes'
// fingerprint and compare afterwards. `verify` does exactly that.
//
// REVERSIBILITY IS A PROPERTY OF THIS SHAPE, not a separate mechanism. The applied change is
// "insert `prospect_id: <uuid>` into the frontmatter". Its inverse is "delete that line", and
// `contentSha256` here is what proves the inverse landed exactly on the original bytes. That is why
// the snapshot records the hash of the file WITHOUT any prospect_id line (`identitylessSha256`) —
// it is the fingerprint that must survive the round trip.

import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { listMarkdownFiles, readMarkdownString, readTextFile } from "@/core/vault/markdown";
import { readProspectIdFrom } from "@/core/vault/identity";
import type { ProspectId } from "@/domain";

/** The identity-bearing fields a human needs in order to review a proposed anchor (Stage 1 §3). */
export type IdentityFields = {
  name: string | null;
  website: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};

export type ProspectSnapshot = {
  slug: string;
  /** Exact bytes on disk at snapshot time. */
  content: string;
  bytes: number;
  contentSha256: string;
  /**
   * Hash of the content with every `prospect_id:` line removed.
   *
   * THE INVARIANT-BEARING FIELD. After apply, recomputing this must yield the same value — that is
   * the mechanical proof that the backfill inserted an identity and changed nothing else.
   */
  identitylessSha256: string;
  existingProspectId: ProspectId | null;
  identityFields: IdentityFields;
};

export type HitListSnapshot = {
  version: 1;
  prospects: readonly ProspectSnapshot[];
};

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Strip every frontmatter `prospect_id:` line. The inverse of the backfill's only edit. */
export function withoutIdentityLine(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*prospect_id\s*:/.test(line))
    .join("\n");
}

/** A frontmatter value as a trimmed string, or null when absent/blank/non-scalar. */
function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Capture the hit list as it stands.
 *
 * DISCOVERY IS MECHANICAL. The file set comes from `listMarkdownFiles(hitListDir())` — the same
 * reader `listProspects` and `observeProspects` use — so the inventory cannot disagree with what the
 * rest of the OS considers a prospect. H7/H8's lesson applies directly: a remembered file list is
 * not evidence, and the two failures that cost the most in the historical backfill both began with
 * a hand-maintained set.
 */
export async function snapshotHitList(): Promise<HitListSnapshot> {
  const dir = hitListDir();
  const files = await listMarkdownFiles(dir);

  const prospects: ProspectSnapshot[] = [];
  for (const file of files) {
    const content = await readTextFile(path.join(dir, file));
    // Unreadable ⇒ absent from the snapshot. It is not skipped-with-a-guess: a file that cannot be
    // read cannot be planned against, and `plan` reports the gap rather than assuming its shape.
    if (content === null) continue;
    const { frontmatter } = readMarkdownString(content);
    prospects.push({
      slug: file.replace(/\.md$/, ""),
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      contentSha256: sha256(content),
      identitylessSha256: sha256(withoutIdentityLine(content)),
      existingProspectId: readProspectIdFrom(frontmatter),
      identityFields: {
        name: str(frontmatter.name),
        website: str(frontmatter.website),
        contact_phone: str(frontmatter.contact_phone),
        contact_email: str(frontmatter.contact_email),
      },
    });
  }

  // Total order by slug so the snapshot — and everything derived from it — is deterministic.
  prospects.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { version: 1, prospects };
}