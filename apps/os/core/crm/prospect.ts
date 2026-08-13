// core/crm/prospect.ts — Prospect reads + scoring wiring (moved from lib/sales.ts, Phase 2.1).

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { listMarkdownFiles, readMarkdownFile } from "@/core/vault/markdown";
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
