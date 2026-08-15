// engines/opportunity-engine — pure revenue-expansion opportunity detection (Part V §V.2).
//
// OWNS (moved from lib/opportunities, deleted there — single owner): launched_no_retainer,
// launched_checkin. Revenue-expansion ONLY — no health/risk detection, no sales/outreach
// detection, no severity sorting, no ranking, no Decision behavior.
//
// PURITY: reads core/crm public contracts only; NO writes, NO events, NO direct fs, NO persistence.
// Output shape is the existing Opportunity (deferred: estimatedValueUsd/confidence/richer modeling).

import { listClients, getClient } from "@/core/crm";
import type { Severity } from "@/domain";

export type { Severity };

export type OpportunityKind =
  | "production_missing"
  | "launched_no_retainer"
  | "launched_checkin"
  | "launch_crunch"
  | "stalled_project"
  | "low_ehr"
  | "hot_lead_untouched"
  | "proposal_cold"
  | "pipeline_thin";

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  severity: Severity;
  title: string;
  rationale: string;
  /** What the operator (you) should do next — descriptive, not executed or prioritized. */
  action: string;
  /** Used by the clipboard compiler as the Claude directive. */
  claudeDirective: string;
  target?: { kind: "client" | "prospect"; slug: string; name: string };
  // NOTE: an `href` field was removed here (Increment 8, explicitly approved dead-contract
  // removal). It carried `/crm/:slug` — a retired route — and had ZERO consumers: every surface
  // resolves an opportunity's destination from `target` through navigation/routing, the single
  // routing owner. A pure engine must not construct routes; keeping the field would have
  // preserved an architectural violation rather than a contract. Detection, severity, ordering
  // and every other field are unchanged.
};

export function severityLabel(s: Severity): string {
  return { urgent: "URGENT", suggest: "SUGGEST", info: "INFO" }[s];
}

type ClientStatus = {
  slug: string;
  name: string;
  status?: string;
  contact_email?: string;
  business_type?: string;
  launchedAtISO?: string;
};

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400_000);
}

/** Read client status through core/crm public reads (no direct fs). */
async function readClients(): Promise<ClientStatus[]> {
  const list = await listClients();
  return Promise.all(
    list.map(async ({ slug }) => {
      const c = await getClient(slug);
      const bfm = c?.business.frontmatter ?? {};
      const sfm = c?.scope.frontmatter ?? {};
      return {
        slug,
        name: (bfm.name as string | undefined) ?? (bfm.business as string | undefined) ?? slug,
        status: (sfm.status as string | undefined)?.toLowerCase(),
        contact_email: bfm.contact_email as string | undefined,
        business_type: (bfm.industry as string | undefined) ?? (bfm.business_type as string | undefined),
        launchedAtISO: sfm.launch_target as string | undefined,
      };
    })
  );
}

// ─── Revenue-expansion rules (single owner — verbatim behavior) ───────────────

function ruleLaunchedNoRetainer(clients: ClientStatus[]): Opportunity[] {
  return clients
    .filter((c) => c.status === "maintenance")
    .map((c) => ({
      id: `launched_no_retainer:${c.slug}`,
      kind: "launched_no_retainer" as const,
      severity: "suggest" as const,
      title: `Pitch a recurring care plan to ${c.name}`,
      rationale: `${c.name} is launched and in maintenance — historically the best moment to introduce a monthly care plan (hosting + minor updates + SEO check-ins). No retainer is currently active.`,
      action: `Send a warm, low-pressure pitch for a $99–249/month care plan tailored to ${c.name}'s context.`,
      claudeDirective: `Write a 120-word email pitching a monthly care plan to ${c.name}. Match their brand voice (see Brand Identity context above). Don't be pushy. Frame it as "now that we're past launch, here's how to keep the site sharp." Offer 2 tier options.`,
      target: { kind: "client" as const, slug: c.slug, name: c.name },
    }));
}

function ruleLaunchedCheckin(clients: ClientStatus[]): Opportunity[] {
  return clients
    .filter((c) => c.status === "maintenance")
    .map((c): Opportunity | null => {
      const days = daysSince(c.launchedAtISO) ?? null;
      const old = days !== null && days >= 90;
      if (!old) return null;
      return {
        id: `launched_checkin:${c.slug}`,
        kind: "launched_checkin",
        severity: "suggest",
        title: `Check in with ${c.name} (${days}d since launch)`,
        rationale: `${c.name} launched ${days} days ago. Long-quiet clients are warm sources of: case study quotes, referrals, and upsell openings — but only if you stay in their orbit.`,
        action: `Send a friendly check-in: ask how the site is performing, mention case study possibility, ask about referrals.`,
        claudeDirective: `Write a 90-word check-in email to ${c.name}. It should: (1) genuinely ask how the site has been performing for them, (2) softly ask if they'd consider a brief testimonial / case study, (3) close with a referral ask phrased as "anyone else you know who'd benefit from what we built for you." Match their brand voice.`,
        target: { kind: "client", slug: c.slug, name: c.name },
      };
    })
    .filter((x): x is Opportunity => x !== null);
}

/** Revenue-expansion opportunities only. Unsorted — the caller/composer owns any ordering. */
export async function detectRevenueOpportunities(): Promise<Opportunity[]> {
  const clients = await readClients();
  return [...ruleLaunchedNoRetainer(clients), ...ruleLaunchedCheckin(clients)];
}
