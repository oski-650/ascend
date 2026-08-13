// core/production/templates — read-only reader for canonical production TEMPLATES (Phase 7, DS-4/DS-9).
//
// Scoped to the existing `03 - SOP Library/production-templates/<industry>.md` source (the same files
// createProject seeds from). It reuses the frozen production-state parser via `parseProductionMarkdown`
// (DS-9) — NO second parser, NO writes, NO events. Missing template ⇒ null (graceful, no fabrication).

import "server-only";
import path from "node:path";
import { sopDir } from "@/core/vault/paths";
import { readMarkdownFile } from "@/core/vault/markdown";
import { parseProductionMarkdown } from "./state";
import type { PhaseKey, ChecklistItem } from "@/domain";

export type ProductionTemplate = {
  industryTemplate: string;
  steps: Record<PhaseKey, ChecklistItem[]>;
};

/** Parse the canonical template for an industry, or null if no such template file exists. Read-only. */
export async function getProductionTemplate(industry: string): Promise<ProductionTemplate | null> {
  if (!industry) return null;
  const md = await readMarkdownFile(path.join(sopDir(), "production-templates", `${industry}.md`));
  if (md.missing) return null;
  return { industryTemplate: industry, steps: parseProductionMarkdown(md.body) };
}
