// lib/opportunities.ts — COMPOSER (Phase 2.6, transitional; NOT a pure shim).
//
// The 2 revenue rules (launched_no_retainer, launched_checkin) were MOVED to
// engines/opportunity-engine (deleted here — single owner). The 7 risk/sales rules below
// remain their SINGLE current implementation until a Health/risk-signals engine and a
// Sales-signals engine exist — then DELETE them here (never duplicate). No NEW rules here.
// See the plan register: "Phase 2.6 — Opportunity Engine + composer (transitional)".

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { crmDir } from "./paths";
import { listProductionStates, type ProductionState } from "./production";
import { listProspects, type Prospect } from "./sales";
import { secondsInWindow, summarizeByClient } from "./timeLog";
import { getClientRevenue, computeEhr } from "./ehr";
import {
  detectRevenueOpportunities,
  severityLabel,
  type Opportunity,
  type OpportunityKind,
  type Severity,
} from "@/engines/opportunity-engine";

// Preserve the legacy public surface for existing consumers (signals page, operator briefs).
export { severityLabel };
export type { Opportunity, OpportunityKind, Severity };

type ClientStatus = {
  slug: string;
  name: string;
  status?: string;
  contact_email?: string;
  business_type?: string;
  launchedAtISO?: string;
};

async function readActiveClients(): Promise<ClientStatus[]> {
  const dir = crmDir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const folders = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")
  );

  const out: ClientStatus[] = [];
  for (const f of folders) {
    const slug = f.name;
    const businessPath = path.join(dir, slug, "business_context.md");
    const scopePath = path.join(dir, slug, "project_scope.md");
    let name = slug;
    let business_type: string | undefined;
    let contact_email: string | undefined;
    let status: string | undefined;
    let launchedAtISO: string | undefined;
    try {
      const raw = await fs.readFile(businessPath, "utf8");
      const fm = matter(raw).data as Record<string, unknown>;
      name = (fm.name as string | undefined) ?? (fm.business as string | undefined) ?? slug;
      business_type = (fm.industry as string | undefined) ?? (fm.business_type as string | undefined);
      contact_email = fm.contact_email as string | undefined;
    } catch {
      /* skip */
    }
    try {
      const raw = await fs.readFile(scopePath, "utf8");
      const fm = matter(raw).data as Record<string, unknown>;
      status = (fm.status as string | undefined)?.toLowerCase();
      launchedAtISO = fm.launch_target as string | undefined;
    } catch {
      /* skip */
    }
    out.push({ slug, name, status, contact_email, business_type, launchedAtISO });
  }
  return out;
}

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400_000);
}

// ─── Retained RISK rules (single implementation → future Health/risk-signals) ─

function ruleProductionMissing(clients: ClientStatus[], states: ProductionState[]): Opportunity[] {
  const tracked = new Set(states.map((s) => s.clientSlug));
  return clients
    .filter((c) => !tracked.has(c.slug) && c.status !== "maintenance" && c.status !== "archived")
    .map((c) => ({
      id: `production_missing:${c.slug}`,
      kind: "production_missing" as const,
      severity: "info" as const,
      title: `Start production tracking for ${c.name}`,
      rationale: `${c.name} is an active client but has no production_state.md yet. Without it, no phase tracking, no EHR data, no health score.`,
      action: `Copy an industry template from 03 - SOP Library/production-templates/ into 01 - CRM & Clients/${c.slug}/production_state.md.`,
      claudeDirective: `Internal: outline the project phases I should set up for ${c.name} (a ${c.business_type ?? "small business"} site build). 5-phase plan with realistic checklist items per phase.`,
      target: { kind: "client" as const, slug: c.slug, name: c.name },
    }));
}

function ruleLaunchCrunch(states: ProductionState[]): Opportunity[] {
  return states
    .map((s): Opportunity | null => {
      if (!s.launchTarget) return null;
      const d = new Date(s.launchTarget);
      if (isNaN(d.getTime())) return null;
      const days = Math.floor((d.getTime() - Date.now()) / 86400_000);
      if (days >= 14) return null;
      // "Behind schedule" is a comparison against progress. With progress unknown there is no
      // comparison to make, so the rule cannot fire — suppression, not a softened severity.
      if (s.overallProgress === null || s.overallProgress >= 70) return null;
      if (s.activePhaseIndex === null) return null;
      return {
        id: `launch_crunch:${s.clientSlug}`,
        kind: "launch_crunch" as const,
        severity: "urgent" as const,
        title: `${s.clientName} crunch: ${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d to launch`}, only ${s.overallProgress}% done`,
        rationale: `Active phase is ${s.phases[s.activePhaseIndex].label}. At current pace, hitting ${s.launchTarget} requires either accelerating dev, descoping, or rebaselining with the client.`,
        action: `Decide today: accelerate, descope, or rebaseline. Don't let it drift another week.`,
        claudeDirective: `Internal strategy: I have ${days >= 0 ? `${days} days` : "negative buffer"} until ${s.clientName} launches, and I'm at ${s.overallProgress}%. Lay out three honest options — (A) what to descope to hit the date, (B) what dev to accelerate to keep scope, (C) how to propose a rebaselined launch date — with the tradeoffs for each.`,
        target: { kind: "client", slug: s.clientSlug, name: s.clientName },
      };
    })
    .filter((x): x is Opportunity => x !== null);
}

async function ruleStalledProject(states: ProductionState[]): Promise<Opportunity[]> {
  const out: Opportunity[] = [];
  for (const s of states) {
    if (s.activePhaseIndex === null) continue;
    const seconds = await secondsInWindow(14, s.clientSlug);
    if (seconds > 0) continue;
    // CLAIM CORRECTED, SEVERITY DEMOTED (H4 §4). This asserted "the project has been inactive for
    // 14 days" while knowing only "the OS recorded no activity for 14 days" — its own rationale
    // conceded the gap and it fired URGENT regardless. Absence of tracking is not evidence of
    // absence of work, and in this vault tracked time has never been a usable activity proxy.
    //
    // No replacement heuristic: corroborating against an independent quiet channel needs an
    // evidence-coverage primitive that does not exist, and inventing one to rescue this signal is
    // the failure mode the whole repair exists to prevent. It may not return to `urgent` without it.
    const progressStr = s.overallProgress !== null ? `${s.overallProgress}% complete` : "unknown progress";
    out.push({
      id: `stalled_project:${s.clientSlug}`,
      kind: "stalled_project",
      severity: "suggest",
      title: `No activity recorded for ${s.clientName} in 14 days`,
      rationale: `Active phase is ${s.phases[s.activePhaseIndex].label}, and Ascend has no time logged against it for two weeks. This is a statement about Ascend's records, not proof the project is stalled — work done off-the-clock looks identical.`,
      action: `Check which it is: if work happened, catch the log up; if it didn't, re-engage the client about what's blocking progress.`,
      claudeDirective: `Internal: Ascend has recorded no activity for ${s.clientName} in 14 days (${progressStr}, ${s.phases[s.activePhaseIndex].label} phase). The records cannot distinguish a stalled project from untracked work. Give me 3 likely reasons a small-agency project goes quiet here and a short script for re-engaging the client.`,
      target: { kind: "client", slug: s.clientSlug, name: s.clientName },
    });
  }
  return out;
}

async function ruleLowEhr(states: ProductionState[]): Promise<Opportunity[]> {
  const summaries = await summarizeByClient();
  const out: Opportunity[] = [];
  for (const s of states) {
    if (s.activePhaseIndex === null) continue;
    const totalSeconds = summaries[s.clientSlug]?.total_seconds ?? 0;
    if (totalSeconds < 3600 * 3) continue;
    const revenue = await getClientRevenue(s.clientSlug);
    const ehr = computeEhr(revenue, totalSeconds);
    if (ehr === null || ehr >= 100) continue;
    out.push({
      id: `low_ehr:${s.clientSlug}`,
      kind: "low_ehr",
      severity: "urgent",
      title: `${s.clientName} EHR is below $100/hr (currently $${ehr.toFixed(0)}/hr)`,
      rationale: `You've tracked ${(totalSeconds / 3600).toFixed(1)}h on this project for $${revenue?.toFixed(0)} revenue. At this rate the project is barely profitable.`,
      action: `Internal review: is the scope right? Was the package priced correctly? Are there change-orderable items being absorbed?`,
      claudeDirective: `Internal: my Effective Hourly Rate on the ${s.clientName} project is $${ehr.toFixed(0)}/hr (revenue $${revenue?.toFixed(0)}, hours ${(totalSeconds / 3600).toFixed(1)}h). Help me diagnose: what categories of "scope creep without change order" most commonly bring small-agency EHR below target, and what 3 questions should I ask myself about this specific project to identify which category I'm in?`,
      target: { kind: "client", slug: s.clientSlug, name: s.clientName },
    });
  }
  return out;
}

// ─── Retained SALES rules (single implementation → future Sales-signals) ──────

function ruleHotLeadUntouched(prospects: Prospect[]): Opportunity[] {
  return prospects
    .filter((p) => p.score.score >= 55 && (p.frontmatter.status ?? "lead") === "lead")
    .map((p) => ({
      id: `hot_lead_untouched:${p.slug}`,
      kind: "hot_lead_untouched" as const,
      severity: "suggest" as const,
      title: `${p.frontmatter.name ?? p.slug} is a hot lead (${p.score.score}) and still untouched`,
      rationale: `Status is "lead" — you haven't made outbound contact. The longer hot leads sit, the colder they get. Strongest score drivers: ${p.score.breakdown.map((b) => b.label).join(", ") || "none yet"}.`,
      action: `Reach out today. Cold call or DM, depending on what you have access to.`,
      claudeDirective: `Write a 90-word cold pitch to ${p.frontmatter.name ?? p.slug}, a ${p.frontmatter.business_type ?? "small business"}${p.frontmatter.location ? ` in ${p.frontmatter.location}` : ""}. Lead with this prospect's strongest signal: ${p.score.breakdown[0]?.label ?? "industry fit"}. Plain English, no agency jargon, end with a low-friction CTA (5-minute call or a specific question they can text back).`,
      target: { kind: "prospect" as const, slug: p.slug, name: p.frontmatter.name ?? p.slug },
    }));
}

function ruleProposalCold(prospects: Prospect[]): Opportunity[] {
  return prospects
    .map((p): Opportunity | null => {
      if (p.frontmatter.status !== "proposal") return null;
      const days = daysSince(p.frontmatter.last_contact);
      if (days === null || days < 14) return null;
      return {
        id: `proposal_cold:${p.slug}`,
        kind: "proposal_cold" as const,
        severity: "suggest" as const,
        title: `Proposal cold for ${p.frontmatter.name ?? p.slug} (${days}d since last contact)`,
        rationale: `Proposal stage but no contact in ${days} days. Either close it or kill it.`,
        action: `Send a non-pushy follow-up. If silence persists, formally mark closed-lost.`,
        claudeDirective: `Write a 70-word friendly follow-up to ${p.frontmatter.name ?? p.slug} who has had a proposal from us for ${days} days without response. Tone: warm, not pushy. Reference the original conversation, restate one specific benefit, and end with an explicit "should we keep going or pause this?" question.`,
        target: { kind: "prospect" as const, slug: p.slug, name: p.frontmatter.name ?? p.slug },
      };
    })
    .filter((x): x is Opportunity => x !== null);
}

function rulePipelineThin(prospects: Prospect[]): Opportunity[] {
  const active = prospects.filter((p) => p.frontmatter.status !== "closed-lost");
  const priorityOrHot = active.filter((p) => p.score.tier === "priority" || p.score.tier === "hot");
  if (priorityOrHot.length >= 2) return [];
  return [
    {
      id: "pipeline_thin",
      kind: "pipeline_thin",
      severity: "suggest",
      title: `Pipeline thin: only ${priorityOrHot.length} priority/hot prospect${priorityOrHot.length === 1 ? "" : "s"}`,
      rationale: `Healthy outbound pipelines have 3+ priority/hot prospects in motion at any time. Below that, project closings dry up 6-8 weeks later.`,
      action: `Block 90 minutes this week for sourcing — GBP audits, local Facebook groups, referral asks.`,
      claudeDirective: `My outbound pipeline only has ${priorityOrHot.length} prospect${priorityOrHot.length === 1 ? "" : "s"} at priority or hot tier. Give me 5 specific, concrete sourcing actions I can take this week to add 5-10 qualified small-business prospects in California (HVAC, plumbing, cleaning, contractors). Be tactical, not strategic — give me activities I can do tomorrow.`,
    },
  ];
}

// ─── Composer — legacy-compatible detectOpportunities() (revenue + risk + sales) ──

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, suggest: 1, info: 2 };

export async function detectOpportunities(): Promise<Opportunity[]> {
  const [revenue, clients, states, prospects] = await Promise.all([
    detectRevenueOpportunities(), // ← Opportunity Engine (single owner of revenue rules)
    readActiveClients(),
    listProductionStates(),
    listProspects(),
  ]);

  const sync: Opportunity[] = [
    ...ruleProductionMissing(clients, states),
    ...ruleLaunchCrunch(states),
    ...ruleHotLeadUntouched(prospects),
    ...ruleProposalCold(prospects),
    ...rulePipelineThin(prospects),
  ];
  const async_ = await Promise.all([ruleStalledProject(states), ruleLowEhr(states)]);
  const all = [...revenue, ...sync].concat(...async_);

  return all.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title)
  );
}
