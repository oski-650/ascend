// core/intake/evidence — THE SHEET SAID, appended and never rewritten (§1.2, §1.3, §7.3(c)).
//
// ─── APPEND-ONLY IS A GRANT HERE, NOT A CONVENTION ─────────────────────────────────────────────
//
// §7.3(c) chose the existing event spine over a new store for one reason above the others: `001`
// grants every application role `SELECT, INSERT` on `events` and NO UPDATE and NO DELETE. "Never
// overwritten" is therefore a database permission, not a promise this module makes. There is no
// update path in this file because there is no update path available to it.
//
// ─── WHAT IS RECORDED, AND WHAT IS NOT ─────────────────────────────────────────────────────────
//
//   RECORDED   the batch (§1.2) · every row verbatim (§1.3), including rows that produced nothing
//   NOT HERE   the prospect. That is ASCEND FOUND, written through core/crm's existing writer.
//   NEVER      judgment. No import path writes website_opportunity, assessed_by or assessed_at,
//              and `ascend_automation` holds no grant on those columns anyway.
//
// ─── ACTOR IS `system`, ALWAYS (D-3) ───────────────────────────────────────────────────────────
//
// Not a stylistic default. One paste of a spreadsheet produces N records, and COGNITION-OBSERVATION
// §19 measures operator-caused events per weekday against a pre-registered threshold — inheriting
// an "operator" actor would let a single import permanently inflate the number that gate exists to
// measure, and the log is append-only, so there is no correcting it afterwards.
//
// `app/api/import/prospects/route.ts` already made this ruling for the same reason. The schema
// agrees: `operator_events_name_their_human` and `system_events_name_no_human` mean a system event
// may not claim a human caused it.

import "server-only";
import type { OrganizationId } from "@/domain";
import type { SqlClient } from "@/core/db";
import { appendEvent } from "@/core/db/events";
import type { ImportBatch, SourceRow } from "./batch";

/**
 * Record that a batch arrived.
 *
 * `correlation_id` carries `batch_id` — that linkage is what makes every row of this import
 * findable later, and it is why §7.3(c) needed no new table. The batch's own fields ride in `data`
 * exactly as §1.2 lists them.
 */
export async function recordBatch(
  tx: SqlClient,
  organizationId: OrganizationId,
  batch: ImportBatch
): Promise<void> {
  await appendEvent(tx, organizationId, {
    type: "prospect.batch_imported",
    actor: "system",
    subject: { entity: "organization", entity_id: organizationId },
    correlation_id: batch.batch_id,
    data: {
      batch_id: batch.batch_id,
      label: batch.label,
      source_kind: batch.source_kind,
      source_name: batch.source_name,
      file_sha256: batch.file_sha256,
      row_count: batch.row_count,
      column_map: batch.column_map,
      imported_at: batch.imported_at,
    },
  });
}

/**
 * Record one row, verbatim.
 *
 * Called for EVERY row — including rows that produced no prospect. §1.3: the row is still kept,
 * "because 'we received this row and did not act on it' is exactly the fact a reviewer needs".
 * `prospect_id` is a FIELD on the record, never the subject: a row that matched nothing has no
 * prospect to point at, and pointing at one anyway would be the claim the null exists to withhold.
 */
export async function recordSourceRow(
  tx: SqlClient,
  organizationId: OrganizationId,
  row: SourceRow
): Promise<void> {
  await appendEvent(tx, organizationId, {
    type: "prospect.row_received",
    actor: "system",
    subject: { entity: "organization", entity_id: organizationId },
    correlation_id: row.batch_id,
    data: {
      row_id: row.row_id,
      batch_id: row.batch_id,
      row_index: row.row_index,
      prospect_id: row.prospect_id,
      cells: row.cells,
    },
  });
}
