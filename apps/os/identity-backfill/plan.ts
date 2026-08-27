// identity-backfill/plan — WHICH FILES GET AN IDENTITY, decided before any file gets one.
//
// Dry run by construction: this module has no write primitive and imports nothing that does.
//
// THE INVARIANT THIS MODULE SERVES:
//
//   > Anchoring a prospect records that THIS FILE REPRESENTS THIS STABLE IDENTITY.
//   > It records nothing else.
//
// Not when the prospect was created, not that it was contacted, not that it is a real customer, not
// that it has a website, not that anyone assessed one. `prospect_id` is a name, and a name is not a
// claim about the thing named. Every field the manifest carries beyond the id is there so a HUMAN
// can review the proposal — none of it is written to the vault.
//
// DETERMINISM, and the one place it is bounded. Given the same snapshot the DECISIONS are fully
// deterministic: the same slugs are assigned, the same slugs are held, in the same order, for the
// same reasons. The minted UUIDv7s are not — they cannot be, since a UUIDv7 encodes the moment it
// was minted. So the id factory is INJECTABLE (the same discipline the engines apply to the clock),
// tests pin it, and the manifest is the frozen artifact: `apply` uses the ids the reviewed manifest
// carries and never re-mints.

import "server-only";
import { findDuplicateCandidates, type DuplicateCandidate } from "@/core/vault/identity";
import { newProspectId, type ProspectId, type ProspectSlug } from "@/domain";
import { declaredHoldFor } from "./holds";
import { snapshotHitList, type HitListSnapshot, type IdentityFields } from "./snapshot";

/** What the plan proposes to do with one prospect file. */
export type IdentityDecision =
  /** No anchor yet, no reason to withhold one → mint and write. */
  | "assign"
  /** Already carries a `prospect_id` → left exactly as it is. An existing id is never replaced. */
  | "already-anchored"
  /** Anchoring would assert something the evidence does not support → a human decides. */
  | "held";

export type IdentityBackfillEntry = {
  slug: string;
  decision: IdentityDecision;
  /** The id that WOULD be written. Null for every decision other than `assign`. */
  proposedProspectId: ProspectId | null;
  /** The id already on disk. Null unless `already-anchored`. */
  existingProspectId: ProspectId | null;
  /** Present only for `held` — the reason, in words a reviewer can act on. */
  holdReason: string | null;
  /** Slugs this file may be a duplicate of. Informational for `assign`; causal for `held`. */
  duplicateOf: readonly string[];
  /** Shown so a reviewer can judge the proposal. NONE of this is written by the backfill. */
  identityFields: IdentityFields;
  /** Snapshot fingerprints, carried into `verify` (see snapshot.ts). */
  contentSha256: string;
  identitylessSha256: string;
  /** Always "none". The backfill proposes no business event of any kind. */
  businessEvent: "none";
};

export type IdentityBackfillManifest = {
  version: 1;
  entries: readonly IdentityBackfillEntry[];
  /** Every duplicate pair the detector found, reported whole — never resolved here. */
  duplicates: readonly DuplicateCandidate[];
  summary: {
    total: number;
    assign: number;
    held: number;
    alreadyAnchored: number;
  };
};

export type PlanOptions = {
  /** Injected so tests are deterministic; production mints a real UUIDv7. */
  mintId?: () => ProspectId;
  /** Reuse an existing snapshot instead of taking a fresh one (verify re-plans against the original). */
  snapshot?: HitListSnapshot;
};

/**
 * Build the identity backfill plan.
 *
 * The decision ladder, strongest claim first — order matters and is the whole safety argument:
 *
 *   1  an existing id wins over everything            → `already-anchored`, never replaced
 *   2  a DECLARED hold wins over the detector         → `held`, by human decision
 *   3  a DETECTED duplicate candidate withholds        → `held`, by evidence
 *   4  otherwise                                       → `assign`
 *
 * Rule 3 is the generalisation of rule 2, and it is deliberately not limited to the pair we already
 * know about: any future pair the detector flags is withheld by the same rule, without anybody
 * having to remember to add it to `holds.ts`.
 */
export async function planIdentityBackfill(
  options: PlanOptions = {}
): Promise<IdentityBackfillManifest> {
  const mint = options.mintId ?? newProspectId;
  const snapshot = options.snapshot ?? (await snapshotHitList());

  // The detector is the SAME one Stage 0.5 shipped and the same one intake will use later. A second
  // implementation here would be a second opinion about what a duplicate is.
  const duplicates = findDuplicateCandidates(
    snapshot.prospects.map((p) => ({
      slug: p.slug as ProspectSlug,
      name: p.identityFields.name,
      website: p.identityFields.website,
      contact_phone: p.identityFields.contact_phone,
      contact_email: p.identityFields.contact_email,
    }))
  );

  const partnersOf = new Map<string, string[]>();
  for (const candidate of duplicates) {
    const [a, b] = candidate.slugs;
    partnersOf.set(a, [...(partnersOf.get(a) ?? []), b]);
    partnersOf.set(b, [...(partnersOf.get(b) ?? []), a]);
  }

  const entries: IdentityBackfillEntry[] = snapshot.prospects.map((p) => {
    const duplicateOf = (partnersOf.get(p.slug) ?? []).slice().sort();
    const base = {
      slug: p.slug,
      existingProspectId: p.existingProspectId,
      duplicateOf,
      identityFields: p.identityFields,
      contentSha256: p.contentSha256,
      identitylessSha256: p.identitylessSha256,
      businessEvent: "none" as const,
    };

    // 1 — an id already on disk is never touched, whatever else is true of this file.
    if (p.existingProspectId !== null) {
      return { ...base, decision: "already-anchored" as const, proposedProspectId: null, holdReason: null };
    }

    // 2 — declared holds outrank the detector, so a heuristic change cannot release them.
    const declared = declaredHoldFor(p.slug);
    if (declared) {
      return { ...base, decision: "held" as const, proposedProspectId: null, holdReason: declared.reason };
    }

    // 3 — detected duplicates: assigning distinct ids would assert independence.
    if (duplicateOf.length > 0) {
      return {
        ...base,
        decision: "held" as const,
        proposedProspectId: null,
        holdReason: `Duplicate candidate of ${duplicateOf.join(", ")}. Anchoring both would assert they are independent businesses and would make a later merge ambiguous.`,
      };
    }

    // 4 — safe to name.
    return { ...base, decision: "assign" as const, proposedProspectId: mint(), holdReason: null };
  });

  return {
    version: 1,
    entries,
    duplicates,
    summary: {
      total: entries.length,
      assign: entries.filter((e) => e.decision === "assign").length,
      held: entries.filter((e) => e.decision === "held").length,
      alreadyAnchored: entries.filter((e) => e.decision === "already-anchored").length,
    },
  };
}

// ─── Validation: the gate between a plan and a mutation ────────────────────────────────────────

export type ValidationIssue = { slug: string; problem: string };

/**
 * Structural rules the manifest must satisfy before `apply` will touch anything.
 *
 * These do not re-derive the plan — they catch a planner that produced something incoherent, before
 * the incoherence reaches the vault. Same posture as `migration/validate`.
 */
export function validateIdentityManifest(m: IdentityBackfillManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (slug: string, problem: string) => issues.push({ slug, problem });

  const proposed = new Map<string, string>();
  for (const e of m.entries) {
    // The headline invariant, enforced rather than trusted.
    if (e.businessEvent !== "none") add(e.slug, "proposes a business event; identity backfill may not claim the business did anything");

    if (e.decision === "assign") {
      if (!e.proposedProspectId) add(e.slug, "assign with no proposed id");
      if (e.existingProspectId) add(e.slug, "assign would replace an existing identity");
      if (e.duplicateOf.length > 0) add(e.slug, "assign despite an unresolved duplicate candidate");
      if (e.proposedProspectId) {
        // Two entries proposing one id would give two files one identity — the mirror of the
        // failure the holds prevent, and just as wrong.
        const claimant = proposed.get(e.proposedProspectId);
        if (claimant) add(e.slug, `proposed id collides with ${claimant}`);
        proposed.set(e.proposedProspectId, e.slug);
      }
    }

    if (e.decision === "held" && (e.proposedProspectId || !e.holdReason)) {
      add(e.slug, "a hold must propose no id and must state a reason");
    }

    if (e.decision === "already-anchored") {
      if (!e.existingProspectId) add(e.slug, "already-anchored with no existing id");
      if (e.proposedProspectId) add(e.slug, "already-anchored entries propose nothing");
    }
  }

  // Every declared hold must actually be held — a hold that silently stopped matching a file is a
  // hole nobody is watching (the stale-exemption failure F21 guards against).
  for (const e of m.entries) {
    if (declaredHoldFor(e.slug) && e.decision !== "held") {
      add(e.slug, "is a declared hold but the plan does not hold it");
    }
  }

  return issues;
}

// ─── Rendering ─────────────────────────────────────────────────────────────────────────────────

const NA = "—";

/** The reviewable artifact. Deterministic text: same manifest in, same bytes out. */
export function renderIdentityManifest(m: IdentityBackfillManifest): string {
  const lines: string[] = [
    "PROSPECT IDENTITY BACKFILL · DRY RUN",
    "",
    `  prospects discovered   ${m.summary.total}`,
    `  would be anchored      ${m.summary.assign}`,
    `  held for review        ${m.summary.held}`,
    `  already anchored       ${m.summary.alreadyAnchored}`,
    `  business events        none`,
    "",
    "─".repeat(94),
    "",
  ];

  for (const e of m.entries) {
    const mark = e.decision === "assign" ? "ASSIGN " : e.decision === "held" ? "HELD   " : "ANCHORED";
    lines.push(`${mark} ${e.slug}`);
    lines.push(`         name     ${e.identityFields.name ?? NA}`);
    lines.push(`         website  ${e.identityFields.website ?? NA}`);
    lines.push(`         phone    ${e.identityFields.contact_phone ?? NA}`);
    lines.push(`         email    ${e.identityFields.contact_email ?? NA}`);
    lines.push(`         current  prospect_id ${e.existingProspectId ?? NA}`);
    if (e.decision === "assign") {
      lines.push(`         PROPOSED prospect_id ${e.proposedProspectId}`);
      lines.push(`         change   insert one frontmatter line; sha256(identityless) ${e.identitylessSha256.slice(0, 16)}… must survive`);
    }
    if (e.decision === "held") {
      lines.push(`         HOLD     ${e.holdReason}`);
      lines.push(`         change   none — this file is not touched`);
    }
    if (e.decision === "already-anchored") {
      lines.push(`         change   none — an existing identity is never replaced`);
    }
    lines.push("");
  }

  lines.push("─".repeat(94), "");
  if (m.duplicates.length === 0) {
    lines.push("DUPLICATE CANDIDATES  none");
  } else {
    lines.push(`DUPLICATE CANDIDATES  ${m.duplicates.length} — reported, NEVER merged`);
    for (const d of m.duplicates) {
      lines.push(`  ${d.slugs[0]}`);
      lines.push(`  ${d.slugs[1]}`);
      lines.push(`    matched on ${d.matchedOn}: ${d.value}`);
      lines.push(`    resolution REQUIRES HUMAN DECISION — no record is merged, deleted or renamed`);
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}