// identity-backfill/verify — PROVING THE BACKFILL NAMED THINGS AND CLAIMED NOTHING.
//
// Runs AFTER apply and answers the questions the manifest cannot answer about itself. Reads and
// computes; writes nothing, emits nothing. Same shape as `migration/verify`.
//
// The checks are ordered from "did we do what we said" to "did we avoid doing anything else",
// because the second question is the one this stage exists to answer.

import "server-only";
import { readEvents } from "@/core/events";
import { reconcileVault } from "@/core/reconciler";
import { buildProspectIdIndex } from "@/core/vault/identity";
import { snapshotHitList, type HitListSnapshot } from "./snapshot";
import { planIdentityBackfill, type IdentityBackfillManifest } from "./plan";

export type Check = { name: string; ok: boolean; detail: string };
export type IdentityVerification = { ok: boolean; checks: Check[] };

/**
 * Business events attributed to the operator — the §19 guard.
 *
 * A COUNT over the log, deliberately, not an assertion that `emitEvent` was not called. "We don't
 * call it" is a claim about today's code; counting the log tests the property itself, which is what
 * `migration/verify.countOperatorBusinessEvents` established and what this reuses in spirit.
 */
export async function countOperatorBusinessEvents(): Promise<number> {
  const events = await readEvents();
  return events.filter((e) => e.actor === "operator" && e.type !== "observation.captured").length;
}

export async function verifyIdentityBackfill(opts: {
  /** The snapshot the manifest was planned against. */
  before: HitListSnapshot;
  manifest: IdentityBackfillManifest;
  eventCountBefore: number;
  operatorEventsBefore: number;
}): Promise<IdentityVerification> {
  const checks: Check[] = [];
  const after = await snapshotHitList();
  const bySlug = new Map(after.prospects.map((p) => [p.slug, p]));

  // 1 — every assigned entry carries exactly the reviewed id.
  const wrong: string[] = [];
  for (const e of opts.manifest.entries.filter((x) => x.decision === "assign")) {
    const now = bySlug.get(e.slug);
    if (!now || now.existingProspectId !== e.proposedProspectId) {
      wrong.push(`${e.slug} (expected ${e.proposedProspectId}, found ${now?.existingProspectId ?? "none"})`);
    }
  }
  checks.push({
    name: "every assigned prospect carries the reviewed id",
    ok: wrong.length === 0,
    detail: wrong.length === 0 ? "all match" : wrong.join("; "),
  });

  // 2 — THE DECISIVE CHECK. Strip the identity line and the file must hash to what it hashed to
  // before. This is what proves the backfill inserted a name and touched no business fact: not a
  // review of the diff, a fingerprint of it.
  const mutated: string[] = [];
  for (const e of opts.manifest.entries) {
    const now = bySlug.get(e.slug);
    if (!now) {
      mutated.push(`${e.slug} (disappeared)`);
      continue;
    }
    if (now.identitylessSha256 !== e.identitylessSha256) mutated.push(`${e.slug} (content changed)`);
  }
  checks.push({
    name: "no prospect's content changed apart from the identity line",
    ok: mutated.length === 0,
    detail: mutated.length === 0 ? "all identityless hashes intact" : mutated.join("; "),
  });

  // 3 — held prospects are untouched, byte for byte, and remain unanchored.
  const heldTouched: string[] = [];
  for (const e of opts.manifest.entries.filter((x) => x.decision === "held")) {
    const now = bySlug.get(e.slug);
    if (!now) {
      heldTouched.push(`${e.slug} (disappeared)`);
      continue;
    }
    if (now.contentSha256 !== e.contentSha256) heldTouched.push(`${e.slug} (bytes changed)`);
    if (now.existingProspectId !== null) heldTouched.push(`${e.slug} (was anchored despite the hold)`);
  }
  checks.push({
    name: "held prospects are byte-identical and still unanchored",
    ok: heldTouched.length === 0,
    detail: heldTouched.length === 0 ? `${opts.manifest.summary.held} held, none touched` : heldTouched.join("; "),
  });

  // 4 — the file SET is unchanged: nothing renamed, created or deleted.
  const beforeSlugs = opts.before.prospects.map((p) => p.slug).join(",");
  const afterSlugs = after.prospects.map((p) => p.slug).join(",");
  checks.push({
    name: "no prospect file was renamed, created or deleted",
    ok: beforeSlugs === afterSlugs,
    detail: beforeSlugs === afterSlugs ? `${after.prospects.length} files, unchanged set` : `before=[${beforeSlugs}] after=[${afterSlugs}]`,
  });

  // 5 — NO event was appended. Not "no business event": none at all. Identity is not history.
  const eventsAfter = (await readEvents()).length;
  checks.push({
    name: "the event spine is untouched",
    ok: eventsAfter === opts.eventCountBefore,
    detail: `before=${opts.eventCountBefore} after=${eventsAfter}`,
  });

  // 6 — §19 explicitly, because it is the number a mistake here would silently corrupt.
  const operatorAfter = await countOperatorBusinessEvents();
  checks.push({
    name: "operator business events unchanged (§19)",
    ok: operatorAfter === opts.operatorEventsBefore,
    detail: `before=${opts.operatorEventsBefore} after=${operatorAfter}`,
  });

  // 7 — identity uniqueness holds across the whole hit list.
  const index = await buildProspectIdIndex();
  checks.push({
    name: "no duplicate prospect_id in the vault",
    ok: index.violations.length === 0,
    detail: index.violations.length === 0 ? "none" : index.violations.map((v) => `${v.prospect_id}: ${v.slugs.join(", ")}`).join("; "),
  });

  // 8 — the reconciler sees no business transition. The vault's observable STATE is prospect
  // `status`, which the backfill never touches, so a transition here would mean something moved
  // that should not have.
  const reconciled = await reconcileVault();
  checks.push({
    name: "reconciler reports zero business transitions",
    ok: reconciled.transitions.length === 0,
    detail: reconciled.transitions.length === 0 ? "none" : reconciled.transitions.map((t) => t.type).join(", "),
  });

  // 9 — idempotence: re-planning finds nothing left to assign. Held entries legitimately remain,
  // and remain held; that is the blocking state Stage 2 is gated on, not an incomplete run.
  const replan = await planIdentityBackfill();
  const remaining = replan.entries.filter((e) => e.decision === "assign").length;
  checks.push({
    name: "re-planning proposes no further assignments",
    ok: remaining === 0,
    detail: remaining === 0 ? `0 to assign, ${replan.summary.held} still held` : `${remaining} remain`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

export function renderVerification(v: IdentityVerification): string {
  const lines = [`IDENTITY BACKFILL VERIFICATION · ${v.ok ? "PASS" : "FAIL"}`, ""];
  for (const c of v.checks) lines.push(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}\n          ${c.detail}`);
  return lines.join("\n") + "\n";
}