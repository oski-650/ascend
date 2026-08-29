import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { crmDir } from "./paths";
import { getProspect } from "@/core/crm";
import type { Opportunity } from "./opportunities";

async function readMarkdownFm(filePath: string): Promise<{ fm: Record<string, unknown>; body: string } | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    return { fm: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
  } catch {
    return null;
  }
}

/** The identity anchor is JSON, not frontmatter — read it with its own parser, not `matter`. */
async function readJsonFm(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function clientSnippet(slug: string): Promise<string> {
  const business = await readMarkdownFm(path.join(crmDir(), slug, "business_context.md"));
  const brand = await readMarkdownFm(path.join(crmDir(), slug, "brand_identity.md"));
  const scope = await readMarkdownFm(path.join(crmDir(), slug, "project_scope.md"));
  const lines: string[] = [];
  if (business) {
    lines.push(`### Business`);
    lines.push(`- **Industry:** ${fmtVal(business.fm.industry)}`);
    lines.push(`- **Location:** ${fmtVal(business.fm.location)}`);
    lines.push(`- **Languages:** ${fmtVal(business.fm.languages)}`);
    if (business.body) lines.push("", business.body);
  }
  if (brand) {
    lines.push("", `### Brand`);
    lines.push(`- **Voice:** ${fmtVal(brand.fm.voice)}`);
    if (brand.body) lines.push("", brand.body);
  }
  // AUTHORITY (docs/SOURCE-AUTHORITY.md §4). Phase, status, tier and launch date are read from
  // their authoritative sources, never from project_scope.md's parallel copies. This matters more
  // here than anywhere else: whatever this function emits becomes a fact inside a model's context,
  // where no type system can catch a stale or fabricated value.
  const meta = await readJsonFm(path.join(crmDir(), slug, "structural_meta.json"));
  const production = await readMarkdownFm(path.join(crmDir(), slug, "production_state.md"));
  if (meta || production || scope) {
    lines.push("", `### Scope`);
    if (meta) {
      lines.push(`- **Status:** ${fmtVal(meta.status)} · **Tier:** ${fmtVal(meta.tier)}`);
    }
    if (production) {
      const target = production.fm.launch_target;
      lines.push(
        `- **Launch target:** ${target && String(target).trim() ? fmtVal(target) : "unknown"}`
      );
    }
    if (scope) {
      // Scope-only content. `phase`/`status`/`package`/`launch_target` are deliberately NOT read.
      lines.push(`- **Deliverables:** ${fmtVal(scope.fm.deliverables)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Prospect context for an opportunity brief — through the CANONICAL READER.
 *
 * This opened `hitListDir()` and ran its own `gray-matter` parse, which made it the ELEVENTH
 * prospect consumer and the second one bypassing `core/crm`. F43 caught it on the rule's first run,
 * after `core/knowledge` had already been found by hand — which is the argument for the rule
 * existing rather than for a more careful inventory.
 *
 * Same defect, same consequence: after a source-of-truth flip it would have kept building AI context
 * from Obsidian while every other consumer read Postgres.
 */
async function prospectSnippet(slug: string): Promise<string> {
  const prospect = await getProspect(slug);
  if (!prospect) return "";
  const fm = prospect.frontmatter;
  const lines = [
    `### Prospect`,
    `- **Business type:** ${fmtVal(fm.business_type)}`,
    `- **Location:** ${fmtVal(fm.location)}`,
    `- **Website:** ${fmtVal(fm.website)} (${fmtVal(fm.website_quality)})`,
    `- **Decision-maker access:** ${fmtVal(fm.decision_maker_access)}`,
    `- **Urgency:** ${fmtVal(fm.project_urgency)}`,
    `- **Niche alignment:** ${fmtVal(fm.niche_alignment)}`,
    `- **Contact:** ${fmtVal(fm.contact_name)} · ${fmtVal(fm.contact_phone)} · ${fmtVal(fm.contact_email)}`,
  ];
  if (prospect.body) lines.push("", "### Call log & notes", "", prospect.body);
  return lines.join("\n");
}

export async function compileOpportunityBrief(opp: Opportunity): Promise<string> {
  let context = "_(no target context — internal opportunity)_";
  if (opp.target?.kind === "client") {
    context = (await clientSnippet(opp.target.slug)) || context;
  } else if (opp.target?.kind === "prospect") {
    context = (await prospectSnippet(opp.target.slug)) || context;
  }

  const parts = [
    `# Opportunity: ${opp.title}`,
    "",
    `_Compiled by Ascend OS · ${opp.severity.toUpperCase()} · paste at the top of a new Claude conversation._`,
    "",
    `## Why this matters`,
    opp.rationale,
    "",
    `## Suggested action (internal)`,
    opp.action,
    "",
    opp.target ? `## Target context: ${opp.target.name}` : `## Context`,
    "",
    context,
    "",
    `## What I want from you`,
    opp.claudeDirective,
    "",
    `<!-- Compiled by Ascend OS · opportunity: ${opp.id} · ${new Date().toISOString()} -->`,
    "",
  ];
  return parts.join("\n");
}
