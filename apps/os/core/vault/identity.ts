// core/vault/identity.ts — the slug ⟷ id resolution seam (D1).
// `structural_meta.client_id` is the immutable identity anchor; the folder slug is a
// readable, renameable alias. This index is DERIVED and fully rebuildable by scanning
// the vault — never a source of truth. Renames must go through core (never Finder).

import "server-only";
import path from "node:path";
import type { ClientId, ClientSlug, ProspectId, ProspectSlug, StructuralMeta } from "@/domain";
import { asClientId, asClientSlug, asProspectId, asProspectSlug } from "@/domain";
import { crmDir, hitListDir } from "./paths";
import { listSubdirs, readJsonFile } from "./io";
import { listMarkdownFiles, readMarkdownFile } from "./markdown";

const META_FILE = "structural_meta.json";

/** Read a client's structural_meta.json (the identity anchor). Null if absent/malformed. */
export async function getStructuralMeta(slug: string): Promise<StructuralMeta | null> {
  return readJsonFile<StructuralMeta>(path.join(crmDir(), slug, META_FILE));
}

/**
 * Resolve a client slug to its stable ClientId.
 * Fallback (per D1 migration posture): a client without structural_meta resolves to
 * its slug — the anchor is adopted where it exists, tolerated where it doesn't yet.
 */
export async function resolveClientId(slug: string): Promise<ClientId> {
  const meta = await getStructuralMeta(slug);
  return meta?.client_id ? asClientId(String(meta.client_id)) : asClientId(slug);
}

/**
 * A structured integrity violation surfaced during index construction (D1 / Part IV §IV.6).
 * Reconcile-on-read posture: DETECT and SURFACE — do not crash, do not auto-repair.
 * (Repair Signals are a Phase 3 responsibility; this is the structured diagnostic they consume.)
 */
export type IntegrityViolation = {
  kind: "duplicate_client_id";
  client_id: ClientId;
  /** Every CRM folder claiming this id — all preserved, none overwritten. */
  slugs: ClientSlug[];
};

export type ClientIdIndex = {
  bySlug: Map<ClientSlug, ClientId>;
  /** Unambiguous 1:1 ids only. An id claimed by >1 folder is withheld here and reported in `violations`. */
  byId: Map<ClientId, ClientSlug>;
  violations: IntegrityViolation[];
};

/**
 * Rebuildable slug⟷id index over the whole CRM section (derived, never persisted).
 * `client_id` is the canonical identity anchor (D1) — a duplicate across two folders is an
 * integrity violation, never a last-writer-wins overwrite.
 */
export async function buildClientIdIndex(): Promise<ClientIdIndex> {
  const bySlug = new Map<ClientSlug, ClientId>();
  const idToSlugs = new Map<ClientId, ClientSlug[]>();

  for (const dir of await listSubdirs(crmDir())) {
    const slug = asClientSlug(dir);
    const id = await resolveClientId(dir);
    bySlug.set(slug, id);
    const claimants = idToSlugs.get(id) ?? [];
    claimants.push(slug);
    idToSlugs.set(id, claimants);
  }

  const byId = new Map<ClientId, ClientSlug>();
  const violations: IntegrityViolation[] = [];
  for (const [id, slugs] of idToSlugs) {
    if (slugs.length === 1) {
      byId.set(id, slugs[0]);
    } else {
      // Every claimant preserved (in bySlug + the violation); never silently overwritten.
      violations.push({ kind: "duplicate_client_id", client_id: id, slugs });
    }
  }

  return { bySlug, byId, violations };
}

// ─── Prospect identity (D-4) ───────────────────────────────────────────────────────────────────
//
// Prospects had NO identity anchor. `core/reconciler/observation.ts` states the consequence
// plainly: "prospects have no stable id, so a missing file cannot be distinguished from a rename."
// Identity was `slugify(name)`, which means a business's identity changed when its display name
// was corrected, and two spellings of one business were two businesses. The live vault already
// demonstrates the failure — `tapia-tile-amp-marble-co` and
// `tile-amp-marble-installation-in-bay-area` are one company, recorded twice, both carrying the
// same website, and both carrying `&amp;` where an ampersand belongs.
//
// `prospect_id` is the fix, and it is deliberately the same shape as `client_id` (D1).

/**
 * Read a prospect's stable id, or `null` when it does not have one yet.
 *
 * DELIBERATELY UNLIKE `resolveClientId`, which falls back to the folder slug. That fallback is a
 * migration tolerance for four stable client folders, and copying it here would re-commit the
 * exact error D-4 exists to correct: it would make the slug function as the id again, silently,
 * for every prospect that has not been backfilled. A prospect without an anchor has no stable
 * identity, and this returns that fact instead of manufacturing one.
 */
export async function resolveProspectId(slug: string): Promise<ProspectId | null> {
  const md = await readMarkdownFile(path.join(hitListDir(), `${slug}.md`));
  if (md.missing) return null;
  return readProspectIdFrom(md.frontmatter);
}

/** Extract a well-formed `prospect_id` from parsed frontmatter. Blank/non-scalar ⇒ null. */
export function readProspectIdFrom(frontmatter: Record<string, unknown>): ProspectId | null {
  const raw = frontmatter.prospect_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? asProspectId(trimmed) : null;
}

export type ProspectIntegrityViolation = {
  kind: "duplicate_prospect_id";
  prospect_id: ProspectId;
  /** Every prospect file claiming this id — all preserved, none overwritten. */
  slugs: ProspectSlug[];
};

export type ProspectIdIndex = {
  /** Anchored prospects only. A prospect with no `prospect_id` is absent here, by design. */
  bySlug: Map<ProspectSlug, ProspectId>;
  /** Unambiguous 1:1 ids only; an id claimed by >1 file is withheld and reported in `violations`. */
  byId: Map<ProspectId, ProspectSlug>;
  /**
   * Prospects with no anchor yet — REPORTED, never invented. This list is the backfill's worklist
   * and, while it is non-empty, the reason the slug is still the addressing key everywhere else.
   */
  unanchored: ProspectSlug[];
  violations: ProspectIntegrityViolation[];
};

/** Rebuildable slug⟷id index over the hit list (derived, never persisted) — the client index's twin. */
export async function buildProspectIdIndex(): Promise<ProspectIdIndex> {
  const dir = hitListDir();
  const bySlug = new Map<ProspectSlug, ProspectId>();
  const unanchored: ProspectSlug[] = [];
  const idToSlugs = new Map<ProspectId, ProspectSlug[]>();

  for (const file of await listMarkdownFiles(dir)) {
    const slug = asProspectSlug(file.replace(/\.md$/, ""));
    const md = await readMarkdownFile(path.join(dir, file));
    if (md.missing) continue;
    const id = readProspectIdFrom(md.frontmatter);
    if (id === null) {
      unanchored.push(slug);
      continue;
    }
    bySlug.set(slug, id);
    const claimants = idToSlugs.get(id) ?? [];
    claimants.push(slug);
    idToSlugs.set(id, claimants);
  }

  const byId = new Map<ProspectId, ProspectSlug>();
  const violations: ProspectIntegrityViolation[] = [];
  for (const [id, slugs] of idToSlugs) {
    if (slugs.length === 1) byId.set(id, slugs[0]);
    else violations.push({ kind: "duplicate_prospect_id", prospect_id: id, slugs });
  }

  return { bySlug, byId, unanchored, violations };
}

// ─── Duplicate CANDIDATES (never merges) ───────────────────────────────────────────────────────

/** Normalize a website URL to a comparable host+path key. Returns null when there is nothing to compare. */
export function normalizeWebsiteKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const stripped = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
  return stripped.length > 0 ? stripped : null;
}

/** Normalize a business name for comparison: entities decoded upstream, punctuation and legal suffixes dropped. */
export function normalizeNameKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(inc|llc|ltd|corp|corporation|company|co)$/g, "")
    .trim();
  return collapsed.length > 0 ? collapsed : null;
}

/** Last 10 digits of a phone number — the comparable part, ignoring formatting and country prefix. */
export function normalizePhoneKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** One pair of prospect files that appear to describe the same business. */
export type DuplicateCandidate = {
  slugs: [ProspectSlug, ProspectSlug];
  /** Which corroborating field matched, and what it matched on — so a human can judge it. */
  matchedOn: "website" | "phone" | "email" | "name";
  value: string;
};

/** Narrow input so this stays pure and testable without a vault (the relationships/derive pattern). */
export type ProspectIdentityRecord = {
  slug: ProspectSlug;
  name?: unknown;
  website?: unknown;
  contact_phone?: unknown;
  contact_email?: unknown;
};

/**
 * Prospect pairs that CORROBORATE as the same business — surfaced for review, never merged.
 *
 * Mirrors `buildClientIdIndex`'s posture on duplicate ids: DETECT and SURFACE, do not auto-repair.
 * A merge destroys one record's history and its human judgments, and no rule here is strong enough
 * to justify that automatically. Ordering is strongest evidence first — a shared website or phone
 * number is two independent sources agreeing; a matching name is not, because dozens of businesses
 * share one.
 */
export function findDuplicateCandidates(
  records: readonly ProspectIdentityRecord[]
): DuplicateCandidate[] {
  const FIELDS = [
    { kind: "website" as const, key: (r: ProspectIdentityRecord) => normalizeWebsiteKey(r.website) },
    { kind: "phone" as const, key: (r: ProspectIdentityRecord) => normalizePhoneKey(r.contact_phone) },
    {
      kind: "email" as const,
      key: (r: ProspectIdentityRecord) =>
        typeof r.contact_email === "string" && r.contact_email.trim()
          ? r.contact_email.trim().toLowerCase()
          : null,
    },
    { kind: "name" as const, key: (r: ProspectIdentityRecord) => normalizeNameKey(r.name) },
  ];

  const out: DuplicateCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const field of FIELDS) {
    const byValue = new Map<string, ProspectSlug[]>();
    for (const record of records) {
      const key = field.key(record);
      if (key === null) continue;
      byValue.set(key, [...(byValue.get(key) ?? []), record.slug]);
    }
    for (const [value, slugs] of byValue) {
      if (slugs.length < 2) continue;
      const sorted = [...slugs].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          // One pair is reported once, under its STRONGEST evidence — FIELDS is ordered, so a pair
          // matching on both website and name is reported as a website match, not twice.
          const pairKey = `${sorted[i]}|${sorted[j]}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          out.push({ slugs: [sorted[i], sorted[j]], matchedOn: field.kind, value });
        }
      }
    }
  }

  return out;
}
