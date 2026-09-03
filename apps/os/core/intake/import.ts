// core/intake/import — one batch, recorded and projected, in ONE transaction (§7.3(c)/(d)).
//
// ─── THE ORDER IS THE CONTRACT ─────────────────────────────────────────────────────────────────
//
//     1  record the batch          THE SHEET SAID
//     2  for each row:  project    ASCEND FOUND, through the EXISTING writer
//                       record     THE SHEET SAID, with the prospect_id it produced (or null)
//
// Evidence is written for EVERY row, including rows that project nothing. §1.3: the row is kept
// "because 'we received this row and did not act on it' is exactly the fact a reviewer needs".
//
// ONE TRANSACTION. The batch, its rows and the prospects commit together or not at all — the same
// atomicity `core/db/prospects` gained over the vault, where "writeFileAtomic then emitEvent are two
// operations, and a crash between them left a prospect with no memory of being created".
//
// ─── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────────────────────
//
//   no UPDATE of an existing prospect   a second import ADDS evidence; it does not rewrite a row.
//                                       §7.3(d)'s "changed row" case updates the projection through
//                                       a path a later slice owns — this one creates, or records
//                                       that it did not. Nothing here overwrites anything.
//   no delete, ever                     §7.3(e): absence from a later sheet is not evidence of
//                                       absence. A row that stops appearing is simply not in that
//                                       batch's evidence.
//   no judgment                         unreachable by type; see ./projection.
//   no markdown                         Postgres is the prospect store (§7.3(c)). No file is
//                                       written, and the six existing markdown prospects are
//                                       untouched.

import "server-only";
import type { OrganizationId, UserId } from "@/domain";
import type { SqlClient } from "@/core/db";
import { createProspect } from "@/core/db";
import { mintBatch, parseSheetVerbatim, sourceRow, type ImportBatch } from "./batch";
import { recordBatch, recordSourceRow } from "./evidence";
import { projectRow, type ColumnMap } from "./projection";

export type ImportOutcome =
  /** A prospect was created and the row carries its id. */
  | { readonly kind: "projected"; readonly rowIndex: number; readonly prospectId: string }
  /** Evidence recorded; nothing projected, and why. */
  | { readonly kind: "recorded"; readonly rowIndex: number; readonly reason: string };

export type ImportResult = {
  readonly batch: ImportBatch;
  readonly outcomes: readonly ImportOutcome[];
};

/**
 * Import one sheet.
 *
 * `actor` is `system` for the reason D-3 gives and the schema enforces: one paste produces N
 * records, and attributing them to a human would inflate the operator-event count §19 measures.
 * `createdBy` still names the person whose session ran it — that is provenance on the ROW, not
 * authorship of the EVENT, and the two are deliberately different questions.
 */
export async function importSheet(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: {
    csv: string;
    label: string;
    sourceKind: ImportBatch["source_kind"];
    sourceName: string;
    columnMap: ColumnMap;
    createdBy?: UserId | null;
  }
): Promise<ImportResult> {
  const parsed = parseSheetVerbatim(input.csv);
  const batch = mintBatch({
    csv: input.csv,
    label: input.label,
    sourceKind: input.sourceKind,
    sourceName: input.sourceName,
    columnMap: input.columnMap,
    rowCount: parsed.rows.length,
  });

  await recordBatch(tx, organizationId, batch);

  const outcomes: ImportOutcome[] = [];
  for (const [rowIndex, cells] of parsed.rows.entries()) {
    const projection = projectRow(cells, input.columnMap);

    if (projection.kind === "skipped") {
      // Evidence FIRST and regardless. A row that named nothing is still a row that arrived.
      await recordSourceRow(tx, organizationId, sourceRow(batch, rowIndex, cells, null));
      outcomes.push({ kind: "recorded", rowIndex, reason: projection.reason });
      continue;
    }

    const row = await createProspect(
      tx,
      organizationId,
      { ...projection.input, createdBy: input.createdBy ?? null },
      { kind: "system" }
    );
    // The evidence carries the id the projection produced — §1.3's `prospect_id`, which is a FIELD
    // on the record and never its subject.
    await recordSourceRow(tx, organizationId, sourceRow(batch, rowIndex, cells, row.prospectId ?? row.id));
    outcomes.push({ kind: "projected", rowIndex, prospectId: row.prospectId ?? row.id });
  }

  return { batch, outcomes };
}
