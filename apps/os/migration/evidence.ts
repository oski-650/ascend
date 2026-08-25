// migration/evidence — WHAT THE MIGRATION IS ALLOWED TO BELIEVE, and on what grounds.
//
// docs/HISTORICAL-BACKFILL-H5.md §2. Two kinds of input, kept apart on purpose:
//
//   MECHANICAL   detectable from the records themselves (id prefixes, durations, timestamp
//                clustering). Reproducible by anyone reading the vault.
//   DECLARED     facts Oscar confirmed in the H0 inventory. Authoritative about WHAT happened,
//                never about WHEN (§2.1) — recollection may not set a date.
//
// Nothing here reads the filesystem or the clock. Callers pass records in; these are pure
// predicates, so the classifier they feed is deterministic by construction.

import "server-only";

/** Precedence, strongest first (H5 §2). A lower rung never becomes "known" for lack of a higher one. */
export const SOURCE_PRECEDENCE = [
  "observed-business-event",
  "external-system",
  "repository",
  "operator-confirmation",
  "unknown",
] as const;
export type SourceRung = (typeof SOURCE_PRECEDENCE)[number];

// ─── Mechanical detectors ──────────────────────────────────────────────────────────────────────

/**
 * Records the scaffold script authored carry a literal `seed-` id prefix.
 *
 * This is the ONLY id-shaped signal that is trustworthy, and only in this direction: a `seed-` id
 * proves fabrication, but a UUID proves nothing (see `isSyntheticTimestamp`).
 */
export function isSeededId(id: string): boolean {
  return id.startsWith("seed-");
}

/**
 * Known UI-testing sessions, as half-open ISO instants.
 *
 * WHY THIS EXISTS AS DATA. Two vault documents carry UUIDs and plausible 2026 timestamps and read
 * as genuine operator records. They were created 570 ms apart, inside the same evening session that
 * produced eleven time entries of 1–2 seconds and six checklist toggles flipping one item on and
 * off. The signature is temporal, not structural — so the detector has to be temporal too.
 *
 * A UUID and a plausible timestamp are NOT evidence of genuineness. Any classifier keying on id
 * format misclassifies exactly the records that matter most.
 */
export const TEST_SESSIONS: { from: string; to: string; note: string }[] = [
  {
    from: "2026-06-20T23:20:00.000Z",
    to: "2026-06-21T00:00:00.000Z",
    note: "2026-06-20 evening session: 2 documents 570ms apart, 11 time entries of 1–2s, checklist toggles",
  },
  {
    from: "2026-07-17T21:50:00.000Z",
    to: "2026-07-18T08:00:00.000Z",
    note: "2026-07-17/18 session: item_index 3 toggled on/off/on/off/on/off",
  },
];

export function isSyntheticTimestamp(iso: string | undefined): { hit: boolean; note: string } {
  if (!iso) return { hit: false, note: "" };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { hit: false, note: "" };
  for (const s of TEST_SESSIONS) {
    if (t >= Date.parse(s.from) && t < Date.parse(s.to)) return { hit: true, note: s.note };
  }
  return { hit: false, note: "" };
}

/**
 * A tracked interval too short to be work.
 *
 * Five seconds is not a judgement about productivity — it is the floor beneath which an entry
 * cannot represent a task at all, and every entry in the vault below it is a start/stop click pair.
 */
export const SYNTHETIC_DURATION_CEILING_SECONDS = 5;

export function isSyntheticDuration(seconds: number | undefined): boolean {
  return typeof seconds === "number" && seconds >= 0 && seconds <= SYNTHETIC_DURATION_CEILING_SECONDS;
}

// ─── Declared facts (H0, operator-confirmed) ───────────────────────────────────────────────────

export type DeclaredSubject = {
  slug: string;
  /** Whether this is genuinely a client. `false` excludes it from the migration entirely. */
  isClient: boolean;
  /** Confirmed package. `null` when never stated — an unstated tier must stay unstated. */
  tier: "starter" | "growth" | "ascend-pro" | null;
  canonicalDomain: string | null;
  /** True when every phase field for this project was authored by the scaffold script. */
  phaseHistorySeeded: boolean;
  /** True when `launch_target` was authored by the scaffold script and must demote with the rest. */
  launchTargetSeeded: boolean;
  note: string;
};

/**
 * The H0 inventory, as data.
 *
 * Bay Area Custom Shirts is ABSENT BY DECISION, not by oversight (H5 §6.6). Its record asserts that
 * a lead became a client; correcting that requires a vocabulary for "a fact was entered in error"
 * which the domain does not have, and inventing one inside a migration is exactly the quiet domain
 * decision this project refuses. `DECLARED_EXCLUSIONS` names it so its absence is legible.
 */
export const DECLARED_SUBJECTS: DeclaredSubject[] = [
  {
    slug: "decoraciones-pilar",
    isClient: true,
    tier: "growth",
    canonicalDomain: "https://decorpilar.com",
    phaseHistorySeeded: true,
    launchTargetSeeded: true,
    note: "Real client; every phase date, invoice, time entry, audit and document authored by scaffold-vault.mjs",
  },
  {
    slug: "tapia-tile-marble",
    isClient: true,
    tier: "growth",
    canonicalDomain: "https://tapiatilemarbleco.com",
    phaseHistorySeeded: true,
    launchTargetSeeded: true,
    note: "Real client, site live, final payment real — but live+paid does not reconstruct a phase history",
  },
  {
    slug: "elite-vac-service",
    isClient: true,
    tier: null,
    canonicalDomain: "https://elitevacservice.co",
    phaseHistorySeeded: false,
    launchTargetSeeded: false,
    note: "Launch 2022-03 derived from portfolio entry (month precision); pre-launch phases genuinely unknown",
  },
];

export const DECLARED_EXCLUSIONS: { slug: string; reason: string }[] = [
  {
    slug: "bay-area-custom-shirts-inc",
    reason:
      "H5 §6.6 — not a bad client record but a bad historical assertion that a lead became a client. " +
      "Needs a correction vocabulary the domain does not have. Excluded from this migration entirely.",
  },
];

export function declaredFor(slug: string): DeclaredSubject | undefined {
  return DECLARED_SUBJECTS.find((s) => s.slug === slug);
}

export function isExcluded(slug: string): boolean {
  return DECLARED_EXCLUSIONS.some((e) => e.slug === slug);
}