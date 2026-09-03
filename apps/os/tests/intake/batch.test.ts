// Layer A — 2A · THE INTAKE FOUNDATION (STAGE2-SHEETS-INTAKE §1.2, §1.3, §1.4).
//
// The property under test is NARROW and it is the one everything downstream rests on: what arrived
// is recorded as it arrived. Every assertion below is about bytes, not about meaning.

import { describe, expect, it } from "vitest";
import { fileSha256, mintBatch, parseSheetVerbatim, sourceRow } from "@/core/intake/batch";
import { parseCsv } from "@/lib/csv";

describe("§1.3 · VERBATIM means verbatim", () => {
  it("preserves surrounding whitespace that lib/csv deliberately trims", () => {
    // THE DISCRIMINATING WITNESS for this whole module. If the evidence parser ever became a
    // wrapper around `lib/csv`, this fails — and it fails on the exact difference §1.3 names.
    const csv = 'name,city\n  Acme  ,  Modesto  \n';
    const verbatim = parseSheetVerbatim(csv);
    const normalised = parseCsv(csv);

    expect(verbatim.rows[0]["name"], "the evidence parser trimmed a cell").toBe("  Acme  ");
    expect(normalised.rows[0]["name"], "lib/csv stopped trimming — the two have converged").toBe("Acme");
    expect(verbatim.rows[0]["name"]).not.toBe(normalised.rows[0]["name"]);
  });

  it("preserves header spelling, case and spacing", () => {
    const { headers, rows } = parseSheetVerbatim('  Business Name ,WEBSITE\nAcme,x\n');
    expect(headers).toEqual(["  Business Name ", "WEBSITE"]);
    expect(rows[0]["  Business Name "]).toBe("Acme");
  });

  it("does not coerce, case-fold, or drop empties", () => {
    const { rows } = parseSheetVerbatim('a,b,c\n0001,TRUE,\n');
    expect(rows[0]["a"], "a leading-zero string was coerced").toBe("0001");
    expect(rows[0]["b"], "a boolean-looking cell was folded").toBe("TRUE");
    expect(rows[0]["c"], "an empty cell was dropped").toBe("");
  });

  it("§1.4 · an ABSENT column and an EMPTY cell are different facts", () => {
    // The distinction §1.4 says collapsing "is the D-1/D-2 failure returning". A short row leaves
    // the key ABSENT; a present-but-empty cell is "".
    const { rows } = parseSheetVerbatim('name,website\nAcme,\nBeta\n');
    expect("website" in rows[0], "row 0 lost its present-but-empty website column").toBe(true);
    expect(rows[0]["website"]).toBe("");
    expect("website" in rows[1], "a short row invented an empty cell").toBe(false);
  });

  it("handles quoting the way a sheet exports it", () => {
    const { rows } = parseSheetVerbatim('name,note\n"Tile & Marble","said ""yes"", then, paused"\n');
    expect(rows[0]["name"]).toBe("Tile & Marble");
    expect(rows[0]["note"]).toBe('said "yes", then, paused');
  });
});

describe("§1.2 · batch identity", () => {
  const opts = {
    csv: "name\nAcme\n", label: "Print Shop List", sourceKind: "csv_paste" as const,
    sourceName: "paste", columnMap: { name: "name" }, rowCount: 1,
  };

  it("re-importing the SAME bytes produces a NEW batch with the SAME file_sha256", () => {
    // §1.2 verbatim: "that is a fact worth recording, not a duplicate to suppress". Nothing here
    // deduplicates, and this asserts BOTH halves — a new identity AND a stable content hash.
    const a = mintBatch(opts);
    const b = mintBatch(opts);
    expect(a.batch_id).not.toBe(b.batch_id);
    expect(a.file_sha256).toBe(b.file_sha256);
    expect(a.file_sha256).toBe(fileSha256(opts.csv));
  });

  it("different bytes produce a different hash", () => {
    // Non-vacuity for the assertion above: if file_sha256 were constant, the first test would pass.
    expect(mintBatch(opts).file_sha256)
      .not.toBe(mintBatch({ ...opts, csv: "name\nBeta\n" }).file_sha256);
  });

  it("stores the column map WITH the batch, by value", () => {
    const map = { name: "Business Name" };
    const batch = mintBatch({ ...opts, columnMap: map });
    map.name = "MUTATED";
    expect(batch.column_map.name, "the batch aliased the caller's map").toBe("Business Name");
  });
});

describe("§1.3 · a source row is bound to its batch and copies its cells", () => {
  const batch = mintBatch({
    csv: "name\nAcme\n", label: "L", sourceKind: "csv_paste", sourceName: "p",
    columnMap: { name: "name" }, rowCount: 1,
  });

  it("carries batch_id, row_index, and a null prospect_id by default", () => {
    const row = sourceRow(batch, 0, { name: "Acme" });
    expect(row.batch_id).toBe(batch.batch_id);
    expect(row.row_index).toBe(0);
    expect(row.prospect_id, "a row claimed a prospect nobody created").toBeNull();
    expect(row.row_id).not.toBe(sourceRow(batch, 0, { name: "Acme" }).row_id);
  });

  it("copies the cells rather than aliasing them", () => {
    const cells = { name: "Acme" };
    const row = sourceRow(batch, 0, cells);
    cells.name = "MUTATED";
    expect(row.cells.name, "the row aliased the caller's cells").toBe("Acme");
  });
});
