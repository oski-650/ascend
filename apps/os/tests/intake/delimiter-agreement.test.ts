// Delimiter detection, and the agreement between the two parsers that must never diverge.
//
// ─── WHAT THIS SUITE IS FOR ────────────────────────────────────────────────────────────────────
//
// On 2026-09-04 a 3,000-row TAB-separated lead list was pasted into `/sales/import`. Both parsers
// split on "," and nothing else, so every line became a single column, and 3,193 prospects were
// created carrying the whole line in each mapped field. Nothing errored: a one-column sheet is a
// legal sheet.
//
// `lib/csv` and `core/intake/batch` hold byte-identical copies of `detectDelimiter`, because
// `core/` imports nothing from `lib/` anywhere in this codebase. The copies are only safe while
// something proves they agree — the projection reads cells by header, the evidence records them by
// header, and a disagreement about where a column ends would silently attach values to the wrong
// column in one of the two.

import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, CSV_DELIMITERS } from "@/lib/csv";
import { parseSheetVerbatim } from "@/core/intake/batch";

const TSV = "company\tindustry\tcity\nValley Roofing\tRoofing\tModesto\nModesto HVAC\tHVAC\tModesto";
const CSV = "company,industry,city\nValley Roofing,Roofing,Modesto\nModesto HVAC,HVAC,Modesto";
const SSV = "company;industry;city\nValley Roofing;Roofing;Modesto";
const PSV = "company|industry|city\nValley Roofing|Roofing|Modesto";

describe("detectDelimiter", () => {
  it("reads a tab-separated sheet as tab-separated — the 2026-09-04 regression", () => {
    expect(detectDelimiter(TSV)).toBe("\t");
  });

  it("reads comma, semicolon and pipe sheets", () => {
    expect(detectDelimiter(CSV)).toBe(",");
    expect(detectDelimiter(SSV)).toBe(";");
    expect(detectDelimiter(PSV)).toBe("|");
  });

  it("decides from the header line, so a comma inside a data cell cannot outvote it", () => {
    const sheet = "company\tcity\nAcme, Inc\tModesto\nBeta, LLC\tTracy\nGamma, Co\tRipon";
    expect(detectDelimiter(sheet)).toBe("\t");
  });

  it("ignores separators inside quoted headers", () => {
    // One column, whose header legitimately contains three commas.
    expect(detectDelimiter('"company, inc, ltd, co"\nAcme')).toBe(",");
  });

  it("falls back to comma for a single-column sheet — there is no separator to be wrong about", () => {
    expect(detectDelimiter("company\nAcme\nBeta")).toBe(",");
  });

  it("prefers comma when two candidates tie", () => {
    expect(detectDelimiter("a,b;c\n1,2;3")).toBe(",");
  });
});

describe("parseCsv reads the detected delimiter", () => {
  it("splits a tab-separated sheet into real columns", () => {
    const parsed = parseCsv(TSV);
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.headers).toEqual(["company", "industry", "city"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ company: "Valley Roofing", industry: "Roofing", city: "Modesto" });
  });

  it("still trims cells, which is what separates it from the verbatim reader", () => {
    const parsed = parseCsv("company\tcity\n  Acme  \t  Modesto  ");
    expect(parsed.rows[0]).toEqual({ company: "Acme", city: "Modesto" });
  });

  it("reproduces the failure shape when the separator is genuinely absent", () => {
    // Not a bug — a sheet with no separator IS one column. The 2026-09-04 import looked like this
    // because the parser could not see the tabs, not because this outcome is wrong on its own.
    const parsed = parseCsv("a b c\n1 2 3");
    expect(parsed.headers).toEqual(["a b c"]);
  });
});

describe("the two parsers agree about where columns end", () => {
  const SHEETS = [
    TSV, CSV, SSV, PSV,
    "company\tcity\nAcme, Inc\tModesto",
    '"company, inc"\nAcme',
    "company\nAcme",
    "a,b;c\n1,2;3",
    'name\temail\n"Acme\tCo"\thi@acme.com',
    "name,notes\nAcme,\"line one\nline two\"",
  ];

  it("splits every sheet into the same headers", () => {
    for (const sheet of SHEETS) {
      expect(parseSheetVerbatim(sheet).headers.map((h) => h.trim()))
        .toEqual(parseCsv(sheet).headers);
    }
  });

  it("puts each row's values under the same column names", () => {
    for (const sheet of SHEETS) {
      const verbatim = parseSheetVerbatim(sheet);
      const normalised = parseCsv(sheet);
      expect(verbatim.rows).toHaveLength(normalised.rows.length);
      verbatim.rows.forEach((cells, i) => {
        for (const [header, value] of Object.entries(cells)) {
          // The verbatim reader keeps the bytes; the normalising one trims. Same column, same value
          // modulo that one documented difference.
          expect(normalised.rows[i][header.trim()]).toBe(value.trim());
        }
      });
    }
  });

  it("covers every delimiter the parser claims to support", () => {
    for (const d of CSV_DELIMITERS) {
      const sheet = `a${d}b${d}c\n1${d}2${d}3`;
      expect(detectDelimiter(sheet)).toBe(d);
      expect(parseSheetVerbatim(sheet).headers).toEqual(["a", "b", "c"]);
      expect(parseCsv(sheet).headers).toEqual(["a", "b", "c"]);
    }
  });
});
