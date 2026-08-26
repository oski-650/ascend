// migration/registry — THE FIELD REGISTRY. The migration's coverage, declared once.
//
// docs/COVERAGE-MATRIX.md is the specification; this is its executable form. Every durable business
// fact the OS reads appears here exactly once, with its authoritative source and what the migration
// does about it.
//
// WHY A REGISTRY AND NOT A LIST OF STEPS. H6's first classifier enumerated the migration's own
// NARRATIVE — phases, documents, sidecars — and was complete-looking while missing an entire file
// (project_scope.md, the H7 failure). Coverage scoped by what the author remembered is the failure
// this project has now hit four times. The planner walks this table; it has no other source of
// truth, and a fitness test asserts the table covers every fact the matrix names.
//
// ADDING A FACT TO THE OS MEANS ADDING A ROW HERE. That is the point.

/** Where a fact physically lives. */
export type SourceKind =
  | "production_state"
  | "project_scope"
  | "business_context"
  | "structural_meta"
  | "invoices"
  | "time_log"
  | "audits"
  | "documents"
  | "automations_fired";

/** The fact's standing after SOURCE-AUTHORITY.md. */
export type Authority =
  /** The single source consumers read for this fact. */
  | "authoritative"
  /** A duplicate that lost; consumers no longer read it and the migration removes it. */
  | "retired"
  /** Prose/context, never read as state. */
  | "content"
  /** An append-only record that IS the evidence (invoices, audits, firings). */
  | "evidence";

/** What the migration does. */
export type Treatment =
  /** Scaffold-authored values become `unknown`; evidenced values survive. */
  | "demote-if-seeded"
  /** The field itself is removed — its authority moved elsewhere. */
  | "retire"
  /** Whole records removed when seeded or synthetic. */
  | "remove-if-fabricated"
  /** Kept as-is; the migration asserts nothing about it. */
  | "preserve"
  /** Deliberately NOT migrated. `blocked` says why. */
  | "record-only";

export type FieldRule = {
  /** The fact's name in COVERAGE-MATRIX.md. Used by the coverage gate. */
  fact: string;
  source: SourceKind;
  /** Dotted path, `phase.*.status` for the per-phase family, `*` for whole records. */
  field: string;
  authority: Authority;
  treatment: Treatment;
  /** Observed by core/reconciler ⇒ edits have provenance ⇒ re-baselining required. */
  observed: boolean;
  /** Required when treatment is `record-only`: why this fact cannot be migrated honestly. */
  blocked?: string;
  note: string;
};

export const FIELD_REGISTRY: readonly FieldRule[] = [
  // ── Production / delivery ────────────────────────────────────────────────────────────────────
  {
    fact: "phase status",
    source: "production_state",
    field: "phase.*.status",
    authority: "authoritative",
    treatment: "demote-if-seeded",
    observed: true,
    note: "The phase spine. Seeded histories demote to `unknown`; an evidenced launch survives.",
  },
  {
    fact: "phase start/completion dates",
    source: "production_state",
    field: "phase.*.dates",
    authority: "authoritative",
    treatment: "demote-if-seeded",
    observed: false,
    note:
      "Seeded dates are removed with their phase. An evidenced date gains `*_precision` and " +
      "`*_source` (H3.1 §3.2) — a day nobody knows must not be asserted because the format has a slot for one.",
  },
  {
    fact: "launch target",
    source: "production_state",
    field: "launch_target",
    authority: "authoritative",
    treatment: "demote-if-seeded",
    observed: false,
    note: "A date is not more objective for being well-formed. Seeded targets demote like any other fabrication.",
  },
  {
    fact: "industry template",
    source: "production_state",
    field: "industry_template",
    authority: "authoritative",
    treatment: "demote-if-seeded",
    observed: false,
    note:
      "A template CHOICE. Seeded for the scaffolded clients and defaulted to `generic` by intake. " +
      "Removing it leaves the SOP engine reporting hasTemplate:false, which is honest.",
  },
  {
    fact: "checklist state",
    source: "production_state",
    field: "checklist",
    authority: "authoritative",
    treatment: "record-only",
    observed: false,
    blocked:
      "A markdown checkbox has two states and neither is `unknown`. `[x]` asserts the step was done; " +
      "`[ ]` asserts it was not. For a seeded project both are false, so there is no honest edit — " +
      "the same vocabulary failure PhaseStatus had, one level down. Recorded, not fabricated in either direction.",
    note: "Seeded for the scaffolded clients (20 and 23 items).",
  },

  // ── Client identity & lifecycle ──────────────────────────────────────────────────────────────
  {
    fact: "client status",
    source: "structural_meta",
    field: "status",
    authority: "authoritative",
    treatment: "preserve",
    observed: true,
    note: "The observed identity anchor, and after Step 5 the input to the lifecycle rules.",
  },
  {
    fact: "commercial tier",
    source: "structural_meta",
    field: "tier",
    authority: "authoritative",
    treatment: "preserve",
    observed: true,
    note:
      "Authority assigned by SOURCE-AUTHORITY §4.4. PRESERVED WITHOUT VERIFICATION, deliberately: " +
      "since Step 5 severed tier from revenue it can no longer derive money, so a stale tier " +
      "misstates a package rather than a contract, and it is outside the historical correction this " +
      "migration performs. Building verification machinery for a field with no commercial " +
      "consequence would be scope this migration has no reason to carry. If tier ever regains " +
      "commercial consequence, this treatment must become a verifying one.",
  },
  {
    fact: "canonical website",
    source: "business_context",
    field: "website",
    authority: "authoritative",
    treatment: "preserve",
    observed: false,
    note: "Elite Vac's `.com` → `.co` is a confirmed correction, applied in place rather than as a second identity.",
  },
  {
    fact: "retainer state",
    source: "business_context",
    field: "retainer_active",
    authority: "authoritative",
    treatment: "preserve",
    observed: false,
    note:
      "Only Elite Vac declares it (`false`, intake-written). The care engine's invoice inference is " +
      "read-model provenance (Step 5), not vault state, so there is nothing to migrate.",
  },
  {
    fact: "retainer start date",
    source: "business_context",
    field: "retainer_started",
    authority: "authoritative",
    treatment: "preserve",
    observed: false,
    note: "Absent everywhere. Back-filled values are derived per read and labelled `inferred`.",
  },

  // ── Retired duplicates (SOURCE-AUTHORITY §4.5) ───────────────────────────────────────────────
  {
    fact: "phase (duplicate)",
    source: "project_scope",
    field: "phase",
    authority: "retired",
    treatment: "retire",
    observed: false,
    note: "Produced the post-migration contradiction: `phases.* = unknown` beside `phase: design`.",
  },
  {
    fact: "launch target (duplicate)",
    source: "project_scope",
    field: "launch_target",
    authority: "retired",
    treatment: "retire",
    observed: false,
    note: "Drove `launched_checkin`'s day count from a seeded date, unobserved by the spine.",
  },
  {
    fact: "client status (duplicate)",
    source: "project_scope",
    field: "status",
    authority: "retired",
    treatment: "retire",
    observed: false,
    note: "Behaviour-bearing but unobserved — the F21 violation Step 5 repaired.",
  },
  {
    fact: "package (duplicate)",
    source: "project_scope",
    field: "package",
    authority: "retired",
    treatment: "retire",
    observed: false,
    note: "Sole input to the catalog→revenue inference, severed in Step 5 before this retirement.",
  },
  {
    fact: "contract value",
    source: "project_scope",
    field: "revenue_usd",
    authority: "authoritative",
    treatment: "demote-if-seeded",
    observed: false,
    note:
      "The only admissible contract value — but NOT rescued by its name. A scaffold-authored " +
      "`revenue_usd` is exactly as fictional as a scaffold-authored `package`. Absent everywhere today.",
  },
  {
    fact: "scope content",
    source: "project_scope",
    field: "deliverables",
    authority: "content",
    treatment: "preserve",
    observed: false,
    note: "Prose and deliverables survive; only the state-bearing keys are retired.",
  },

  // ── Evidence records ─────────────────────────────────────────────────────────────────────────
  {
    fact: "invoice record",
    source: "invoices",
    field: "*",
    authority: "evidence",
    treatment: "remove-if-fabricated",
    observed: false,
    note:
      "Ascend-authored and exhaustive, so absence IS evidence. 6 of 8 live records are seeded. " +
      "LIMITATION: an invoice carries no creation timestamp — `issued_at` is a date the operator " +
      "chose, not a machine clock — so the temporal-clustering test that identified two synthetic " +
      "documents CANNOT be applied here. Only the `seed-` prefix distinguishes fabricated records, " +
      "and a record with neither marker is unclassifiable rather than proven genuine. See " +
      "docs/HISTORICAL-BACKFILL-H7B.md §5 for the one live instance.",
  },
  {
    fact: "time entry",
    source: "time_log",
    field: "*",
    authority: "evidence",
    treatment: "remove-if-fabricated",
    observed: false,
    note: "Seeded entries, plus UI-test artifacts below the real-work floor.",
  },
  {
    fact: "audit record",
    source: "audits",
    field: "*",
    authority: "evidence",
    treatment: "remove-if-fabricated",
    observed: false,
    note: "Fabricated PSI results.",
  },
  {
    fact: "document record",
    source: "documents",
    field: "*",
    authority: "evidence",
    treatment: "remove-if-fabricated",
    observed: true,
    note: "Seeded records, and synthetic ones identified by temporal clustering rather than id shape.",
  },
  {
    fact: "automation firing",
    source: "automations_fired",
    field: "*",
    authority: "evidence",
    treatment: "record-only",
    observed: false,
    blocked:
      "A firing is a real record of a real operator action — the operator did act on it. That its " +
      "TRIGGER was a fabricated invoice does not un-happen the action. Removing it would erase " +
      "history; keeping it leaves a firing whose cause disappears. Neither is obviously right, so " +
      "the migration asserts neither.",
    note: "`welcome-on-deposit::seed-inv-pilar-01` fired from a seeded deposit.",
  },
] as const;

/** Facts the migration deliberately does not touch, each with a reason. */
export function recordOnlyFacts(): readonly FieldRule[] {
  return FIELD_REGISTRY.filter((r) => r.treatment === "record-only");
}

export function rulesFor(source: SourceKind): readonly FieldRule[] {
  return FIELD_REGISTRY.filter((r) => r.source === source);
}

export function ruleFor(source: SourceKind, field: string): FieldRule | undefined {
  return FIELD_REGISTRY.find((r) => r.source === source && r.field === field);
}