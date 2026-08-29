// substrate-migration/ledger — WHAT THE OS MEANS, computed identically from either store.
//
// The Stage 2B claim is not "six rows were copied". It is:
//
//   > The Postgres representation produces the same behavioural ledger as the vault representation.
//
// A field-by-field diff cannot establish that, because it compares STORAGE. This compares BEHAVIOUR:
// the values every consumer actually derives — identity state, scores and their breakdowns,
// duplicate candidates, event sequence, and origin knowledge. If the two stores agree here, moving
// the read is behaviour-preserving; if they disagree, the migration changed what the OS means.
//
// THE HISTORICAL BOUNDARY, and why `origins` exists.
//
// Not one of the six prospects has a `prospect.created` event. All six appear in the spine only as
// `observation.captured` baselines from 2026-08-17 — the reconciler's own doctrine, "a baseline is
// not a birth", visible in live data. Their origin is genuinely UNKNOWN.
//
// A migration that inserted rows with `created_at = now()` and said nothing else would silently
// convert "we never witnessed this being created" into "created on the migration date". That is the
// absence-into-fact conversion the whole H-series was spent removing, and it is easiest to commit
// precisely when moving stores. `origins` asserts the unknowing survives the move.
//
// PURE COMPARISON SHAPE. Everything is normalised to strings and sorted, so a difference in
// serialisation (a Date vs an ISO string, a null vs an absent key) cannot masquerade as agreement,
// and ordering cannot masquerade as difference.

import "server-only";
import { computeScore } from "@/core/crm/scoring";
import { findDuplicateCandidates } from "@/core/vault/identity";
import type { ProspectFrontmatter, ProspectSlug } from "@/domain";

/** The business fields compared across stores. Ordered, so the ledger is deterministic. */
export const LEDGER_FIELDS = [
  "name", "business_type", "location", "website", "website_quality",
  "contact_name", "contact_phone", "contact_email", "source", "status",
  "decision_maker_access", "project_urgency", "niche_alignment",
  "first_contact", "last_contact",
] as const;

/**
 * Fields where `""` and an absent key are PROVEN behaviourally identical, so the migration may
 * collapse them. The list is short and each entry is justified by tracing consumers, not by taste.
 *
 * `first_contact` / `last_contact` are `date` columns; Postgres cannot store `""` in one at all, so
 * the choice is forced. What makes the collapse SAFE is the inventory, and all three consumers were
 * checked:
 *
 *   lib/opportunities.ts:211   daysSince(v) → `if (!iso) return null`   — "" and undefined both null
 *   lib/compileTargetContext   fmtScalar(v) → "—" for undefined AND for a zero-length string
 *   app/sales/[prospect]       FactRow value — both falsy, both render the same
 *
 * Every OTHER field keeps `""` verbatim, because nothing proves it invisible there.
 */
export const EMPTY_EQUALS_ABSENT: readonly string[] = ["first_contact", "last_contact"];

export type LedgerProspect = {
  /** Comparison key: the anchor where one exists, the slug where none does. */
  key: string;
  /**
   * The markdown body — call log, friction, objections.
   *
   * ADDED AFTER THE FACT, and that is the point. The first version of this ledger compared
   * frontmatter and scores only, reported parity, and was wrong: two modules read `Prospect.body`
   * and the migration was dropping it. A parity ledger is only as good as its consumer inventory.
   */
  body: string;
  identityState: "anchored" | "held";
  prospectId: string | null;
  fields: Record<string, string | null>;
  score: number;
  tier: string;
  breakdown: string[];
};

export type LedgerEvent = {
  eventId: string;
  type: string;
  actor: string;
  subject: string;
  occurredAt: string;
};

export type Ledger = {
  prospects: LedgerProspect[];
  events: LedgerEvent[];
  /** Per prospect: has Ascend ever witnessed its creation? For all six, NO — and that must persist. */
  origins: { key: string; birthWitnessed: boolean }[];
  duplicateCandidates: { slugs: string[]; matchedOn: string }[];
};

/** Normalise any scalar to a comparable string. `undefined` and `""` both collapse to null. */
export function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * The value EXACTLY as the vault holds it: `""` stays `""`, an absent key stays null.
 *
 * WHY BOTH FUNCTIONS EXIST, and why using the wrong one hid a defect. `norm` collapses `""` to null,
 * which is right for asking "is anything stated here?" and WRONG for migrating, because the vault
 * genuinely distinguishes a key that is present-and-empty from a key that is absent. Stage 2B built
 * its rows with `norm`, so every `contact_email: ""` became NULL — and because the ledger normalised
 * BOTH sides with `norm`, the comparison agreed with itself and reported parity.
 *
 * A ledger that normalises before comparing proves NORMALISED parity, not behavioural parity. That
 * is the same failure as the missing body, one layer down.
 *
 * Whether `""` SHOULD mean absent is a real epistemic question, and it is deliberately not answered
 * here: the flip must preserve behaviour, and collapsing them is a repair that deserves its own gate
 * the way D-1 and D-2 each did.
 */
export function raw(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Build the ledger from normalised inputs.
 *
 * Both callers hand this the same shapes, so the scoring, duplicate detection and ordering logic
 * runs ONCE rather than being reimplemented per store — a second implementation would be able to
 * agree with itself while both were wrong.
 */
export function buildLedger(input: {
  prospects: { slug: string; prospectId: string | null; identityState: "anchored" | "held"; fields: Record<string, string | null>; body: string }[];
  events: LedgerEvent[];
}): Ledger {
  const prospects: LedgerProspect[] = input.prospects
    .map((p) => {
      // The scorer is the vault's own pure function, fed from normalised fields. If a field were
      // lost in serialisation the score changes, which is what makes this a fidelity test and not
      // merely a field comparison.
      const fm = {
        website: p.fields.website ?? undefined,
        website_quality: p.fields.website_quality ?? undefined,
        decision_maker_access: p.fields.decision_maker_access === "true",
        project_urgency: p.fields.project_urgency ?? undefined,
        niche_alignment: p.fields.niche_alignment === "true",
      } as ProspectFrontmatter;
      const score = computeScore(fm);
      return {
        key: p.prospectId ?? p.slug,
        body: p.body.trim(),
        identityState: p.identityState,
        prospectId: p.prospectId,
        fields: Object.fromEntries(LEDGER_FIELDS.map((f) => [f, p.fields[f] ?? null])),
        score: score.score,
        tier: score.tier,
        breakdown: score.breakdown.map((b) => b.key).sort(),
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const birthTypes = new Set(["prospect.created"]);
  const witnessed = new Set(
    input.events.filter((e) => birthTypes.has(e.type)).map((e) => e.subject.replace(/^prospect:/, ""))
  );

  const duplicateCandidates = findDuplicateCandidates(
    input.prospects.map((p) => ({
      slug: p.slug as ProspectSlug,
      name: p.fields.name,
      website: p.fields.website,
      contact_phone: p.fields.contact_phone,
      contact_email: p.fields.contact_email,
    }))
  ).map((d) => ({ slugs: [...d.slugs].sort(), matchedOn: d.matchedOn }));

  return {
    prospects,
    // Events keep their APPEND ORDER as given; the caller is responsible for supplying the store's
    // authoritative sequence, and comparing those sequences is half the point of this ledger.
    events: input.events,
    origins: input.prospects
      .map((p) => ({
        key: p.prospectId ?? p.slug,
        birthWitnessed: witnessed.has(p.slug) || (p.prospectId ? witnessed.has(p.prospectId) : false),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    duplicateCandidates,
  };
}
