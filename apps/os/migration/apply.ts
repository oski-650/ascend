// migration/apply — VAULT MUTATION, THEN BASELINE, THEN VERIFICATION.
//
// docs/HISTORICAL-BACKFILL-H5.md §4. Takes an already-reviewed Manifest; it never plans. Applying
// requires an explicit `confirm` flag, so no accidental call path mutates.
//
// THE HEADLINE INVARIANT (H6):
//
//   > The migration cannot create a business event whose factual timestamp is later than the
//     evidence supporting the fact.
//
// It is upheld structurally, not by care: this module calls `emitEvent` for exactly ONE type,
// `observation.captured`, always with `actor: "system"` passed EXPLICITLY — never inheriting the
// `?? "operator"` default in core/events, which would put migration activity into the §19 adoption
// measurement that is running concurrently.
//
// WHY A BASELINE AT ALL. The reconciler reconstructs its prior view by replaying
// `observation.captured`; the event log IS the observation state. Corrected state left un-baselined
// would be diffed against the seeded baseline on the next sync, and for status-bearing entities
// that emits `client.status_changed` / `prospect.status_changed` / `document.status_changed` dated
// today. Refusing to write the baseline does not avoid events — it delegates them to the reconciler.
//
// ORDERING. Mutate, then baseline from a FRESH observation of what was actually written. Deriving
// the baseline from the plan instead would let a write bug and its baseline agree with each other
// while both disagreed with the vault. For phases the ordering is not load-bearing — H4's epistemic
// guard makes both orders safe (H5 §4.2, pinned by reconciler STOP 5) — but for status entities the
// protection is procedural, which is why apply is idempotent and re-runnable.

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { crmDir, documentsDir, timeLogPath, invoiceLogPath, auditsLogPath } from "@/core/vault/paths";
import { readTextFile, writeFileAtomic } from "@/core/vault/markdown";
import { readJsonlFile } from "@/core/vault/io";
import { emitEvent } from "@/core/events";
import { observeVault } from "@/core/reconciler/observation";
import type { Manifest, ManifestEntry } from "./manifest";
import { validateManifest } from "./validate";

export type ApplyReport = {
  /** Fields rewritten in place. */
  mutated: number;
  /** Records removed. */
  removed: number;
  /** `observation.captured` baselines emitted. */
  baselines: number;
  /** Business events emitted. Structurally always 0; reported so a regression is visible. */
  businessEvents: 0;
  skipped: { entry: string; reason: string }[];
};

// ─── Frontmatter rewriting ─────────────────────────────────────────────────────────────────────
//
// Line-oriented and surgical, because a parse/serialize round-trip through a YAML library would
// reformat the operator's own file — reordering keys, restyling quotes, dropping comments. The
// vault is edited by a human in Obsidian; a migration that rewrites unrelated lines is a migration
// whose diff cannot be reviewed.

/**
 * Rewrite one phase's `status`, in either YAML form the vault actually uses.
 *
 * BOTH FORMS ARE REAL AND THE DIFFERENCE IS INVISIBLE TO READERS. `core/production` parses
 * frontmatter, so it sees these as identical:
 *
 *   block            onboarding:            inline      onboarding: { status: not_started }
 *                      status: not_started
 *
 * Elite Vac's file — written by the quarantined intake route — uses the inline form; the seeded
 * clients use the block form. A rewriter handling only one silently skips four phases on the one
 * client whose record was already the most honest in the vault. Caught by verifying against a
 * snapshot of the real vault rather than a fixture, which is the entire argument for doing so.
 */
function setPhaseStatus(source: string, phase: string, value: string): string | null {
  // Inline map: `  onboarding: { status: not_started }` (possibly with further keys).
  const inline = new RegExp(`(^[ \\t]*${phase}:[ \\t]*\\{[^}\\n]*?status:[ \\t]*)([^,}\\s]*)`, "m");
  if (inline.test(source)) return source.replace(inline, `$1${value}`);

  // Block map: `  onboarding:` then the first `status:` in its indented body.
  const block = new RegExp(
    `(^[ \\t]*${phase}:[ \\t]*\\r?\\n(?:[ \\t]+[^\\n]*\\r?\\n)*?[ \\t]+status:[ \\t]*)([^\\r\\n]*)`,
    "m"
  );
  if (block.test(source)) return source.replace(block, `$1${value}`);

  return null;
}

function setTopLevelScalar(source: string, key: string, value: string): string | null {
  const rx = new RegExp(`(^${key}:[ \\t]*)([^\\r\\n]*)`, "m");
  if (!rx.test(source)) return null;
  return source.replace(rx, `$1${value === "" ? '""' : value}`);
}

async function applyProjectEntry(e: ManifestEntry): Promise<"ok" | string> {
  const file = path.join(crmDir(), e.entity.id, "production_state.md");
  const source = await readTextFile(file);
  if (source === null) return "production_state.md unreadable";

  if (e.field === "launch_target") {
    const next = setTopLevelScalar(source, "launch_target", e.proposedValue ?? "");
    if (next === null) return "launch_target not found in frontmatter";
    await writeFileAtomic(file, next);
    return "ok";
  }

  const m = /^phase\.([a-z]+)\.status$/.exec(e.field);
  if (!m) return `unrecognised project field ${e.field}`;
  const next = setPhaseStatus(source, m[1], e.proposedValue ?? "unknown");
  if (next === null) return `phase ${m[1]} status not found`;
  await writeFileAtomic(file, next);
  return "ok";
}

async function applyClientEntry(e: ManifestEntry): Promise<"ok" | string> {
  const file = path.join(crmDir(), e.entity.id, "business_context.md");
  const source = await readTextFile(file);
  if (source === null) return "business_context.md unreadable";
  const next = setTopLevelScalar(source, "website", `'${e.proposedValue ?? ""}'`);
  if (next === null) return "website not found in frontmatter";
  await writeFileAtomic(file, next);
  return "ok";
}

async function applyDocumentRemoval(e: ManifestEntry): Promise<"ok" | string> {
  if (!e.currentValue) return "no path recorded";
  const file = path.join(documentsDir(), e.currentValue);
  try {
    await fs.rm(file);
    return "ok";
  } catch {
    return "already absent"; // idempotence: a second run finds nothing to do
  }
}

// ─── Sidecar row removal ───────────────────────────────────────────────────────────────────────

async function removeJsonlRows(absPath: string, ids: Set<string>): Promise<number> {
  if (ids.size === 0) return 0;
  const rows = await readJsonlFile<{ id?: string }>(absPath);
  const kept = rows.filter((r) => !(r.id && ids.has(r.id)));
  const dropped = rows.length - kept.length;
  if (dropped === 0) return 0;
  await writeFileAtomic(absPath, kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""));
  return dropped;
}

function idsFor(m: Manifest, prefix: string): Set<string> {
  const out = new Set<string>();
  for (const e of m.entries) {
    if (e.disposition !== "removed") continue;
    if (!e.field.startsWith(prefix + ".")) continue;
    out.add(e.field.slice(prefix.length + 1));
  }
  return out;
}

// ─── Baselines ─────────────────────────────────────────────────────────────────────────────────

/**
 * Re-baseline every entity the manifest touched, from a FRESH observation of the written vault.
 *
 * Uses the reconciler's own observer so the state and fingerprint are produced by exactly the code
 * that will later compare them. A hand-rolled fingerprint here would drift from the reconciler's
 * and the next sync would report phantom changes.
 */
async function writeBaselines(m: Manifest): Promise<number> {
  const targets = new Set(m.baselineTargets.map((t) => `${t.kind}:${t.id}`));
  if (targets.size === 0) return 0;

  const { observations } = await observeVault();
  let count = 0;
  for (const obs of observations) {
    if (!targets.has(obs.key)) continue;
    await emitEvent({
      type: "observation.captured",
      // EXPLICIT — never the `?? "operator"` default. §19 counts operator-caused events and is
      // being measured right now; migration activity must not enter that number.
      actor: "system",
      subject: { entity: obs.entity, entity_id: obs.entityId },
      data: {
        state_fingerprint: obs.stateFingerprint,
        content_fingerprint: obs.contentFingerprint,
        observed_state: obs.state,
        baseline: true,
        source: "historical_migration",
      },
    });
    count += 1;
  }
  return count;
}

// ─── Apply ─────────────────────────────────────────────────────────────────────────────────────

export async function applyMigration(
  manifest: Manifest,
  opts: { confirm: boolean }
): Promise<ApplyReport> {
  if (!opts.confirm) {
    throw new Error("applyMigration requires { confirm: true } — dry run is the default (H5 §5)");
  }
  const issues = validateManifest(manifest);
  if (issues.length > 0) {
    throw new Error(
      `manifest failed validation; nothing was written:\n` +
        issues.map((i) => `  ${i.entry}: ${i.problem}`).join("\n")
    );
  }

  const report: ApplyReport = { mutated: 0, removed: 0, baselines: 0, businessEvents: 0, skipped: [] };

  for (const e of manifest.entries) {
    let result: "ok" | string = "ok";
    if (e.entity.kind === "project" && /^phase\.|^launch_target$/.test(e.field)) {
      result = await applyProjectEntry(e);
      if (result === "ok") report.mutated += 1;
    } else if (e.entity.kind === "client") {
      result = await applyClientEntry(e);
      if (result === "ok") report.mutated += 1;
    } else if (e.entity.kind === "document" && e.disposition === "removed") {
      result = await applyDocumentRemoval(e);
      if (result === "ok") report.removed += 1;
    } else if (/^(time_entry|invoice|audit)\./.test(e.field)) {
      continue; // handled in bulk below — one rewrite per file, not one per row
    } else {
      result = `no applier for ${e.entity.kind}/${e.field}`;
    }
    if (result !== "ok") report.skipped.push({ entry: `${e.entity.kind}/${e.entity.id}#${e.field}`, reason: result });
  }

  report.removed += await removeJsonlRows(timeLogPath(), idsFor(manifest, "time_entry"));
  report.removed += await removeJsonlRows(invoiceLogPath(), idsFor(manifest, "invoice"));
  report.removed += await removeJsonlRows(auditsLogPath(), idsFor(manifest, "audit"));

  report.baselines = await writeBaselines(manifest);
  return report;
}