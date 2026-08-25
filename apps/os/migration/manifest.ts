// migration/manifest — WHAT THE MIGRATION INTENDS TO CHANGE, decided before anything changes.
//
// docs/HISTORICAL-BACKFILL-H5.md §10. The manifest is the human-review boundary: it is produced by
// a dry run that writes nothing, inspected, and only then applied.
//
//   > The migration must not discover what it thinks while simultaneously changing the vault.
//
// THE HEADLINE INVARIANT (H6):
//
//   > The migration cannot create a business event whose factual timestamp is later than the
//     evidence supporting the fact.
//
//   Operationally: historical correction may change what Ascend BELIEVES; it may not claim the
//   underlying business changed today. Every entry therefore declares `businessEvent: "none"` —
//   the field exists so that a future entry claiming otherwise is visible in review rather than
//   discovered in the event log.
//
// This module defines shape only. It reads nothing and writes nothing.

/**
 * Internal, migration-time evidence classes (H5 §1).
 *
 * DELIBERATELY NOT DOMAIN VOCABULARY. The business domain gained exactly one state (`unknown`, H4)
 * and gains nothing here. These names exist only long enough to decide a disposition; the reason a
 * record was removed lives in this manifest, never in a runtime schema.
 */
export type Classification =
  /** A real business fact, supported by evidence that survives §3's "proves / does not prove" test. */
  | "business-fact"
  /** Authored by scripts/scaffold-vault.mjs as population data. Demotes to `unknown`. */
  | "seeded"
  /** A real record of a non-real action — created by exercising the UI. Removed, never demoted. */
  | "synthetic"
  /** Reconstructed from artifacts; retained only while its evidence chain holds. */
  | "derived"
  /** Oscar stated it. Authoritative about what happened, not about when (§2.1). */
  | "confirmed";

/** The resulting business state. Three outcomes, not five — classification does not leak. */
export type Disposition = "known" | "unknown" | "removed";

/** How confident the classifier is that its classification is right. Never a probability. */
export type Confidence =
  /** The authoring source is identified — e.g. the literal appears in the scaffold script. */
  | "certain"
  /** Strong contextual evidence — e.g. temporal clustering inside a known test session. */
  | "high"
  /** Supported but incomplete — e.g. a portfolio entry giving a month but no day. */
  | "medium";

export type EntityRef = {
  kind: "project" | "client" | "prospect" | "document";
  id: string;
};

/**
 * One proposed change. Every field is required: an entry that cannot name its evidence is a bug in
 * the classifier, not an entry with a blank column.
 */
export type ManifestEntry = {
  entity: EntityRef;
  /** Dotted path within the entity, e.g. `phase.design.status`. `*` when the record itself goes. */
  field: string;
  /** Rendered for review. `null` means the field/record does not currently exist. */
  currentValue: string | null;
  /** `null` means removal. */
  proposedValue: string | null;
  classification: Classification;
  disposition: Disposition;
  /** Why the classifier believes this. Prose, aimed at the human reviewer. */
  evidence: string;
  confidence: Confidence;
  /** Whether the entity needs an observation baseline after the write (H5 §4). */
  baseline: "required" | "not-required";
  /**
   * Always "none". Present so that any future entry proposing otherwise is visible at review time.
   * @see the headline invariant above.
   */
  businessEvent: "none";
};

export type Manifest = {
  /**
   * Content version of the plan. NOT a timestamp: the manifest must be byte-identical across runs
   * over identical inputs, so nothing clock-derived may enter it (H6 determinism criterion).
   */
  version: 1;
  entries: ManifestEntry[];
  /** Entities that will need a baseline, derived from `entries`. Sorted, deduplicated. */
  baselineTargets: EntityRef[];
};

/** Stable sort key. Ordering is part of determinism, not presentation. */
export function entryKey(e: ManifestEntry): string {
  return `${e.entity.kind}/${e.entity.id}#${e.field}`;
}

export function sortEntries(entries: ManifestEntry[]): ManifestEntry[] {
  return [...entries].sort((a, b) => entryKey(a).localeCompare(entryKey(b)));
}

/** Derive the baseline target set from entries. Deterministic: sorted and deduplicated. */
export function baselineTargetsOf(entries: ManifestEntry[]): EntityRef[] {
  const seen = new Map<string, EntityRef>();
  for (const e of entries) {
    if (e.baseline !== "required") continue;
    seen.set(`${e.entity.kind}/${e.entity.id}`, e.entity);
  }
  return [...seen.keys()].sort().map((k) => seen.get(k) as EntityRef);
}

export function buildManifest(entries: ManifestEntry[]): Manifest {
  const sorted = sortEntries(entries);
  return { version: 1, entries: sorted, baselineTargets: baselineTargetsOf(sorted) };
}

/** Human-reviewable rendering. Deletions are itemised; nothing is summarised as a count (H5 §10.3). */
export function renderManifest(m: Manifest): string {
  if (m.entries.length === 0) return "MIGRATION MANIFEST · no changes proposed\n";
  const lines: string[] = [`MIGRATION MANIFEST · ${m.entries.length} proposed change(s)`, ""];
  for (const e of m.entries) {
    lines.push(
      `${e.entity.kind}/${e.entity.id}`,
      `  field:           ${e.field}`,
      `  change:          ${e.currentValue ?? "(absent)"} → ${e.proposedValue ?? "(removed)"}`,
      `  classification:  ${e.classification} ⇒ ${e.disposition}`,
      `  evidence:        ${e.evidence}`,
      `  confidence:      ${e.confidence}`,
      `  baseline:        ${e.baseline}`,
      `  business event:  ${e.businessEvent}`,
      ""
    );
  }
  lines.push(`baseline targets: ${m.baselineTargets.map((t) => `${t.kind}/${t.id}`).join(", ") || "none"}`);
  return lines.join("\n") + "\n";
}