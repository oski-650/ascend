// core/crm/client.ts — Client profile reads (2.1) + client creation (2.2).
// Vault I/O goes through core/vault primitives only (no direct fs — fitness function).
// Writes follow: validate identity/refs → write via core/vault → emitEvent → return.

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { readJsonFile, listSubdirs, renameEntryAtomic, removeStagingDir } from "@/core/vault/io";
import { readMarkdownFile, writeMarkdownFileAtomic, writeJsonFileAtomic } from "@/core/vault/markdown";
import { buildClientIdIndex } from "@/core/vault/identity";
import { emitEvent } from "@/core/events";
import { asClientId, type Actor, type ClientId } from "@/domain";
import { requireCapability } from "@/core/auth/authority";

export type Frontmatter = Record<string, unknown>;

export type ProfileSection = {
  frontmatter: Frontmatter;
  body: string;
  missing: boolean;
};

export type Client = {
  slug: string;
  name: string;
  business: ProfileSection;
  brand: ProfileSection;
  scope: ProfileSection;
  meta: { data: Frontmatter; missing: boolean };
};

const PROFILE_FILES = {
  business: "business_context.md",
  brand: "brand_identity.md",
  scope: "project_scope.md",
} as const;

const META_FILE = "structural_meta.json";

async function readMeta(dir: string): Promise<{ data: Frontmatter; missing: boolean }> {
  const data = await readJsonFile<Frontmatter>(path.join(dir, META_FILE));
  return { data: data ?? {}, missing: data === null };
}

// ─── Reads (Phase 2.1) ────────────────────────────────────────────────────────

export async function listClients(): Promise<{ slug: string; name: string }[]> {
  await requireCapability("clients:*");
  const dir = crmDir();
  const slugs = await listSubdirs(dir);
  const clients = await Promise.all(
    slugs.map(async (slug) => {
      const business = await readMarkdownFile(path.join(dir, slug, PROFILE_FILES.business));
      const name =
        (business.frontmatter.name as string | undefined) ??
        (business.frontmatter.business as string | undefined) ??
        slug;
      return { slug, name };
    })
  );
  return clients.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClient(slug: string): Promise<Client | null> {
  await requireCapability("clients:*");
  // Existence via the CRM directory listing (real clients only; underscore/hidden → null).
  if (!(await listSubdirs(crmDir())).includes(slug)) return null;
  const dir = path.join(crmDir(), slug);

  const [business, brand, scope, meta] = await Promise.all([
    readMarkdownFile(path.join(dir, PROFILE_FILES.business)),
    readMarkdownFile(path.join(dir, PROFILE_FILES.brand)),
    readMarkdownFile(path.join(dir, PROFILE_FILES.scope)),
    readMeta(dir),
  ]);

  const name =
    (business.frontmatter.name as string | undefined) ??
    (business.frontmatter.business as string | undefined) ??
    slug;

  return { slug, name, business, brand, scope, meta };
}

// ─── Writes (Phase 2.2) ───────────────────────────────────────────────────────

export type ClientFileInput = { frontmatter: Frontmatter; body: string };

export type CreateClientInput = {
  slug: string;
  business: ClientFileInput;
  brand: ClientFileInput;
  scope: ClientFileInput;
  /** structural_meta.json content — must include `client_id` (the immutable anchor, D1). */
  meta: Frontmatter;
};

/**
 * The client promoted from this prospect anchor, if one exists (D1a).
 *
 * THE IDEMPOTENCY KEY FOR PROMOTION. `promoted_from_prospect` has always carried the prospect's
 * SLUG, which is renameable and, for 3,102 of production's 3,108 prospects, NULL — so it could
 * never answer "was this prospect already promoted?". `promoted_from_prospect_id` carries the
 * anchor, and this lookup is what stops a retry with a different client slug from creating a second
 * client for one prospect.
 */
export async function findClientPromotedFrom(prospectId: string): Promise<{ slug: string; clientId: ClientId } | null> {
  for (const slug of await listSubdirs(crmDir())) {
    const meta = await readJsonFile<Frontmatter>(path.join(crmDir(), slug, META_FILE));
    if (meta && String(meta.promoted_from_prospect_id ?? "") === prospectId) {
      return { slug, clientId: asClientId(String(meta.client_id ?? slug)) };
    }
  }
  return null;
}

export type CreateClientResult =
  | { ok: true; slug: string; clientId: ClientId }
  | { ok: false; code: "client_exists" | "duplicate_client_id"; message: string };

/**
 * Create a new CRM client: validate identity → write the 4 party-layer files → emit client.created.
 * `client_id` is the immutable anchor (= slug, matching existing clients). A duplicate client_id
 * across folders is REJECTED here (via the frozen identity seam), never silently overwritten.
 */
export async function createClient(
  input: CreateClientInput,
  /**
   * `actor` defaults to `operator`, which is right for the normal path: a client created through
   * the OS genuinely is operator activity. It is threadable because RETROACTIVE ONBOARDING is not
   * — reconstructing a client who has existed since May is Ascend recording a historical entity,
   * not the operator working in the OS today. Getting that wrong would credit §19's adoption
   * measurement for work that never happened in the surface it is measuring.
   */
  opts: { correlationId?: string; actor?: Actor } = {}
): Promise<CreateClientResult> {
  await requireCapability("clients:*");
  const dir = crmDir();

  // 1. Validate references/identity BEFORE any write.
  if ((await listSubdirs(dir)).includes(input.slug)) {
    return { ok: false, code: "client_exists", message: `CRM client "${input.slug}" already exists` };
  }
  const clientId = asClientId(String(input.meta.client_id ?? input.slug));
  const index = await buildClientIdIndex(); // first real identity-seam consumption
  if (index.byId.has(clientId) || index.violations.some((v) => v.client_id === clientId)) {
    return {
      ok: false,
      code: "duplicate_client_id",
      message: `client_id "${clientId}" is already claimed by another client folder`,
    };
  }

  // 2. Write through core/vault, into a STAGING directory, then move it into place in one step.
  //
  //    Four atomic file writes are not an atomic client. A failure on the second left a folder that
  //    `listSubdirs` reports as a client and that every later attempt then refuses as
  //    `client_exists` — a promotion that can never be retried into success (D1a). A `.staging-*`
  //    name is invisible to `listSubdirs` (it skips dot-prefixed entries), so a half-written client
  //    is not a client; the rename is what publishes it.
  const clientDir = path.join(dir, input.slug);
  const staging = path.join(dir, `.staging-${input.slug}-${opts.correlationId ?? Date.now().toString(36)}`);
  try {
    await writeMarkdownFileAtomic(path.join(staging, PROFILE_FILES.business), input.business.frontmatter, input.business.body);
    await writeMarkdownFileAtomic(path.join(staging, PROFILE_FILES.brand), input.brand.frontmatter, input.brand.body);
    await writeMarkdownFileAtomic(path.join(staging, PROFILE_FILES.scope), input.scope.frontmatter, input.scope.body);
    await writeJsonFileAtomic(path.join(staging, META_FILE), input.meta);
    await renameEntryAtomic(staging, clientDir);
  } catch (e) {
    // The staging directory is the only thing that can be left behind, and nothing reads it.
    await removeStagingDir(staging).catch(() => {});
    throw e;
  }

  // 3. Emit (once, after all writes succeed).
  await emitEvent({
    type: "client.created",
    ...(opts.actor ? { actor: opts.actor } : {}),
    subject: { entity: "client", entity_id: clientId },
    data: {
      slug: input.slug,
      name: (input.business.frontmatter.name as string | undefined) ?? input.slug,
      source: (input.meta.source as string | undefined) ?? null,
    },
    ...(opts.correlationId ? { correlation_id: opts.correlationId } : {}),
  });

  return { ok: true, slug: input.slug, clientId };
}
