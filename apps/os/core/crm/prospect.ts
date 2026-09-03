// core/crm/prospect.ts — Prospect reads + scoring wiring (moved from lib/sales.ts, Phase 2.1).

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import {
  listMarkdownFiles,
  readMarkdownFile,
  readMarkdownString,
  readTextFile,
  writeFileAtomic,
} from "@/core/vault/markdown";
import { buildProspectIdIndex, readProspectIdFrom } from "@/core/vault/identity";
import { emitEvent } from "@/core/events";
import { computeScore, type ScoreResult } from "./scoring";
import { newProspectId } from "@/domain";
import { listProspects as listDbProspects } from "@/core/db";
import { withProspectDb, resolveProspectSource } from "./source";
import { importSheet, type ImportResult } from "@/core/intake/import";
import { buildMarkdown, slugify, type SheetColumnMap } from "./sheet-import";
import type { OrganizationId, UserId } from "@/domain";
import type { Actor, ProspectFrontmatter, ProspectId, ProspectStatus, WebsiteQuality } from "@/domain";
import type { ProspectRow as DbProspectRow } from "@/core/db";

// Prospect vocabulary is owned by domain — re-exported so the lib/sales shim's surface is preserved.
export type PipelineStatus = ProspectStatus;
export type { ProspectFrontmatter, WebsiteQuality };

export type Prospect = {
  slug: string;
  /**
   * The stable identity anchor (D-4), or `null` for a prospect that predates it.
   *
   * Null is not an error and must not be defaulted to the slug by any consumer — that is precisely
   * the conflation D-4 removes. It means "this record has no stable identity yet".
   */
  id: ProspectId | null;
  frontmatter: ProspectFrontmatter;
  body: string;
  score: ScoreResult;
};

function toProspect(slug: string, md: { frontmatter: Record<string, unknown>; body: string }): Prospect {
  const frontmatter = md.frontmatter as ProspectFrontmatter;
  return {
    slug,
    id: readProspectIdFrom(md.frontmatter),
    frontmatter,
    body: md.body,
    score: computeScore(frontmatter),
  };
}

/**
 * Every prospect, in the reader's own order — score desc, closed-lost last.
 *
 * THE CANONICAL READER, and after Stage 2C the single seam through which the store is chosen. Nine
 * consumers call this with no arguments and inherit whichever store `resolveProspectSource` selects;
 * none of them knows or needs to know which one answered.
 *
 * The Postgres branch reconstructs the SAME `Prospect` shape — frontmatter, body and computed score
 * — so behaviour is identical by construction rather than by coincidence. `body` comes from the
 * `notes` column, which exists because the Stage 2C consumer inventory found it being dropped.
 */
export async function listProspects(): Promise<Prospect[]> {
  if (resolveProspectSource() === "postgres") {
    const rows = await withProspectDb((tx) => listDbProspects(tx));
    return sortProspects(rows.map(fromDbRow));
  }

  const dir = hitListDir();
  const files = await listMarkdownFiles(dir);
  const prospects = await Promise.all(
    files.map(async (f) => toProspect(f.replace(/\.md$/, ""), await readMarkdownFile(path.join(dir, f))))
  );
  return sortProspects(prospects);
}

/**
 * Ordering, extracted so both stores share ONE implementation.
 *
 * `app/sales` documents that it consumes this order and never re-sorts. Two orderings — one per
 * store — would let the flip silently reorder the operator's queue, which no field comparison would
 * catch and which the parity ledger would.
 */
function sortProspects(prospects: Prospect[]): Prospect[] {
  return prospects.sort((a, b) => {
    const aDead = a.frontmatter.status === "closed-lost" ? 1 : 0;
    const bDead = b.frontmatter.status === "closed-lost" ? 1 : 0;
    if (aDead !== bDead) return aDead - bDead;
    return b.score.score - a.score.score;
  });
}

/** Rebuild the vault-shaped `Prospect` from a database row. The flip's fidelity lives here. */
function fromDbRow(r: DbProspectRow): Prospect {
  const frontmatter: ProspectFrontmatter = {
    ...(r.prospectId ? { prospect_id: r.prospectId } : {}),
    ...(r.name !== null ? { name: r.name } : {}),
    ...(r.businessType !== null ? { business_type: r.businessType } : {}),
    ...(r.location !== null ? { location: r.location } : {}),
    ...(r.status !== null ? { status: r.status } : {}),
    ...(r.website !== null ? { website: r.website } : {}),
    ...(r.websiteQuality !== null ? { website_quality: r.websiteQuality } : {}),
    ...(r.contactName !== null ? { contact_name: r.contactName } : {}),
    ...(r.contactPhone !== null ? { contact_phone: r.contactPhone } : {}),
    ...(r.contactEmail !== null ? { contact_email: r.contactEmail } : {}),
    ...(r.source !== null ? { source: r.source } : {}),
    ...(r.firstContact !== null ? { first_contact: r.firstContact } : {}),
    ...(r.lastContact !== null ? { last_contact: r.lastContact } : {}),
    // ABSENCE STAYS ABSENCE. A null boolean is OMITTED, not written as `false` — `false` is a claim
    // that somebody checked, and computeScore reads it as one (D-1).
    //
    // And note the tests above: a key is emitted whenever the column is NON-NULL, which includes the
    // empty string. The vault distinguishes `contact_email: ""` from an absent key, so the flip must
    // too — collapsing them would be a silent behaviour change wearing a normalisation's clothes.
    ...(r.decisionMakerAccess !== null ? { decision_maker_access: r.decisionMakerAccess } : {}),
    ...(r.projectUrgency !== null ? { project_urgency: r.projectUrgency } : {}),
    ...(r.nicheAlignment !== null ? { niche_alignment: r.nicheAlignment } : {}),
  };
  return {
    slug: r.slug ?? r.id,
    id: r.prospectId,
    frontmatter,
    body: (r.notes ?? "").trim(),
    score: computeScore(frontmatter),
  };
}

export async function getProspect(slug: string): Promise<Prospect | null> {
  // Same seam as listProspects. Resolved by slug in both stores, because the slug is still the
  // addressing key everywhere — events, routing and relationships — until that migration is a
  // separate, reviewed decision (STAGE1-GATING §2.6).
  if (resolveProspectSource() === "postgres") {
    const rows = await withProspectDb((tx) => listDbProspects(tx));
    const row = rows.find((r) => (r.slug ?? r.id) === slug);
    return row ? fromDbRow(row) : null;
  }

  const md = await readMarkdownFile(path.join(hitListDir(), `${slug}.md`));
  if (md.missing) return null;
  return toProspect(slug, md);
}

/**
 * Prospects as PARSED KNOWLEDGE OBJECTS — title, body and wikilinks.
 *
 * WHY THIS EXISTS. `core/knowledge` built these by reading `hitListDir()` and parsing the markdown
 * itself, bypassing this module entirely. It was the tenth consumer and the only one outside the
 * canonical seam, which meant a source-of-truth flip would have left the knowledge index — and
 * therefore the graph and /search — reading Obsidian while everything else read Postgres. A split
 * brain with nothing reporting the disagreement.
 *
 * The parsing stays in core/knowledge, which owns it. What moves here is the DISCOVERY: where
 * prospects come from is this module's decision, not its caller's.
 */
export async function listProspectSources(): Promise<{ id: string; sourcePath: string; raw: string }[]> {
  if (resolveProspectSource() === "postgres") {
    const rows = await withProspectDb((tx) => listDbProspects(tx));
    return rows
      .map((r) => {
        const slug = r.slug ?? r.id;
        // Reconstructed markdown, so the ONE parser in core/knowledge sees the same shape from
        // either store. Frontmatter order is fixed by `fromDbRow`, so this is deterministic.
        const fm = fromDbRow(r).frontmatter;
        const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
        return {
          id: slug,
          sourcePath: `postgres:prospects/${slug}`,
          raw: `---\n${lines.join("\n")}\n---\n\n${(r.notes ?? "").trim()}\n`,
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  const dir = hitListDir();
  const files = (await listMarkdownFiles(dir)).sort();
  const out: { id: string; sourcePath: string; raw: string }[] = [];
  for (const file of files) {
    const abs = path.join(dir, file);
    const raw = await readTextFile(abs);
    if (raw === null) continue;
    out.push({ id: file.replace(/\.md$/i, ""), sourcePath: abs, raw });
  }
  return out;
}

// ─── Writes ────────────────────────────────────────────────────────────────────────────────────

export type CreateProspectResult = {
  slug: string;
  /** True when a prospect file existed at this slug before the write. */
  existed: boolean;
  /** True when the file was written (false only for a refused overwrite or a rejected id). */
  written: boolean;
  /**
   * The prospect's stable identity anchor (D-4) — minted on creation, PRESERVED across overwrites.
   * Null only when the write was refused, in which case nothing was minted.
   */
  prospectId: ProspectId | null;
  /** Set when the write was refused for an identity reason rather than an overwrite guard. */
  code?: "duplicate_prospect_id";
};

/**
 * Force `markdown`'s frontmatter to carry exactly `prospect_id: <id>`, replacing any other value.
 *
 * REPLACE, NOT MERELY INSERT. An earlier version only inserted when the key was absent, which left
 * two holes that the D-4 tests caught: overwriting an anchored prospect with markdown that had no
 * id ERASED the anchor from the file, and overwriting it with markdown carrying a DIFFERENT id let
 * that id win on disk while the resolver had already decided it should not. Identity is resolved in
 * exactly one place (`createProspect`), so the file must end up carrying that decision and nothing
 * else.
 *
 * BYTE-FAITHFUL OTHERWISE. Only the frontmatter's `prospect_id` line is touched; every other line
 * is preserved exactly. Re-serializing through gray-matter would have been shorter and would have
 * rewritten the operator's own formatting — quote styles, key order, and the inline comments the
 * hit-list template uses — on every overwrite of a hand-edited file.
 */
function setProspectId(markdown: string, id: ProspectId): string {
  const block = markdown.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!block) {
    // No frontmatter block to anchor into. Create one rather than write an un-anchored prospect —
    // a file with no anchor is exactly what D-4 exists to stop producing.
    return `---\nprospect_id: ${id}\n---\n\n${markdown.replace(/^\s+/, "")}`;
  }
  const [whole, open, frontmatter, close] = block;
  const preserved = frontmatter
    .split(/\r?\n/)
    .filter((line) => !/^\s*prospect_id\s*:/.test(line))
    .join("\n");
  // A function replacer, so a `$` in the operator's own frontmatter is never read as a substitution.
  return markdown.replace(whole, () =>
    preserved.trim().length > 0
      ? `${open}prospect_id: ${id}\n${preserved}${close}`
      : `${open}prospect_id: ${id}${close}`
  );
}

/**
 * Write a prospect's markdown file — the canonical, sole durable writer for prospect creation.
 *
 * WHY THIS EXISTS. Two API routes (URL intake and CSV import) previously called `fs.writeFile`
 * directly, which put vault I/O in the surface layer and meant prospect creation left no memory.
 * core/events states the rule this restores: emission is part of the write, never the route
 * handler's separate job. The routes still BUILD their markdown — that is parsing and formatting,
 * not business logic — and delegate only the write.
 *
 * EXACTLY-ONCE. `prospect.created` is emitted only when no file existed at this slug. Overwriting
 * an existing prospect is not a creation, and the domain has no event for a prospect update, so an
 * overwrite writes state and records nothing rather than fabricating a second birth. A refused
 * overwrite writes nothing and emits nothing.
 *
 * The event follows the committed write, so a failed write leaves no memory claiming success.
 *
 * ACTOR IS THREADABLE (D-3), for the same reason createClient's is.
 *
 * `core/events` defaults `actor` to "operator", and that default is RIGHT for the normal path: a
 * person adding a target through the OS genuinely is operator activity. It is wrong for BULK and
 * AUTOMATED paths, and wrong in a way that cannot be undone — the event log is append-only.
 *
 * COGNITION-OBSERVATION §19 pre-registers an adoption metric: the fraction of weekdays on which the
 * OS records at least three OPERATOR-CAUSED events, measured against a 5% baseline toward a 60%
 * threshold. A bulk import of 500 rows inheriting the operator default would append 500
 * operator-caused events on a single day — clearing that day's bar 166 times over on the strength
 * of one paste, and permanently corrupting the dataset being used to decide whether Ascend OS is
 * actually being used. One operator ACTION that creates 500 records is one operator action.
 *
 * F25 and F27 already established this posture for the migration and the retroactive onboarding,
 * both of which pass `actor: "system"` explicitly and both of which have a fitness rule asserting
 * they do. Prospect creation is the third such path and gets the same treatment; F28 is its rule.
 */
export async function createProspect(
  slug: string,
  markdown: string,
  options: { overwrite?: boolean; actor?: Actor; prospectId?: ProspectId } = {}
): Promise<CreateProspectResult> {
  const filePath = path.join(hitListDir(), `${slug}.md`);
  const existing = await readTextFile(filePath);
  const existed = existing !== null;

  if (existed && !options.overwrite) {
    return { slug, existed, written: false, prospectId: null };
  }

  // ─── Identity (D-4) ─────────────────────────────────────────────────────────────────────────
  //
  // Resolution order, strongest claim first:
  //   1. the id already on disk    — an overwrite MUST NOT change who this prospect is
  //   2. the id the caller supplied — a re-import matching an existing prospect
  //   3. the id in the new markdown — the caller already anchored it
  //   4. a freshly minted id        — a genuinely new business
  //
  // Rule 1 is the load-bearing one. Overwriting a prospect replaces what we KNOW about a business;
  // it does not make it a different business. Letting the incoming markdown's id win would mean a
  // re-import could silently re-identify an existing record and orphan everything keyed to it.
  const idOnDisk = existing !== null ? readProspectIdFrom(readMarkdownString(existing).frontmatter) : null;
  const idInIncoming = readProspectIdFrom(readMarkdownString(markdown).frontmatter);
  const prospectId = idOnDisk ?? options.prospectId ?? idInIncoming ?? newProspectId();

  // UNIQUENESS — a duplicate id across two files is an integrity violation, never a last-writer
  // -wins overwrite. Same posture as createClient's duplicate_client_id rejection.
  const index = await buildProspectIdIndex();
  const claimant = index.byId.get(prospectId);
  const contested =
    (claimant !== undefined && claimant !== slug) ||
    index.violations.some((v) => v.prospect_id === prospectId);
  if (contested) {
    return { slug, existed, written: false, prospectId: null, code: "duplicate_prospect_id" };
  }

  // Unconditional: whatever the caller supplied, what lands on disk carries the RESOLVED id.
  await writeFileAtomic(filePath, setProspectId(markdown, prospectId));

  if (!existed) {
    await emitEvent({
      type: "prospect.created",
      // Omitted rather than defaulted here, so core/events stays the single owner of what an
      // unspecified actor means. Passing `actor: undefined` explicitly would work today and break
      // silently if that default ever moved.
      ...(options.actor ? { actor: options.actor } : {}),
      // SUBJECT STAYS THE SLUG. It is what the reconciler observes, what every existing
      // `prospect.created` in the live log already uses, and what `replayObservations` keys on —
      // changing it would orphan the entire existing spine. The stable id travels in `data` until a
      // reviewed backfill has anchored every prospect; only then can the addressing key move.
      subject: { entity: "prospect", entity_id: slug },
      data: { prospect_id: prospectId },
    });
  }

  return { slug, existed, written: true, prospectId };
}

export function displayName(p: Pick<Prospect, "slug" | "frontmatter">): string {
  return p.frontmatter.name?.toString() ?? p.slug;
}

export function statusLabel(s?: PipelineStatus): string {
  switch (s) {
    case "lead":
      return "Lead";
    case "contacted":
      return "Contacted";
    case "proposal":
      return "Proposal";
    case "closed-won":
      return "Closed · Won";
    case "closed-lost":
      return "Closed · Lost";
    default:
      return "Lead";
  }
}


// ─── SHEET INTAKE — THE ONE PLACE THE STORE IS CHOSEN FOR AN IMPORT (F43, §7.3(c)) ─────────────
//
// F43: *"the store is chosen in exactly one place … Only the canonical reader asks. Everyone else
// inherits the answer."* An earlier draft of this slice branched in the ROUTE and F43 caught it —
// correctly. The route now calls this and inherits the answer, exactly like every other consumer.
//
//   postgres   core/intake — verbatim evidence on the event spine (§1.3), §2.1's five identity
//              outcomes, and the projection through the canonical Postgres writer. The deployed
//              configuration, and the one §7.3(c) decided.
//   vault      the markdown path, unchanged, in ./sheet-import.
//
// MEASURED WHILE BUILDING THIS, and worth stating because it was the real gap: `createProspect`
// above has NO postgres branch — only `listProspects` and `getProspect` do. So before this slice a
// CSV import wrote markdown that the DEPLOYED reader never read. The postgres arm closes that.

export type SheetIntakeInput = {
  csv: string;
  columnMap: SheetColumnMap;
  label?: string;
  sourceName?: string;
  overwrite?: boolean;
  organizationId: OrganizationId;
  createdBy?: UserId | null;
};

export type SheetIntakeResult =
  | { store: "postgres"; result: ImportResult }
  | { store: "vault"; created: { slug: string; name: string; written: boolean; reason?: string }[] };

export async function importProspectSheet(
  rows: readonly Record<string, string>[],
  input: SheetIntakeInput
): Promise<SheetIntakeResult> {
  if (resolveProspectSource() === "postgres") {
    const result = await withProspectDb((tx) =>
      importSheet(tx, input.organizationId, {
        csv: input.csv,
        label: input.label ?? "CSV import",
        sourceKind: "csv_paste",
        sourceName: input.sourceName ?? "paste",
        columnMap: input.columnMap,
        createdBy: input.createdBy ?? null,
      })
    );
    return { store: "postgres", result };
  }

  // ─── THE VAULT PATH, UNCHANGED ────────────────────────────────────────────────────────────────
  //
  // ACTOR: "system", EXPLICITLY (D-3). One operator action produces N events, and
  // COGNITION-OBSERVATION §19 measures operator-caused events per weekday against a pre-registered
  // threshold — inheriting core/events' "operator" default would let a single paste manufacture
  // hundreds of them, permanently, since the log is append-only.
  const created: { slug: string; name: string; written: boolean; reason?: string }[] = [];
  for (const row of rows) {
    const name = row[input.columnMap.name]?.trim();
    if (!name) {
      created.push({ slug: "", name: "(blank)", written: false, reason: "missing name" });
      continue;
    }
    const slug = slugify(name);
    const md = buildMarkdown(row, input.columnMap);
    const result = await createProspect(slug, md, { overwrite: input.overwrite, actor: "system" });
    created.push({
      slug, name, written: result.written,
      reason: result.existed ? (result.written ? "overwritten" : "exists (overwrite=false)") : "created",
    });
  }
  return { store: "vault", created };
}
