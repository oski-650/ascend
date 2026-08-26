// onboarding/plan — WHAT WOULD BE CREATED, decided before anything is created.
//
// Same discipline as the historical migration: a dry run that writes nothing, produces a reviewable
// manifest, and is idempotent (a subject already present yields no entry).
//
// THE INVARIANT THIS MODULE SERVES:
//
//   > Onboarding records that an entity EXISTS. It never records that business activity happened.
//
// So the manifest contains creations and unknowns, and no historical business event is ever
// proposed. The onboarding events that DO fire (`client.created`, `project.created`) are true
// statements about Ascend — it really is creating these records now — and carry `actor: "system"`,
// because reconstructing a client who has existed since May is not the operator working in the OS
// today. §19 measures the latter.

import "server-only";
import { crmDir } from "@/core/vault/paths";
import { listSubdirs } from "@/core/vault/io";
import { ONBOARDING_SUBJECTS, type OnboardingFact, type OnboardingSubject } from "./subjects";

export type OnboardingEntry = {
  slug: string;
  name: string;
  /** Facts that will be written with a value. */
  known: readonly OnboardingFact[];
  /** Facts explicitly recorded as unknown rather than omitted or defaulted. */
  unknown: readonly OnboardingFact[];
  repositoryEvidence: string;
  /** Always "system" — see the module header. */
  actor: "system";
  /** Always "none": no historical business event is ever proposed. */
  historicalEvents: "none";
};

export type OnboardingManifest = {
  version: 1;
  entries: readonly OnboardingEntry[];
};

function entryFor(s: OnboardingSubject): OnboardingEntry {
  return {
    slug: s.slug,
    name: s.name,
    known: s.facts.filter((f) => f.classification !== "unknown"),
    unknown: s.facts.filter((f) => f.classification === "unknown"),
    repositoryEvidence: `${s.repository.name} · created ${s.repository.createdAt} · commits ${s.repository.commitDays.join(", ")} — ${s.repository.note}`,
    actor: "system",
    historicalEvents: "none",
  };
}

/**
 * Build the onboarding plan. DRY RUN — performs no writes and has no write path.
 *
 * A subject whose CRM folder already exists is skipped, which makes a second run empty.
 */
export async function planOnboarding(): Promise<OnboardingManifest> {
  const existing = new Set(await listSubdirs(crmDir()));
  const entries = ONBOARDING_SUBJECTS.filter((s) => !existing.has(s.slug))
    .map(entryFor)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { version: 1, entries };
}

export function renderOnboardingManifest(m: OnboardingManifest): string {
  if (m.entries.length === 0) return "ONBOARDING MANIFEST · nothing to create\n";
  const lines: string[] = [`ONBOARDING MANIFEST · ${m.entries.length} entity(ies) to create`, ""];
  for (const e of m.entries) {
    lines.push(`${e.slug}  (${e.name})`);
    lines.push(`  actor:              ${e.actor}`);
    lines.push(`  historical events:  ${e.historicalEvents}`);
    for (const f of e.known) lines.push(`  KNOWN    ${f.field.padEnd(16)} = ${f.value}   [${f.classification}/${f.confidence}] ${f.evidence}`);
    for (const f of e.unknown) lines.push(`  UNKNOWN  ${f.field.padEnd(16)}   ${f.evidence}`);
    lines.push(`  repo evidence:      ${e.repositoryEvidence}`);
    lines.push("");
  }
  return lines.join("\n");
}