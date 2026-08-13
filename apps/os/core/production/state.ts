// core/production/state.ts — Project / Phase reads (moved from lib/production.ts, Phase 2.3).
// Vault I/O via core/vault primitives only. Phase vocabulary + ChecklistItem come from domain.

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { listSubdirs } from "@/core/vault/io";
import { readMarkdownFile } from "@/core/vault/markdown";
import { PHASE_KEYS, PHASE_LABEL, type ChecklistItem, type PhaseKey, type PhaseStatus } from "@/domain";

type PhaseMeta = { status?: PhaseStatus; started?: string; completed?: string };

type ProductionFrontmatter = {
  industry_template?: string;
  launch_target?: string;
  phases?: Partial<Record<PhaseKey, PhaseMeta>>;
};

export type Phase = {
  key: PhaseKey;
  label: string;
  status: PhaseStatus;
  started?: string;
  completed?: string;
  checklist: ChecklistItem[];
  /** 0–100, computed */
  progress: number;
};

export type ProductionState = {
  clientSlug: string;
  clientName: string;
  industryTemplate?: string;
  launchTarget?: string;
  phases: Phase[];
  /** 0–100, mean of phase progress */
  overallProgress: number;
  /** index into PHASE_KEYS — first non-complete-or-skipped phase, or null if all done */
  activePhaseIndex: number | null;
  rawBody: string;
};

const PRODUCTION_FILE = "production_state.md";
const BUSINESS_FILE = "business_context.md";

const PHASE_HEADING_RX = /^##\s+Phase:\s+(.+?)\s*$/im;
const TASK_RX = /^\s*-\s*\[(x|X|\s)\]\s+(.+?)\s*$/;

function parseChecklists(body: string): Record<PhaseKey, ChecklistItem[]> {
  const empty: Record<PhaseKey, ChecklistItem[]> = {
    onboarding: [],
    strategy: [],
    design: [],
    dev: [],
    launch: [],
  };

  const lines = body.split(/\r?\n/);
  let current: PhaseKey | null = null;

  for (const line of lines) {
    const heading = line.match(PHASE_HEADING_RX);
    if (heading) {
      const norm = heading[1].toLowerCase().trim();
      current = (PHASE_KEYS.find((k) => norm.startsWith(k)) as PhaseKey | undefined) ?? null;
      continue;
    }
    if (/^##\s+/.test(line) && !PHASE_HEADING_RX.test(line)) {
      current = null;
      continue;
    }
    if (current) {
      const m = line.match(TASK_RX);
      if (m) empty[current].push({ text: m[2].trim(), done: m[1].toLowerCase() === "x" });
    }
  }

  return empty;
}

function computePhaseProgress(status: PhaseStatus, checklist: ChecklistItem[]): number {
  if (status === "complete" || status === "skipped") return 100;
  if (status === "not_started") return 0;
  if (checklist.length === 0) return 50; // in_progress, unknown granularity
  const done = checklist.filter((c) => c.done).length;
  return Math.round((done / checklist.length) * 100);
}

async function readBusinessName(clientDir: string, slug: string): Promise<string> {
  const md = await readMarkdownFile(path.join(clientDir, BUSINESS_FILE));
  return (md.frontmatter.name as string | undefined) ?? (md.frontmatter.business as string | undefined) ?? slug;
}

async function parseProductionFile(clientDir: string, slug: string): Promise<ProductionState | null> {
  const md = await readMarkdownFile(path.join(clientDir, PRODUCTION_FILE));
  if (md.missing) return null;

  const fm = md.frontmatter as ProductionFrontmatter;
  const body = md.body;
  const checklists = parseChecklists(body);
  const clientName = await readBusinessName(clientDir, slug);

  const phases: Phase[] = PHASE_KEYS.map((key) => {
    const meta = fm.phases?.[key] ?? {};
    const status: PhaseStatus = meta.status ?? "not_started";
    const checklist = checklists[key];
    return { key, label: PHASE_LABEL[key], status, started: meta.started, completed: meta.completed, checklist, progress: computePhaseProgress(status, checklist) };
  });

  const overallProgress = Math.round(phases.reduce((sum, p) => sum + p.progress, 0) / phases.length);

  let activePhaseIndex: number | null = phases.findIndex((p) => p.status !== "complete" && p.status !== "skipped");
  if (activePhaseIndex === -1) activePhaseIndex = null;

  return {
    clientSlug: slug,
    clientName,
    industryTemplate: fm.industry_template,
    launchTarget: fm.launch_target,
    phases,
    overallProgress,
    activePhaseIndex,
    rawBody: body,
  };
}

/**
 * DS-9 (Phase 7) — the ONLY additive extension to frozen core/production: expose the existing private
 * checklist parser for reuse, so the SOP Engine can parse a canonical production-TEMPLATE body with the
 * SAME parser that parses a project's production_state.md. Pure delegation — it introduces no second
 * parser and changes no existing behavior.
 */
export function parseProductionMarkdown(body: string): Record<PhaseKey, ChecklistItem[]> {
  return parseChecklists(body);
}

export async function listProductionStates(): Promise<ProductionState[]> {
  const dir = crmDir();
  const slugs = await listSubdirs(dir);
  const results = await Promise.all(slugs.map((slug) => parseProductionFile(path.join(dir, slug), slug)));
  const states = results.filter((s): s is ProductionState => s !== null);

  return states.sort((a, b) => {
    const aActive = a.activePhaseIndex !== null ? 0 : 1;
    const bActive = b.activePhaseIndex !== null ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aTarget = a.launchTarget ?? "9999-99-99";
    const bTarget = b.launchTarget ?? "9999-99-99";
    if (aTarget !== bTarget) return aTarget.localeCompare(bTarget);
    return a.clientName.localeCompare(b.clientName);
  });
}

export async function getProductionState(slug: string): Promise<ProductionState | null> {
  if (!(await listSubdirs(crmDir())).includes(slug)) return null;
  return parseProductionFile(path.join(crmDir(), slug), slug);
}
