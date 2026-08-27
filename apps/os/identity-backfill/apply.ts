// identity-backfill/apply — WRITE THE NAMES, AND NOTHING ELSE.
//
// Requires an explicit `confirm`, exactly like `migration/apply` and `onboarding/apply`. Dry run is
// the default and the default is what runs if you forget.
//
// WHY THIS MODULE HAS NO WRITE PRIMITIVE OF ITS OWN. Every write goes through
// `core/crm.createProspect`, the sole durable prospect writer (F21, F29). That is not politeness —
// it is what makes three separate guarantees apply here for free:
//
//   • the id-resolution ladder (an id already on disk always wins) — so a concurrent anchor
//     cannot be clobbered by this tool
//   • the uniqueness check against the live index — so a colliding id is REJECTED, not written
//   • the exactly-once emission rule — and this is the important one, below
//
// NO EVENT IS EMITTED. AT ALL.
//
// `createProspect` emits `prospect.created` only when no file existed at that slug. Every file this
// module touches already exists, so the emission branch is never reached: the backfill is
// event-silent by construction rather than by a flag someone could flip. That is the outcome Stage 1
// asked for — "prefer no new event at all if the existing architecture permits identity-only
// backfill without creating a business event" — and the existing architecture permits it exactly.
//
// `actor: "system"` is passed anyway, defensively. If some future edit made the emission branch
// reachable (a file deleted between plan and apply, say), the event that escaped would be
// system-attributed rather than silently counting toward §19's operator-adoption measurement. It
// costs nothing and it removes a way to be wrong.
//
// WHAT IS DELIBERATELY NOT DONE HERE: no file is renamed, no record is merged or deleted, no
// business field is read or rewritten, no relationship is repointed, and no held prospect is
// touched. The scope is one frontmatter line per assigned file.

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { readTextFile } from "@/core/vault/markdown";
import { createProspect } from "@/core/crm";
import { readEvents } from "@/core/events";
import { sha256 } from "./snapshot";
import { validateIdentityManifest, type IdentityBackfillManifest } from "./plan";

export type IdentityBackfillReport = {
  anchored: { slug: string; prospectId: string }[];
  /** Entries the plan did not act on, each with the reason — a skip is never silent. */
  skipped: { slug: string; reason: string }[];
  /** Held entries, restated so the report is self-contained for a reviewer. */
  held: { slug: string; reason: string }[];
  /** Events in the spine before and after. Structurally equal; reported so a regression shows. */
  eventsBefore: number;
  eventsAfter: number;
};

export class IdentityBackfillRefused extends Error {}

/**
 * Apply a REVIEWED manifest.
 *
 * DRIFT IS A REFUSAL, NOT A MERGE. Every target file is re-read and re-hashed against the snapshot
 * the manifest was planned from. If the bytes changed since the plan was reviewed, that entry is
 * skipped — the human reviewed a file that no longer exists in that form, and applying anyway would
 * make the review meaningless.
 */
export async function applyIdentityBackfill(
  manifest: IdentityBackfillManifest,
  opts: { confirm: boolean }
): Promise<IdentityBackfillReport> {
  if (!opts.confirm) {
    throw new IdentityBackfillRefused(
      "applyIdentityBackfill requires { confirm: true } — dry run is the default"
    );
  }

  const issues = validateIdentityManifest(manifest);
  if (issues.length > 0) {
    throw new IdentityBackfillRefused(
      `manifest failed validation; nothing was written:\n${issues.map((i) => `  ${i.slug}: ${i.problem}`).join("\n")}`
    );
  }

  const eventsBefore = (await readEvents()).length;
  const report: IdentityBackfillReport = {
    anchored: [],
    skipped: [],
    held: manifest.entries
      .filter((e) => e.decision === "held")
      .map((e) => ({ slug: e.slug, reason: e.holdReason ?? "held" })),
    eventsBefore,
    eventsAfter: eventsBefore,
  };

  for (const entry of manifest.entries) {
    if (entry.decision !== "assign") continue;

    const filePath = path.join(hitListDir(), `${entry.slug}.md`);
    const current = await readTextFile(filePath);
    if (current === null) {
      report.skipped.push({ slug: entry.slug, reason: "file disappeared between plan and apply" });
      continue;
    }
    if (sha256(current) !== entry.contentSha256) {
      report.skipped.push({
        slug: entry.slug,
        reason: "file changed since the plan was reviewed — re-plan and review again",
      });
      continue;
    }

    // The manifest's id, never a freshly minted one: `apply` executes the reviewed decision. The
    // writer inserts it and preserves every other byte (core/crm.setProspectId).
    const result = await createProspect(entry.slug, current, {
      overwrite: true,
      prospectId: entry.proposedProspectId!,
      actor: "system",
    });

    if (!result.written) {
      report.skipped.push({ slug: entry.slug, reason: result.code ?? "writer refused" });
      continue;
    }
    report.anchored.push({ slug: entry.slug, prospectId: String(result.prospectId) });
  }

  report.eventsAfter = (await readEvents()).length;
  return report;
}