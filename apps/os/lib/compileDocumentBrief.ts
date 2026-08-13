import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { crmDir } from "./paths";
import type { DocumentRecord } from "./documents";
import { TYPE_LABEL } from "./documents";

async function readFmAndBody(p: string): Promise<{ fm: Record<string, unknown>; body: string } | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = matter(raw);
    return { fm: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
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

async function clientContextSnippet(clientSlug: string): Promise<string> {
  const business = await readFmAndBody(path.join(crmDir(), clientSlug, "business_context.md"));
  const brand = await readFmAndBody(path.join(crmDir(), clientSlug, "brand_identity.md"));
  if (!business && !brand) return "_(no client context found)_";
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
  return lines.join("\n");
}

const DIRECTIVE_BY_TYPE: Record<DocumentRecord["meta"]["type"], string> = {
  proposal: `Review this proposal. Identify (a) anything ambiguous from the client's perspective, (b) missing scope guardrails that could become scope-creep risk, and (c) 2-3 specific phrase-level improvements to match the client's brand voice. Then suggest a v2 outline.`,
  contract: `Review this contract for the small-agency context. Flag any clauses that are missing or weak around: payment milestones, scope changes, ownership of work, termination terms, indemnification. Suggest specific edits — quote the original and propose the new wording.`,
  sow: `Review this SOW. Check that the scope is specific enough to be unambiguous, that "out of scope" is explicit enough to prevent disputes, and that assumptions are stated clearly. Suggest 3 concrete improvements.`,
  change_order: `Review this change order. Verify the original scope is referenced, the change is clearly described, the cost adjustment is justified, and the new timeline is realistic. Suggest a clear client-facing summary email to send alongside it.`,
};

export async function compileDocumentBrief(doc: DocumentRecord): Promise<string> {
  const context = await clientContextSnippet(doc.meta.client);
  const directive = DIRECTIVE_BY_TYPE[doc.meta.type];

  const parts = [
    `# ${TYPE_LABEL[doc.meta.type]} · ${doc.meta.title}`,
    "",
    `_Compiled by Ascend OS for AI-assisted document work. Paste at the top of a new Claude conversation, then ask the question at the bottom._`,
    "",
    `## Document metadata`,
    `- **Type:** ${TYPE_LABEL[doc.meta.type]}`,
    `- **Client:** ${doc.meta.client}`,
    `- **Version:** v${doc.meta.version}`,
    `- **Status:** ${doc.meta.status}`,
    doc.meta.amount_usd !== undefined ? `- **Amount:** $${doc.meta.amount_usd.toLocaleString()}` : "",
    `- **Created:** ${doc.meta.created_at.slice(0, 10)}`,
    doc.meta.sent_at ? `- **Sent:** ${doc.meta.sent_at.slice(0, 10)}` : "",
    doc.meta.accepted_at ? `- **Accepted:** ${doc.meta.accepted_at.slice(0, 10)}` : "",
    "",
    `## Document body`,
    "",
    doc.body,
    "",
    `## Client context`,
    "",
    context,
    "",
    `## What I want from you`,
    directive,
    "",
    `<!-- Compiled by Ascend OS · document: ${doc.meta.doc_id} v${doc.meta.version} · ${new Date().toISOString()} -->`,
    "",
  ]
    .filter((s) => s !== "")
    .join("\n");

  return parts;
}
