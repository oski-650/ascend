import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { automationsDir, automationsFiredPath, crmDir, appDataDir } from "./paths";
import { listInvoices } from "./finance";
import { listProductionStates, PHASE_KEYS, type PhaseKey } from "./production";
import { listProspects, type PipelineStatus } from "./sales";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TriggerType =
  | "invoice.paid"
  | "production.phase_completed"
  | "production.launch_buffer_in"
  | "prospect.status_is";

export type InvoiceMatch = {
  label_contains?: string;
  label_equals?: string;
  client?: string;
  amount_gte?: number;
  amount_lte?: number;
};

export type PhaseMatch = { phase?: PhaseKey; client?: string };

export type LaunchBufferMatch = { min_days: number; max_days: number };

export type ProspectStatusMatch = { status: PipelineStatus | PipelineStatus[]; score_gte?: number };

export type Trigger =
  | { type: "invoice.paid"; match?: InvoiceMatch }
  | { type: "production.phase_completed"; match?: PhaseMatch }
  | { type: "production.launch_buffer_in"; match: LaunchBufferMatch }
  | { type: "prospect.status_is"; match: ProspectStatusMatch };

export type AutomationRule = {
  id: string;
  name: string;
  description?: string;
  trigger: Trigger;
  clipboard_label: string;
  templateBody: string;
  sourcePath: string;
};

export type TriggerContext = Record<string, string | number>;

export type RenderedFiring = {
  firing_id: string;
  rule: AutomationRule;
  context: TriggerContext;
  payload: string; // rendered template, ready to copy
  targetSummary: string;
};

export type FiredEntry = {
  firing_id: string;
  rule_id: string;
  fired_at: string;
  context: TriggerContext;
};

// ─── Rule loader ────────────────────────────────────────────────────────────

export async function loadRules(): Promise<AutomationRule[]> {
  const dir = automationsDir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const rules: AutomationRule[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    try {
      const raw = await fs.readFile(full, "utf8");
      const parsed = matter(raw);
      const fm = parsed.data as Record<string, unknown>;
      const id = fm.id as string | undefined;
      const name = fm.name as string | undefined;
      const trigger = fm.trigger as Trigger | undefined;
      if (!id || !name || !trigger || typeof trigger !== "object") continue;
      rules.push({
        id,
        name,
        description: fm.description as string | undefined,
        trigger,
        clipboard_label: (fm.clipboard_label as string | undefined) ?? "Copy automation payload",
        templateBody: parsed.content.trim(),
        sourcePath: full,
      });
    } catch {
      // skip malformed rule files
    }
  }
  return rules;
}

// ─── Fired log ──────────────────────────────────────────────────────────────

async function ensureFiredFile(): Promise<void> {
  await fs.mkdir(appDataDir(), { recursive: true });
  try {
    await fs.access(automationsFiredPath());
  } catch {
    await fs.writeFile(automationsFiredPath(), "", "utf8");
  }
}

export async function getFiredEntries(): Promise<FiredEntry[]> {
  await ensureFiredFile();
  const raw = await fs.readFile(automationsFiredPath(), "utf8");
  if (!raw.trim()) return [];
  const out: FiredEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as FiredEntry);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function appendFired(entry: FiredEntry): Promise<void> {
  await ensureFiredFile();
  await fs.appendFile(automationsFiredPath(), JSON.stringify(entry) + "\n", "utf8");
}

export async function dismissFiring(firingId: string, ruleId: string, context: TriggerContext): Promise<FiredEntry> {
  // Idempotent — if already fired, no-op return
  const fired = await getFiredEntries();
  const existing = fired.find((f) => f.firing_id === firingId);
  if (existing) return existing;
  const entry: FiredEntry = {
    firing_id: firingId,
    rule_id: ruleId,
    fired_at: new Date().toISOString(),
    context,
  };
  await appendFired(entry);
  return entry;
}

// ─── Template rendering ─────────────────────────────────────────────────────

const VAR_RX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderTemplate(template: string, ctx: TriggerContext): string {
  return template.replace(VAR_RX, (_, key) => {
    if (key in ctx) return String(ctx[key]);
    return `{{${key}}}`; // leave unresolved vars in place so they're visible
  });
}

// ─── Trigger evaluators ─────────────────────────────────────────────────────

async function clientNameCache(): Promise<Map<string, string>> {
  const dir = crmDir();
  const out = new Map<string, string>();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, e.name, "business_context.md"), "utf8");
      const fm = matter(raw).data as Record<string, unknown>;
      const name = (fm.name as string | undefined) ?? (fm.business as string | undefined) ?? e.name;
      out.set(e.name, name);
    } catch {
      out.set(e.name, e.name);
    }
  }
  return out;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

type Candidate = { target_id: string; context: TriggerContext; targetSummary: string };

async function evaluateInvoicePaid(match: InvoiceMatch | undefined, names: Map<string, string>): Promise<Candidate[]> {
  const invoices = await listInvoices();
  const out: Candidate[] = [];
  for (const inv of invoices) {
    if (!inv.paid_at) continue;
    if (match?.label_contains && !inv.label.toLowerCase().includes(match.label_contains.toLowerCase())) continue;
    if (match?.label_equals && inv.label !== match.label_equals) continue;
    if (match?.client && inv.client !== match.client) continue;
    if (match?.amount_gte !== undefined && inv.amount_usd < match.amount_gte) continue;
    if (match?.amount_lte !== undefined && inv.amount_usd > match.amount_lte) continue;
    const clientName = names.get(inv.client) ?? inv.client;
    out.push({
      target_id: inv.id,
      targetSummary: `${clientName} · ${inv.label}`,
      context: {
        client_slug: inv.client,
        client_name: clientName,
        label: inv.label,
        amount: fmtUsd(inv.amount_usd),
        paid_date: inv.paid_at.slice(0, 10),
        due_date: inv.due_at.slice(0, 10),
      },
    });
  }
  return out;
}

async function evaluatePhaseCompleted(match: PhaseMatch | undefined): Promise<Candidate[]> {
  const states = await listProductionStates();
  const out: Candidate[] = [];
  for (const s of states) {
    for (const p of s.phases) {
      if (p.status !== "complete") continue;
      if (match?.phase && p.key !== match.phase) continue;
      if (match?.client && s.clientSlug !== match.client) continue;
      out.push({
        target_id: `${s.clientSlug}:${p.key}`,
        targetSummary: `${s.clientName} · ${p.label}`,
        context: {
          client_slug: s.clientSlug,
          client_name: s.clientName,
          phase_key: p.key,
          phase_label: p.label,
          overall_progress: s.overallProgress,
        },
      });
    }
  }
  return out;
}

async function evaluateLaunchBuffer(match: LaunchBufferMatch): Promise<Candidate[]> {
  const states = await listProductionStates();
  const out: Candidate[] = [];
  const now = Date.now();
  for (const s of states) {
    if (s.activePhaseIndex === null) continue;
    if (!s.launchTarget) continue;
    const target = new Date(s.launchTarget);
    if (isNaN(target.getTime())) continue;
    const days = Math.floor((target.getTime() - now) / 86400_000);
    if (days < match.min_days || days > match.max_days) continue;
    out.push({
      target_id: s.clientSlug,
      targetSummary: `${s.clientName} · launches in ${days}d`,
      context: {
        client_slug: s.clientSlug,
        client_name: s.clientName,
        days_to_launch: days,
        launch_target: s.launchTarget,
        overall_progress: s.overallProgress,
      },
    });
  }
  return out;
}

async function evaluateProspectStatus(match: ProspectStatusMatch): Promise<Candidate[]> {
  const prospects = await listProspects();
  const statuses = Array.isArray(match.status) ? match.status : [match.status];
  const out: Candidate[] = [];
  for (const p of prospects) {
    const s = (p.frontmatter.status ?? "lead") as PipelineStatus;
    if (!statuses.includes(s)) continue;
    if (match.score_gte !== undefined && p.score.score < match.score_gte) continue;
    const name = p.frontmatter.name ?? p.slug;
    out.push({
      target_id: p.slug,
      targetSummary: `${name} · score ${p.score.score} · ${s}`,
      context: {
        prospect_slug: p.slug,
        prospect_name: String(name),
        status: s,
        score: p.score.score,
        tier: p.score.tier,
        business_type: String(p.frontmatter.business_type ?? "small business"),
        location: String(p.frontmatter.location ?? ""),
      },
    });
  }
  return out;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

async function evaluateRule(rule: AutomationRule, names: Map<string, string>): Promise<Candidate[]> {
  switch (rule.trigger.type) {
    case "invoice.paid":
      return evaluateInvoicePaid(rule.trigger.match, names);
    case "production.phase_completed":
      return evaluatePhaseCompleted(rule.trigger.match);
    case "production.launch_buffer_in":
      return evaluateLaunchBuffer(rule.trigger.match);
    case "prospect.status_is":
      return evaluateProspectStatus(rule.trigger.match);
  }
}

export async function detectFirings(): Promise<{ pending: RenderedFiring[]; fired: FiredEntry[]; rules: AutomationRule[] }> {
  const [rules, firedEntries, names] = await Promise.all([loadRules(), getFiredEntries(), clientNameCache()]);
  const firedIds = new Set(firedEntries.map((f) => f.firing_id));

  const pending: RenderedFiring[] = [];
  for (const rule of rules) {
    let candidates: Candidate[] = [];
    try {
      candidates = await evaluateRule(rule, names);
    } catch {
      continue;
    }
    for (const c of candidates) {
      const firingId = `${rule.id}::${c.target_id}`;
      if (firedIds.has(firingId)) continue;
      pending.push({
        firing_id: firingId,
        rule,
        context: c.context,
        payload: renderTemplate(rule.templateBody, c.context),
        targetSummary: c.targetSummary,
      });
    }
  }

  return { pending, fired: firedEntries, rules };
}

export function isValidPhaseKey(k: unknown): k is PhaseKey {
  return typeof k === "string" && (PHASE_KEYS as readonly string[]).includes(k);
}
