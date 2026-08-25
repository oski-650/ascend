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
  /** 0–100, computed — null when the status is `unknown` (no honest number exists) */
  progress: number | null;
};

/**
 * The project's position, stated so that uncertainty cannot be mistaken for completion.
 *
 * The AUTHORITATIVE interpretation of `phases[]` — one definition site, per F24's rule that no
 * surface may hand-roll a membership test the domain already owns. `/production`, `/crm` and
 * compileOperatorBrief consume this instead of inferring from `activePhaseIndex === null`, which
 * cannot distinguish "launched" from "cannot determine" (H4 §2).
 */
export type ProjectPhaseState = "in_flight" | "launched" | "indeterminate";

export type ProductionState = {
  clientSlug: string;
  clientName: string;
  industryTemplate?: string;
  launchTarget?: string;
  phases: Phase[];
  /** 0–100, mean of phase progress — null when ANY phase progress is null */
  overallProgress: number | null;
  /**
   * Index into PHASE_KEYS of the active phase, or null.
   *
   * A number appears ONLY when evidence identifies the phase. `null` is deliberately overloaded —
   * "no active phase" OR "cannot be determined" — and consumers needing the distinction read
   * `phaseState`, never this field (H3.1 §3).
   */
  activePhaseIndex: number | null;
  /** The authoritative launched / in-flight / indeterminate answer. */
  phaseState: ProjectPhaseState;
  rawBody: string;
};

/** Terminal = the phase is resolved and will not advance further. `unknown` is NOT terminal. */
function isTerminal(status: PhaseStatus): boolean {
  return status === "complete" || status === "skipped";
}

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

function computePhaseProgress(status: PhaseStatus, checklist: ChecklistItem[]): number | null {
  // No honest number exists for `unknown`: 0 asserts nothing was done, 100 asserts everything was,
  // 50 fabricates a midpoint from no evidence. Progress is not a quantity here — it is undefined.
  if (status === "unknown") return null;
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
    // DEFAULT-AS-ASSERTION — REMOVED. This was `?? "not_started"`, which converted an absent field
    // into a positive claim that the phase had not begun. Silence is now `unknown` (H4 §4).
    const status: PhaseStatus = meta.status ?? "unknown";
    const checklist = checklists[key];
    return { key, label: PHASE_LABEL[key], status, started: meta.started, completed: meta.completed, checklist, progress: computePhaseProgress(status, checklist) };
  });

  // A mean with a missing term is missing. NOT renormalised over the phases that happen to be
  // known — averaging those silently redefines the metric from "how much of this project is done"
  // to "how much of the part we know about is done", which reports a project whose history is
  // entirely unknown but whose launch is complete as 100% delivered (H2 §4, rejected option C).
  const overallProgress = phases.some((p) => p.progress === null)
    ? null
    : Math.round(phases.reduce((sum, p) => sum + (p.progress as number), 0) / phases.length);

  // The active phase is the first non-terminal one — but only claimable when its status is KNOWN.
  // Otherwise the index would assert "this is what the operator is working on right now" about a
  // phase nobody knows the state of (H4 §2.1).
  const firstNonTerminal = phases.findIndex((p) => !isTerminal(p.status));
  const activePhaseIndex =
    firstNonTerminal === -1 || phases[firstNonTerminal].status === "unknown" ? null : firstNonTerminal;

  const phaseState: ProjectPhaseState = phases.some((p) => p.status === "unknown")
    ? "indeterminate"
    : phases.every((p) => isTerminal(p.status))
      ? "launched"
      : "in_flight";

  return {
    clientSlug: slug,
    clientName,
    industryTemplate: fm.industry_template,
    launchTarget: fm.launch_target,
    phases,
    overallProgress,
    activePhaseIndex,
    phaseState,
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
