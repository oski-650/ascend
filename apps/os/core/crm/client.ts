// core/crm/client.ts — Client profile reads (2.1) + client creation (2.2).
// Vault I/O goes through core/vault primitives only (no direct fs — fitness function).
// Writes follow: validate identity/refs → write via core/vault → emitEvent → return.

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { readJsonFile, listSubdirs } from "@/core/vault/io";
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

  // 2. Write through core/vault (atomic per file).
  const clientDir = path.join(dir, input.slug);
  await writeMarkdownFileAtomic(path.join(clientDir, PROFILE_FILES.business), input.business.frontmatter, input.business.body);
  await writeMarkdownFileAtomic(path.join(clientDir, PROFILE_FILES.brand), input.brand.frontmatter, input.brand.body);
  await writeMarkdownFileAtomic(path.join(clientDir, PROFILE_FILES.scope), input.scope.frontmatter, input.scope.body);
  await writeJsonFileAtomic(path.join(clientDir, META_FILE), input.meta);

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
