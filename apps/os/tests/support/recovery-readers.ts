// tests/support/recovery-readers — RT-1: the recovery proofs' prospect and note checks, done ONCE.
//
// ─── THE DEFECT THIS REPLACES ──────────────────────────────────────────────────────────────────
//
// D1b made `listProspects(tx)` the ACTIVE reader (`archived_at IS NULL`). Three recovery assertions
// kept treating it as "every prospect", and passed only because production held no archived rows:
//
//   R1b  restore-independence   listProspects(tx).length  vs  count(*) FROM prospects       (the TOTAL)
//   R1c  restore-same-version   listProspects(tx).length  vs  exp.prospects                  (the TOTAL)
//   R1c  restore-same-version   Σ listProspectNotes over listProspects(tx)  vs  every note    (notes on
//                                archived prospects silently SKIPPED — history not verified)
//
// and the R1a fixture held no archived prospect, so nothing could have caught any of it. The first
// real archival would have turned the next backup's recovery proof red for a reason that had nothing
// to do with recovery — or, for the notes check, quietly stopped verifying archived history.
//
// ─── THE SHAPE OF THE REPAIR ───────────────────────────────────────────────────────────────────
//
// Two independent measurements of the same database, compared field by field:
//
//   restoredProspectCounts      what the database HOLDS — raw SQL, no application reader involved
//   applicationProspectCounts   what the application's own readers RETURN
//
// Total, active and archived are separate numbers, each checked on its own, and active + archived must
// equal total. Notes are counted over EVERY prospect — the audit reader, never the active one — and the
// notes attached to archived prospects are reported separately, so "archived history survived" is an
// assertion rather than an assumption.
//
// One implementation, three callers (R1a, R1b, R1c). The fixture carries an archived prospect with
// history, so the code R1c runs against production is the code the fixture proves can fail.

import { listProspects, listProspectNotes, type SqlClient, type SqlValue } from "@/core/db";

export type ProspectCounts = {
  total: number;
  active: number;
  archived: number;
  /** every prospect_notes row, on every prospect — archived ones included */
  notes: number;
  /** the subset of `notes` attached to archived prospects: archived history, verified */
  notesOnArchived: number;
};

/** Anything that answers SQL: a pg `Client`, PGlite, or the application's `SqlClient`. */
type Queryable = { query<T>(sql: string, params?: readonly SqlValue[]): Promise<{ rows: T[] }> };

/** What the restored database HOLDS for one organization. Raw SQL; no application code. */
export async function restoredProspectCounts(db: Queryable, organizationId: string): Promise<ProspectCounts> {
  const [p] = (await db.query<{ total: number; active: number; archived: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE archived_at IS NULL)::int AS active,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived
       FROM prospects WHERE organization_id = $1`, [organizationId])).rows;
  const [n] = (await db.query<{ notes: number; on_archived: number }>(
    `SELECT count(*)::int AS notes,
            count(*) FILTER (WHERE p.archived_at IS NOT NULL)::int AS on_archived
       FROM prospect_notes n JOIN prospects p ON p.id = n.prospect
      WHERE p.organization_id = $1`, [organizationId])).rows;
  return { total: p.total, active: p.active, archived: p.archived, notes: n.notes, notesOnArchived: n.on_archived };
}

/**
 * What the APPLICATION'S READERS return, as the principal `tx` is bound to.
 *
 * `active` is the operator's reader. `total` and `archived` come from the AUDIT reader
 * (`includeArchived: true`). Notes are walked over the audit reader — walking the active one is
 * exactly the defect RT-1 repairs.
 */
export async function applicationProspectCounts(tx: SqlClient): Promise<ProspectCounts> {
  const active = await listProspects(tx);
  const all = await listProspects(tx, { includeArchived: true });
  let notes = 0;
  let notesOnArchived = 0;
  for (const p of all) {
    const n = (await listProspectNotes(tx, p.id)).length;
    notes += n;
    if (p.archivedAt !== null) notesOnArchived += n;
  }
  return {
    total: all.length,
    active: active.length,
    archived: all.filter((p) => p.archivedAt !== null).length,
    notes,
    notesOnArchived,
  };
}

/**
 * Every disagreement, as named lines — empty when the readers and the database agree completely.
 *
 * Returned rather than asserted so each suite keeps its own reporting style; every caller asserts the
 * result is `[]`. The internal-consistency line catches a database whose own counts don't add up.
 */
export function prospectCountMismatches(app: ProspectCounts, restored: ProspectCounts): string[] {
  const out: string[] = [];
  for (const k of ["total", "active", "archived", "notes", "notesOnArchived"] as const) {
    if (app[k] !== restored[k]) out.push(`${k}: application readers ${app[k]}, restored database ${restored[k]}`);
  }
  if (restored.active + restored.archived !== restored.total) {
    out.push(`restored database: active ${restored.active} + archived ${restored.archived} ≠ total ${restored.total}`);
  }
  return out;
}
