// core/vault/identity.ts — the slug ⟷ id resolution seam (D1).
// `structural_meta.client_id` is the immutable identity anchor; the folder slug is a
// readable, renameable alias. This index is DERIVED and fully rebuildable by scanning
// the vault — never a source of truth. Renames must go through core (never Finder).

import "server-only";
import path from "node:path";
import type { ClientId, ClientSlug, StructuralMeta } from "@/domain";
import { asClientId, asClientSlug } from "@/domain";
import { crmDir } from "./paths";
import { listSubdirs, readJsonFile } from "./io";

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
