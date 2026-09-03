// core/intake/batch — THE SHEET SAID, as a batch and its rows (STAGE2-SHEETS-INTAKE §1.2, §1.3).
//
// ─── THIS MODULE ESTABLISHES FACTS ABOUT A SPREADSHEET. IT ESTABLISHES NOTHING ABOUT A BUSINESS. ─
//
// §0's separation is the whole architecture, and this file owns exactly one of its three authors:
//
//     THE SHEET SAID   here. verbatim, immutable, attributable to a batch.
//     ASCEND FOUND     the prospect projection — core/crm, core/db/prospects. NOT here.
//     A HUMAN JUDGED   never written by any import path, at any time.
//
// Nothing in this file writes a prospect, and nothing in it decides what a row MEANS. It parses,
// it identifies a batch, and it produces the record of what arrived.
//
// ─── WHY NOT `lib/csv`'s PARSER ────────────────────────────────────────────────────────────────
//
// `parseCsv` trims every cell (`lib/csv.ts`: `row[headers[j]] = (r[j] ?? "").trim()`). That is
// correct for the projection — a name with a stray space should not become a different slug — and
// it is FORBIDDEN for the evidence. §1.3: *"Verbatim means verbatim. No trimming, no case folding,
// no type coercion, no dropped empties, no header normalisation."*
//
// So the two coexist and neither is wrong. `parseSheetVerbatim` below preserves the bytes for the
// evidence; the projection may trim what it derives. A cell that is `"  Acme  "` is recorded as
// `"  Acme  "` and may still produce the slug `acme`. Losing the spaces in the RECORD would make it
// impossible to answer "what did the sheet actually say", which is the one question this store
// exists to answer.

import "server-only";
import { createHash } from "node:crypto";
import { uuidv7 } from "@/domain";

/** One row's cells, keyed by the header exactly as the sheet spelled it. */
export type SourceCells = Record<string, string>;

/**
 * An import is a first-class thing, not a transient action (§1.2).
 *
 * `actor` is not carried here: it is `"system"`, always (D-3), and is set where the event is
 * appended. A field that can only hold one value is a comment, not data.
 */
export type ImportBatch = {
  readonly batch_id: string;
  readonly label: string;
  readonly source_kind: "csv_paste" | "csv_upload";
  readonly source_name: string;
  /** sha256 of the exact bytes imported. */
  readonly file_sha256: string;
  readonly row_count: number;
  /** The exact mapping used, stored WITH the batch — so a re-read never has to guess it. */
  readonly column_map: Readonly<Record<string, string>>;
  readonly imported_at: string;
};

/**
 * One row, verbatim (§1.3).
 *
 * `prospect_id` is null when the row did not result in a prospect — blocked, ambiguous, or matched
 * to a client. The row is STILL KEPT, because "we received this row and did not act on it" is
 * exactly the fact a reviewer needs.
 */
export type SourceRow = {
  readonly row_id: string;
  readonly batch_id: string;
  readonly row_index: number;
  readonly prospect_id: string | null;
  readonly cells: SourceCells;
};

/**
 * Parse a sheet WITHOUT touching a single character of any cell.
 *
 * Headers are kept as spelled, including case and surrounding space — §1.4's first state is "column
 * absent from the sheet", and normalising a header would silently merge two columns the sheet kept
 * apart. Duplicate headers keep the LAST occurrence, matching `lib/csv`'s behaviour so the two
 * parsers cannot disagree about which column a value came from.
 *
 * A row shorter than the header list yields ABSENT keys for the missing columns, never `""` — the
 * difference between §1.4's "column absent" and "cell empty" is a fact this parser must not destroy.
 */
export function parseSheetVerbatim(input: string): { headers: string[]; rows: SourceCells[] } {
  const records = parseRecords(input);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0];
  const rows: SourceCells[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    // A single empty cell is a blank line, not a row of empties. Same rule `lib/csv` applies.
    if (r.length === 1 && r[0] === "") continue;
    const cells: SourceCells = {};
    for (let j = 0; j < headers.length; j++) {
      if (j < r.length) cells[headers[j]] = r[j];   // ABSENT when the row is short — never ""
    }
    rows.push(cells);
  }
  return { headers, rows };
}

/** sha256 of the exact bytes imported (§1.2). */
export function fileSha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Mint a batch from the bytes and the operator's framing.
 *
 * Re-importing the SAME bytes produces a NEW `batch_id` with the SAME `file_sha256` — §1.2 rules
 * that this is "a fact worth recording, not a duplicate to suppress", and the two fields are what
 * make that fact expressible. Nothing here deduplicates.
 */
export function mintBatch(input: {
  csv: string;
  label: string;
  sourceKind: ImportBatch["source_kind"];
  sourceName: string;
  columnMap: Record<string, string>;
  rowCount: number;
  now?: Date;
}): ImportBatch {
  return {
    batch_id: uuidv7(),
    label: input.label,
    source_kind: input.sourceKind,
    source_name: input.sourceName,
    file_sha256: fileSha256(input.csv),
    row_count: input.rowCount,
    column_map: { ...input.columnMap },
    imported_at: (input.now ?? new Date()).toISOString(),
  };
}

/** One source row, bound to its batch. `prospect_id` is filled by the projection, or stays null. */
export function sourceRow(
  batch: ImportBatch,
  rowIndex: number,
  cells: SourceCells,
  prospectId: string | null = null
): SourceRow {
  return {
    row_id: uuidv7(),
    batch_id: batch.batch_id,
    row_index: rowIndex,
    prospect_id: prospectId,
    cells: { ...cells },
  };
}

// ─── The verbatim record reader, kept private and byte-faithful ────────────────────────────────
//
// Deliberately a separate implementation from `lib/csv`'s rather than a shared one with a flag: the
// two have different contracts (that one normalises for the projection, this one preserves for the
// record), and a single function with a `trim: boolean` would make the guarantee depend on every
// caller passing the right argument. Same quoting rules — RFC-4180 doubled quotes, embedded commas
// and newlines — because the sheet's escaping is not a thing either parser may reinterpret.
function parseRecords(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  row.push(cell);
  out.push(row);
  return out;
}
