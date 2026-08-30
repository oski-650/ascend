// core/knowledge — the Knowledge-index ORCHESTRATOR (Phase 4.2, D-4.2.1).
//
// The core-side gather layer: it discovers vault objects (via core/vault — the single fs walk), parses
// them (via packages/markdown), reads events once (via core/events), and invokes the PURE builder
// (packages/indexer.buildIndex). It is the SINGLE producer of the KnowledgeIndex (KI-1). Filesystem
// knowledge stays here (core) and never leaks downward into packages. The index is built on demand,
// in-memory, and is never persisted (KI-2).

import "server-only";
import path from "node:path";
import { crmDir, sopDir } from "@/core/vault/paths";
import { listProspectSources } from "@/core/crm";
import { listMarkdownFiles, readTextFile } from "@/core/vault/markdown";
import { listSubdirs } from "@/core/vault/io";
import { readEvents } from "@/core/events";
import { parseMarkdown } from "@/packages/markdown";
import { buildIndex, type ParsedObject, type KnowledgeIndex } from "@/packages/indexer";
import { can } from "@/core/auth/capabilities";
import type { ResolvedPrincipal } from "@/core/auth/principal";
import type { EntityKind } from "@/domain";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function titleOf(frontmatter: Record<string, unknown>, fallback: string): string {
  return str(frontmatter.name) ?? str(frontmatter.business) ?? str(frontmatter.title) ?? fallback;
}

/** Parse one source file into a ParsedObject — the single parse per object (KI-4). Missing/unreadable → null. */
async function toParsedObject(absPath: string, entity: EntityKind, id: string): Promise<ParsedObject | null> {
  const raw = await readTextFile(absPath);
  if (raw === null) return null;
  const { frontmatter, body, wikilinks } = parseMarkdown(raw);
  return { sourcePath: absPath, entity, id, title: titleOf(frontmatter, id), frontmatter, body, wikilinks };
}

/**
 * Prospects — through the CANONICAL READER, not the filesystem.
 *
 * This used to call `hitListDir()` and parse the files itself, which made it the one consumer of
 * ten that reached past `core/crm`. After a source-of-truth flip it would have kept serving the
 * knowledge index — and therefore the graph and /search — from Obsidian while every other consumer
 * read Postgres. The parse still happens here, because parsing is this module's job; only the
 * DISCOVERY moved to the module that owns where prospects live.
 */
async function discoverProspects(): Promise<ParsedObject[]> {
  const sources = await listProspectSources();
  return sources.map((s) => {
    const { frontmatter, body, wikilinks } = parseMarkdown(s.raw);
    return {
      sourcePath: s.sourcePath, entity: "prospect" as EntityKind, id: s.id,
      title: titleOf(frontmatter, s.id), frontmatter, body, wikilinks,
    };
  });
}

/** Clients — `01 - CRM & Clients/<slug>/business_context.md`. */
async function discoverClients(): Promise<ParsedObject[]> {
  const dir = crmDir();
  const slugs = (await listSubdirs(dir)).filter((s) => !s.startsWith("_") && !s.startsWith(".")).sort();
  const out: ParsedObject[] = [];
  for (const slug of slugs) {
    const o = await toParsedObject(path.join(dir, slug, "business_context.md"), "client", slug);
    if (o) out.push(o);
  }
  return out;
}

/** SOPs — `03 - SOP Library/<slug>.md` (top-level files; the automations/ subdir is not a markdown object). */
async function discoverSops(): Promise<ParsedObject[]> {
  const dir = sopDir();
  const files = (await listMarkdownFiles(dir)).sort();
  const out: ParsedObject[] = [];
  for (const file of files) {
    const o = await toParsedObject(path.join(dir, file), "sop", file.replace(/\.md$/i, ""));
    if (o) out.push(o);
  }
  return out;
}

/**
 * WHICH ENTITY KINDS THIS INDEX IS ALLOWED TO CONTAIN.
 *
 * ─── WHY THE FILTER IS HERE AND NOT AT THE ROUTE ─────────────────────────────────────────────
 *
 * STAGE2F §9: `/api/console/search` traverses every entity and returns titles and text excerpts. A
 * capability check on the ROUTE is not enough — a `sales` principal would get a perfectly
 * authorized 200 full of client names. The filter has to live where the results are ASSEMBLED, or
 * every future consumer of the index re-implements it and one of them gets it wrong.
 *
 * ─── NOT DISCOVERED, RATHER THAN DISCOVERED-THEN-DROPPED ─────────────────────────────────────
 *
 * A `false` here means the files are never read. That is deliberately stronger than filtering the
 * result set: excluded material never enters the process, so it cannot leak through a bug in a
 * later filter, an error message, a debug log, or a scoring pass that happens to echo a title.
 *
 * ─── NO DEFAULT ──────────────────────────────────────────────────────────────────────────────
 *
 * `buildKnowledgeIndex` takes this as a required argument. A default would be an implicit allow —
 * exactly the authorization-by-absence F49 names — and a required argument makes the compiler,
 * rather than a reviewer, the thing that notices a new caller has not decided.
 */
export type KnowledgeVisibility = {
  readonly clients: boolean;
  readonly prospects: boolean;
  readonly sops: boolean;
};

/** What a principal may see. The one place capabilities become index visibility. */
export function visibilityFor(principal: ResolvedPrincipal): KnowledgeVisibility {
  return {
    clients: can(principal, "clients:*"),
    prospects: can(principal, "prospects:read"),
    sops: can(principal, "sops:read"),
  };
}

/**
 * THE UNSCOPED INDEX — for callers that are NOT an authorization boundary.
 *
 * This is not "everyone may see everything". It is: there are server-rendered PAGES
 * (`app/console`, `app/search`, the graph) which have no request context yet, because establishing
 * one inside a React Server Component is 2G's work along with the partner UI itself. Until then
 * they build the full index, exactly as they always have.
 *
 * That is a NAMED GAP, not a silent one, and it is contained: F49 forbids anything under `app/api`
 * from referencing this constant, so the authorized surface cannot quietly adopt it. The partner
 * has no UI in 2F (§13), so no `sales` principal reaches those pages during this stage.
 */
export const UNSCOPED_INTERNAL_INDEX: KnowledgeVisibility = {
  clients: true, prospects: true, sops: true,
};

/**
 * Build the one KnowledgeIndex (KI-1) on demand. Deterministic: each section is discovered in sorted
 * order and concatenated in a fixed order, then handed to the pure builder. In-memory, never persisted
 * (KI-2). Events are read once (the single reader) and passed to the builder's reserved linkage point.
 */
export async function buildKnowledgeIndex(visibility: KnowledgeVisibility): Promise<KnowledgeIndex> {
  const none = Promise.resolve<ParsedObject[]>([]);
  const [clients, prospects, sops, events] = await Promise.all([
    visibility.clients ? discoverClients() : none,
    visibility.prospects ? discoverProspects() : none,
    visibility.sops ? discoverSops() : none,
    readEvents(),
  ]);
  const objects: ParsedObject[] = [...clients, ...prospects, ...sops];
  return buildIndex(objects, events);
}
