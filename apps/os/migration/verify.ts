// migration/verify — PROVING THE MIGRATION CLAIMED NOTHING.
//
// docs/HISTORICAL-BACKFILL-H5.md §7. Runs AFTER apply and answers the questions the manifest cannot
// answer about itself: did the vault end up where the plan said, and did anything slip into history?
//
// Reads and computes. Writes nothing, emits nothing.

import "server-only";
import { readEvents } from "@/core/events";
import { reconcileVault } from "@/core/reconciler";
import { planMigration } from "./plan";

export type VerificationResult = {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
};

/**
 * Count business events attributed to the operator.
 *
 * This is the §19 guard, and it is deliberately a COUNT over the log rather than an assertion that
 * `emitEvent` was not called. "We don't call it" is a claim about today's code; some indirect path
 * — a reconciler run, a helper that grew a write — could violate the assumption later. Counting the
 * log tests the property itself.
 */
export async function countOperatorBusinessEvents(): Promise<number> {
  const events = await readEvents();
  return events.filter((e) => e.actor === "operator" && e.type !== "observation.captured").length;
}

export async function verifyMigration(opts: {
  operatorEventsBefore: number;
  /** The report from `applyMigration`, when available — a skipped entry is a failure, not a note. */
  applyReport?: { skipped: { entry: string; reason: string }[] };
}): Promise<VerificationResult> {
  const checks: VerificationResult["checks"] = [];

  // 0 — a planned change that did not apply means the plan and the vault disagree. It surfaces in
  // the re-plan check below too, but named here so the CAUSE is visible rather than the symptom.
  if (opts.applyReport) {
    const skipped = opts.applyReport.skipped;
    checks.push({
      name: "every planned change was applied",
      ok: skipped.length === 0,
      detail: skipped.length === 0 ? "none skipped" : skipped.map((s) => `${s.entry} (${s.reason})`).join("; "),
    });
  }

  // 1 — §19: the adoption measurement is running concurrently and must be untouched.
  const after = await countOperatorBusinessEvents();
  checks.push({
    name: "operator business events unchanged",
    ok: after === opts.operatorEventsBefore,
    detail: `before=${opts.operatorEventsBefore} after=${after}`,
  });

  // 2 — the decisive one. If the baselines are right, the reconciler sees nothing to report; a
  // single transition means a baseline was wrong and history was fabricated.
  const report = await reconcileVault();
  checks.push({
    name: "reconciler reports zero business transitions",
    ok: report.transitions.length === 0,
    detail: report.transitions.length === 0 ? "none" : report.transitions.map((t) => t.type).join(", "),
  });

  // 3 — idempotence: re-planning against the migrated vault must find nothing left to do.
  const replan = await planMigration();
  checks.push({
    name: "re-planning produces an empty manifest",
    ok: replan.entries.length === 0,
    detail: replan.entries.length === 0 ? "empty" : `${replan.entries.length} entries remain`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}