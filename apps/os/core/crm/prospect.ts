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
import type { Actor, ProspectFrontmatter, ProspectId, ProspectStatus, WebsiteQuality } from "@/domain";

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

export async function listProspects(): Promise<Prospect[]> {
  const dir = hitListDir();
  const files = await listMarkdownFiles(dir);
  const prospects = await Promise.all(
    files.map(async (f) => toProspect(f.replace(/\.md$/, ""), await readMarkdownFile(path.join(dir, f))))
  );

  // Sort: score desc, then closed-lost to the bottom regardless of score.
  return prospects.sort((a, b) => {
    const aDead = a.frontmatter.status === "closed-lost" ? 1 : 0;
    const bDead = b.frontmatter.status === "closed-lost" ? 1 : 0;
    if (aDead !== bDead) return aDead - bDead;
    return b.score.score - a.score.score;
  });
}

export async function getProspect(slug: string): Promise<Prospect | null> {
  const md = await readMarkdownFile(path.join(hitListDir(), `${slug}.md`));
  if (md.missing) return null;
  return toProspect(slug, md);
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
