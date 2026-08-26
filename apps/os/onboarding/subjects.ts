// onboarding/subjects — the clients Ascend knows it had but never recorded.
//
// The historical backfill CORRECTED records that existed. It never created one. Two clients Oscar
// confirmed in the H0 inventory have no vault presence at all — so `relationships/` shows them as
// absent because they ARE absent, not because the graph is narrow. This module records them.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE:
//
//   entity existence  ≠  entity facts
//
// A repository proves a build happened. It does not prove when the project started, when it
// launched, or what was agreed. So almost every field below is `unknown`, which is only expressible
// because PhaseStatus gained that member — this could not have been done honestly before H2.
//
// Nothing here is a guess. `confirmed` means Oscar stated it; `derived` means an artifact shows it
// and the note says which artifact and what it does NOT show.

import "server-only";

export type OnboardingFact = {
  field: string;
  value: string | null;
  classification: "confirmed" | "derived" | "unknown";
  evidence: string;
  confidence: "certain" | "high" | "medium";
};

export type OnboardingSubject = {
  slug: string;
  name: string;
  /** Facts written into the vault record. */
  facts: readonly OnboardingFact[];
  /** Repository evidence, recorded as PROVENANCE — never converted into project dates. */
  repository: {
    name: string;
    createdAt: string;
    commitDays: readonly string[];
    note: string;
  };
};

const UNKNOWN = (field: string, why: string): OnboardingFact => ({
  field,
  value: null,
  classification: "unknown",
  evidence: why,
  confidence: "certain", // certain that it is unknown, not certain of a value
});

export const ONBOARDING_SUBJECTS: readonly OnboardingSubject[] = [
  {
    slug: "bedollas-landscaping",
    name: "Bedolla's Landscaping",
    facts: [
      { field: "client", value: "true", classification: "confirmed", evidence: "H0 inventory — Oscar confirmed a paid client", confidence: "certain" },
      { field: "tier", value: "growth", classification: "confirmed", evidence: "H0 inventory — Oscar confirmed the Growth package", confidence: "certain" },
      { field: "website", value: "https://bedollaslandscaping.com", classification: "confirmed", evidence: "H0 inventory — live site listed by Oscar", confidence: "certain" },
      UNKNOWN("revenue_usd", "no contract value recorded; a tier is a price list, not an agreement (COMMERCIAL-PROVENANCE §4.1)"),
      UNKNOWN("launch_target", "no deployment evidence retrieved; last commit is not a launch"),
      UNKNOWN("phases", "a development window is not a phase history (HISTORICAL-BACKFILL-H5 §3)"),
      UNKNOWN("contact_name", "not recorded anywhere in the vault or in the H0 inventory"),
      UNKNOWN("contact_email", "not recorded"),
      UNKNOWN("industry", "not independently evidenced; the business name is not an industry classification"),
    ],
    repository: {
      name: "oski-650/bedollas-landscaping",
      createdAt: "2026-07-24",
      commitDays: ["2026-07-24", "2026-08-10"],
      note:
        "6 commits on 2026-07-24 and 1 on 2026-08-10. PROVES code was written on those days. Does " +
        "NOT prove the project began on 2026-07-24, nor that it launched on 2026-08-10.",
    },
  },
  {
    slug: "the-best-house-cleaning-team",
    name: "The Best House Cleaning Team",
    facts: [
      { field: "client", value: "true", classification: "confirmed", evidence: "H0 inventory — Oscar confirmed a paid client", confidence: "certain" },
      { field: "tier", value: "starter", classification: "confirmed", evidence: "H0 inventory — Oscar confirmed the Starter package", confidence: "certain" },
      { field: "website", value: "https://thebesthousecleaningteam.com", classification: "confirmed", evidence: "H0 inventory — live site listed by Oscar", confidence: "certain" },
      UNKNOWN("revenue_usd", "no contract value recorded; a tier is a price list, not an agreement"),
      UNKNOWN("launch_target", "no deployment evidence retrieved; last commit is not a launch"),
      UNKNOWN("phases", "a development window is not a phase history"),
      UNKNOWN("contact_name", "not recorded"),
      UNKNOWN("contact_email", "not recorded"),
      UNKNOWN("industry", "not independently evidenced"),
    ],
    repository: {
      name: "oski-650/the-best-house-cleaning-team",
      createdAt: "2026-05-12",
      commitDays: ["2026-05-12", "2026-05-15", "2026-05-16", "2026-05-26"],
      note:
        "Repo created 2026-05-12; commits on 05-12, 05-15 (×3), 05-16 and 05-26. PROVES development " +
        "activity in May. Does NOT prove the client relationship began in May.",
    },
  },
] as const;

export function subjectFor(slug: string): OnboardingSubject | undefined {
  return ONBOARDING_SUBJECTS.find((s) => s.slug === slug);
}