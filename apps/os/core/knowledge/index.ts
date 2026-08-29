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
 * Build the one KnowledgeIndex (KI-1) on demand. Deterministic: each section is discovered in sorted
 * order and concatenated in a fixed order, then handed to the pure builder. In-memory, never persisted
 * (KI-2). Events are read once (the single reader) and passed to the builder's reserved linkage point.
 */
export async function buildKnowledgeIndex(): Promise<KnowledgeIndex> {
  const [clients, prospects, sops, events] = await Promise.all([
    discoverClients(),
    discoverProspects(),
    discoverSops(),
    readEvents(),
  ]);
  const objects: ParsedObject[] = [...clients, ...prospects, ...sops];
  return buildIndex(objects, events);
}
