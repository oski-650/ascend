// core/crm/promote.ts — prospect → client promotion (Phase 2.2).
// Owns the CRM side ONLY: builds the 4 party-layer files, creates the client, marks the
// prospect closed-won (preserving its history, D10), and emits client.created + prospect.promoted
// (one shared correlation_id). Production scaffolding (production_state.md) is NOT here — it
// remains a temporary route concern until core/production (Phase 2.3).

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { readMarkdownFile, writeMarkdownFileAtomic } from "@/core/vault/markdown";
import { emitEvent } from "@/core/events";
import { uuidv7 } from "@/domain";
import { getProspect } from "./prospect";
import { createClient, type ClientFileInput, type Frontmatter } from "./client";

export type PromoteOptions = {
  clientSlug?: string;
  packageTier?: string;
  revenueUsd?: number;
  launchTarget?: string;
};

export type PromoteResult =
  | { ok: true; clientSlug: string; clientId: string; prospectMarked: boolean }
  | { ok: false; code: "prospect_not_found" | "client_exists" | "duplicate_client_id"; message: string };

const dateOnly = (iso: string) => iso.slice(0, 10);

export async function promoteProspect(slug: string, opts: PromoteOptions = {}): Promise<PromoteResult> {
  const prospect = await getProspect(slug);
  if (!prospect) return { ok: false, code: "prospect_not_found", message: `prospect ${slug} not found` };

  const fm = prospect.frontmatter;
  const now = new Date().toISOString();
  const newClientSlug = (opts.clientSlug ?? slug).trim();
  // CERTAINTY DEFAULT — REMOVED. This was `?? "growth"`, which turned "the caller did not say"
  // into a stored assertion that the client bought Growth, and from there into contracted revenue
  // via TIER_PRICES (core/finance/revenue.ts:26). Bay Area Custom Shirts carries `tier: "growth"`
  // from this path for an entity that was never a client and never had a tier recorded.
  //
  // "" is the vault's existing representation of an unstated tier; `normalizeTier("")` returns null,
  // so revenue resolves to null rather than $2,497. Absence stays absence.
  const packageTier = opts.packageTier ?? "";
  const launchTarget = opts.launchTarget ?? "";
  const correlationId = uuidv7();

  const business: ClientFileInput = {
    frontmatter: {
      name: fm.name ?? newClientSlug,
      business: fm.name ?? newClientSlug,
      industry: fm.business_type ?? "",
      location: fm.location ?? "",
      contact_name: fm.contact_name ?? "",
      contact_email: fm.contact_email ?? "",
      contact_phone: fm.contact_phone ?? "",
      website: fm.website ?? "",
      languages: ["English"],
      retainer_active: false,
    },
    body: [
      "## Overview",
      prospect.body
        ? "Carried over from prospect notes:\n\n" + prospect.body
        : "_(fill in once kickoff is complete)_",
      "",
      "## Goals",
      "- _(capture during kickoff call)_",
      "",
      "## Notes",
      `- Promoted from Hit List on ${dateOnly(now)} (prospect score was ${prospect.score.score}/100).`,
    ].join("\n"),
  };

  const brand: ClientFileInput = {
    frontmatter: {
      primary_color: "",
      secondary_color: "",
      accent_color: "",
      fonts: { heading: "", body: "" },
      voice: "",
      logo_assets: [],
      photography_style: "",
    },
    body: [
      "## Brand Voice",
      "_(capture from kickoff / onboarding portal submission)_",
      "",
      "## Visual Notes",
      "_(any references the client shared during sales)_",
    ].join("\n"),
  };

  const scopeFrontmatter: Frontmatter = {
    phase: "onboarding",
    package: packageTier,
    deliverables: [],
    launch_target: launchTarget,
    status: "active",
  };
  if (opts.revenueUsd !== undefined) scopeFrontmatter.revenue_usd = opts.revenueUsd;

  const scope: ClientFileInput = {
    frontmatter: scopeFrontmatter,
    body: [
      "## Scope Summary",
      "_(populate after kickoff — what we're building and why)_",
      "",
      "## Out of Scope",
      "_(be explicit — protects against scope creep)_",
      "",
      "## Decisions Log",
      `- ${dateOnly(now)} — promoted from Hit List prospect.`,
    ].join("\n"),
  };

  const meta: Frontmatter = {
    client_id: newClientSlug,
    organization_id: "ascend",
    status: "active",
    tier: packageTier,
    created_at: now,
    promoted_from_prospect: slug,
    source: "hit-list-promotion",
  };

  const created = await createClient({ slug: newClientSlug, business, brand, scope, meta }, { correlationId });
  if (!created.ok) return created; // client_exists | duplicate_client_id — nothing written yet

  // Mark the prospect closed-won + append a promotion note (preserve its history — D10).
  // Non-fatal (matches prior behavior): the client is already created.
  let prospectMarked = false;
  try {
    const prospectPath = path.join(hitListDir(), `${slug}.md`);
    const md = await readMarkdownFile(prospectPath);
    const nextFm = { ...md.frontmatter, status: "closed-won", last_contact: dateOnly(now) };
    const nextBody =
      md.body + `\n\n## Promotion\n- ${dateOnly(now)} — promoted to CRM client \`${newClientSlug}\`.\n`;
    await writeMarkdownFileAtomic(prospectPath, nextFm, nextBody);
    await emitEvent({
      type: "prospect.promoted",
      subject: { entity: "prospect", entity_id: slug },
      data: { client_slug: newClientSlug, client_id: created.clientId },
      correlation_id: correlationId,
    });
    prospectMarked = true;
  } catch {
    // prospect-marking failed — non-fatal; client + client.created already committed.
  }

  return { ok: true, clientSlug: newClientSlug, clientId: created.clientId, prospectMarked };
}
