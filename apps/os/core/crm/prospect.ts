// core/crm/prospect.ts — Prospect reads + scoring wiring (moved from lib/sales.ts, Phase 2.1).

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { listMarkdownFiles, readMarkdownFile, readTextFile, writeFileAtomic } from "@/core/vault/markdown";
import { emitEvent } from "@/core/events";
import { computeScore, type ScoreResult } from "./scoring";
import type { ProspectFrontmatter, ProspectStatus, WebsiteQuality } from "@/domain";

// Prospect vocabulary is owned by domain — re-exported so the lib/sales shim's surface is preserved.
export type PipelineStatus = ProspectStatus;
export type { ProspectFrontmatter, WebsiteQuality };

export type Prospect = {
  slug: string;
  frontmatter: ProspectFrontmatter;
  body: string;
  score: ScoreResult;
};

function toProspect(slug: string, md: { frontmatter: Record<string, unknown>; body: string }): Prospect {
  const frontmatter = md.frontmatter as ProspectFrontmatter;
  return { slug, frontmatter, body: md.body, score: computeScore(frontmatter) };
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
  /** True when the file was written (false only for a refused overwrite). */
  written: boolean;
};

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
 */
export async function createProspect(
  slug: string,
  markdown: string,
  options: { overwrite?: boolean } = {}
): Promise<CreateProspectResult> {
  const filePath = path.join(hitListDir(), `${slug}.md`);
  const existed = (await readTextFile(filePath)) !== null;

  if (existed && !options.overwrite) return { slug, existed, written: false };

  await writeFileAtomic(filePath, markdown);

  if (!existed) {
    await emitEvent({
      type: "prospect.created",
      subject: { entity: "prospect", entity_id: slug },
    });
  }

  return { slug, existed, written: true };
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
