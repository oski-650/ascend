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
import { parseMarkdown } from "@/packages/markdown";
import { buildIndex, type ParsedObject, type KnowledgeIndex } from "@/packages/indexer";
import { can } from "@/core/auth/capabilities";
import { requireCapability } from "@/core/auth/authority";
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
 * WHO IS ASSEMBLING THIS INDEX — resolved here, never supplied by the caller.
 *
 * ─── WHAT THIS REPLACED, AND THE DEFECT IT WAS ───────────────────────────────────────────────
 *
 * Until 2G.1 slice 4 this module exported an all-true visibility constant and `buildKnowledgeIndex`
 * took a visibility argument. That made the index's security depend on every caller passing a
 * truthful one — and two callers did not:
 *
 * (The retired constant is not named here, and that is deliberate: F49 now bans its identifier from
 * every production root, including comments, so nobody can reintroduce it by copying a line out of
 * the very file that explains why it was removed. The name survives in STAGE2G §23 and in git.)
 *
 *   MEASURED at 017b633:  /console rendered as SALES put a client name and an owner-only SOP title
 *                         into the markup. `console` demands only `prospects:read`, which sales
 *                         holds, and `discoverClients()` reads the vault directly rather than
 *                         through the `clients:*`-guarded reader — so the flag was the only guard.
 *
 *   MEASURED at 017b633:  / rendered as SALES correctly DENIED, and opened a client file and a SOP
 *                         file anyway: `projectGraph` starts this build inside a `Promise.all`
 *                         beside the guarded readers, and a rejected `Promise.all` cannot cancel
 *                         its siblings.
 *
 * The second one is the important one. Hiding the result was never the property:
 *
 *   > The index boundary must decide what gets built before the filesystem or database is touched —
 *   > not decide what gets hidden afterward.
 *
 * ─── WHY `search`, AND WHY IT IS NOT A DENIAL ────────────────────────────────────────────────
 *
 * `search` authorizes the ACT of assembling; both roles hold it. Search is not a domain a role
 * either has or lacks (STAGE2F §9) — what differs is what comes back, and that is decided by
 * `visibilityFor` from the SAME principal. A caller with no authority gets nothing at all, which is
 * the one case where refusing is correct: nobody is asking.
 */
async function currentVisibility(): Promise<KnowledgeVisibility> {
  return visibilityFor(await requireCapability("search"));
}

/**
 * Build the one KnowledgeIndex (KI-1) on demand, as whoever is asking. Deterministic: each section
 * is discovered in sorted order and concatenated in a fixed order, then handed to the pure builder.
 * In-memory, never persisted (KI-2).
 *
 * TAKES NO ARGUMENT, and that is the security property rather than an ergonomic one: there is no
 * parameter through which a caller could assert an authority it does not hold.
 */
export async function buildKnowledgeIndex(): Promise<KnowledgeIndex> {
  return assemble(await currentVisibility());
}

/**
 * The assembly itself. Private, because reaching it directly is exactly what slice 4 removed.
 *
 * ─── NOT DISCOVERED, RATHER THAN DISCOVERED-THEN-DROPPED ─────────────────────────────────────
 *
 * A `false` means the files are never read. Stronger than filtering a result set: excluded material
 * never enters the process, so it cannot leak through a bug in a later filter, an error message, a
 * debug log, or a scoring pass that happens to echo a title.
 *
 * ─── EVENTS ARE NOT READ ─────────────────────────────────────────────────────────────────────
 *
 * `buildIndex` does `void events` — V1 derives no edge, no document and no timeline from them, and
 * the parameter is a reserved linkage point. Reading the crm/production/intelligence logs here was
 * therefore unguarded I/O over protected material with no consumer, which is the same violation the
 * rest of this file exists to prevent, minus the leak. The seam stays; the read is gone. A future
 * contributor that needs events must ask for them, and the scoping question surfaces then instead
 * of being inherited from a line nobody remembered was here.
 */
async function assemble(visibility: KnowledgeVisibility): Promise<KnowledgeIndex> {
  const none = Promise.resolve<ParsedObject[]>([]);
  const [clients, prospects, sops] = await Promise.all([
    visibility.clients ? discoverClients() : none,
    visibility.prospects ? discoverProspects() : none,
    visibility.sops ? discoverSops() : none,
  ]);
  return buildIndex([...clients, ...prospects, ...sops], []);
}

/**
 * TEST ONLY — the mutation seam.
 *
 * §23 E5 requires proving that the unscoped variant leaks in the same assertions that the scoped one
 * passes; without a way to express the old behaviour there is no way to show the tests measure it.
 * Named `__unsafe…ForTests` to match `__unsafePrincipalForTests`, and no production module may call
 * it — a caller supplying its own visibility is the defect, and the name is the reminder.
 */
export async function __unsafeBuildKnowledgeIndexForTests(
  visibility: KnowledgeVisibility
): Promise<KnowledgeIndex> {
  return assemble(visibility);
}
