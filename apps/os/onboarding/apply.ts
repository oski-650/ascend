// onboarding/apply — create the entity records, and nothing else.
//
// Requires an explicit `confirm`, exactly like the migration. Writes go through the canonical core
// writers (`core/crm.createClient`, `core/production.createProject`) rather than touching the vault
// directly, so identity validation, atomic writes and F21's emit-with-the-write invariant all apply
// unchanged. The only thing this module supplies is `actor: "system"`.
//
// WHAT IS DELIBERATELY NOT WRITTEN:
//
//   phase statuses      left to the schema default, which core/production reads as `unknown`
//   launch_target       ""      — unknown, not a guessed date
//   revenue_usd         omitted — a tier is a price list, not a contract (COMMERCIAL-PROVENANCE §4.1)
//   contacts / brand    omitted — absence stays absence rather than becoming empty-string "facts"
//   repo dates          recorded as PROSE evidence in the scope body, never as project dates
//
// The last one is the whole discipline in miniature: a May commit history means "development
// evidence exists in May", not "the project began in May".

import "server-only";
import { createClient } from "@/core/crm";
import { createProject } from "@/core/production";
import { ONBOARDING_SUBJECTS, type OnboardingSubject } from "./subjects";
import { planOnboarding, type OnboardingManifest } from "./plan";

export type OnboardingReport = {
  created: string[];
  skipped: { slug: string; reason: string }[];
  /** Business events attributed to the operator. Structurally always 0; reported so a regression shows. */
  operatorEvents: 0;
};

function knownValue(s: OnboardingSubject, field: string): string | null {
  const f = s.facts.find((x) => x.field === field);
  return f && f.classification !== "unknown" ? f.value : null;
}

/** The scope body: what Ascend knows, and — just as important — what it does not. */
function scopeBody(s: OnboardingSubject): string {
  const unknowns = s.facts.filter((f) => f.classification === "unknown");
  return [
    "## Scope Summary",
    `_Retroactively onboarded from the H0 inventory. Ascend did not observe this engagement while it happened._`,
    "",
    "## Evidence",
    `- **Repository:** ${s.repository.name}, created ${s.repository.createdAt}`,
    `- **Development activity:** ${s.repository.commitDays.join(", ")}`,
    `- ${s.repository.note}`,
    "",
    "## Explicitly unknown",
    ...unknowns.map((f) => `- **${f.field}** — ${f.evidence}`),
    "",
    "## Decisions Log",
    `- Onboarded as a historical entity. Phase history, launch date and contract value are UNKNOWN, not zero and not inferred.`,
  ].join("\n");
}

export async function applyOnboarding(
  manifest: OnboardingManifest,
  opts: { confirm: boolean }
): Promise<OnboardingReport> {
  if (!opts.confirm) {
    throw new Error("applyOnboarding requires { confirm: true } — dry run is the default");
  }

  const report: OnboardingReport = { created: [], skipped: [], operatorEvents: 0 };

  for (const entry of manifest.entries) {
    const s = ONBOARDING_SUBJECTS.find((x) => x.slug === entry.slug);
    if (!s) {
      report.skipped.push({ slug: entry.slug, reason: "no declared subject" });
      continue;
    }

    const tier = knownValue(s, "tier");
    const website = knownValue(s, "website");

    const created = await createClient(
      {
        slug: s.slug,
        business: {
          frontmatter: {
            name: s.name,
            business: s.name,
            website: website ?? "",
            languages: ["English"],
            retainer_active: false,
          },
          body: [
            "## Overview",
            "_(unknown — not captured while the engagement was live)_",
            "",
            "## Goals",
            "- _(unknown)_",
            "",
            "## Notes",
            "- Retroactively onboarded; Ascend has no contemporaneous record of this engagement.",
          ].join("\n"),
        },
        // Brand is left entirely empty rather than invented. An empty string here reads as
        // "nothing recorded", which is true; a plausible palette would read as a decision.
        brand: {
          frontmatter: {
            primary_color: "",
            secondary_color: "",
            accent_color: "",
            fonts: { heading: "", body: "" },
            voice: "",
            logo_assets: [],
            photography_style: "",
          },
          body: "## Brand Voice\n_(unknown)_\n\n## Visual Notes\n_(unknown)_",
        },
        scope: {
          frontmatter: {
            // NOTE: no `phase`, `status`, `package` or `launch_target` — those four keys are retired
            // (SOURCE-AUTHORITY §4.5). Creating them here would reintroduce exactly what the
            // migration just removed from every other client.
            deliverables: [],
          },
          body: scopeBody(s),
        },
        meta: {
          client_id: s.slug,
          organization_id: "ascend",
          // NO `status`. "The engagement is over" does not establish `maintenance`, and `status` is
          // BEHAVIOUR-BEARING: `maintenance` is the sole trigger for launched_no_retainer and
          // launched_checkin. Writing it would turn an inference into an actionable OS claim.
          //
          // Omitted rather than written as `"unknown"`, and the difference is not cosmetic:
          //
          //   omitted            observeClients skips the client ("no status field"). When a status
          //                      is eventually recorded, that is a FIRST SIGHTING — observation.captured
          //                      only, no business event. A baseline is not a birth.
          //   status: "unknown"  the client is observed, and a later `unknown → maintenance` hits the
          //                      client path in core/reconciler, which has no epistemic guard (unlike
          //                      phases). It would emit client.status_changed — claiming the business
          //                      changed status when Ascend merely learned it.
          //
          // So absence stays absence, and the existing skip-then-baseline machinery gives the right
          // event semantics for free.
          ...(tier ? { tier } : {}),
          source: "retroactive-onboarding",
        },
      },
      // Ascend is recording a historical entity, not the operator working in the OS today.
      { actor: "system" }
    );

    if (!created.ok) {
      report.skipped.push({ slug: s.slug, reason: created.message });
      continue;
    }

    // `retroactive` writes a phases-only production_state: every phase `unknown`, no checklist,
    // no industry_template. A template scaffold would assert an unchecked checklist for work that
    // may well have been done — see core/production.createProject for the full reasoning.
    const project = await createProject(s.slug, { actor: "system", retroactive: true });
    if (!project.ok) {
      report.skipped.push({ slug: s.slug, reason: `client created but project failed: ${project.message}` });
      continue;
    }

    report.created.push(s.slug);
  }

  return report;
}

/** Re-planning after a successful run must be empty. */
export async function verifyOnboarding(): Promise<{ ok: boolean; remaining: number }> {
  const again = await planOnboarding();
  return { ok: again.entries.length === 0, remaining: again.entries.length };
}