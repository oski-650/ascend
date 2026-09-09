// Minimal delimited-text parser — handles quoted fields, escaped quotes, embedded separators/newlines.
// No external deps.
//
// ─── THE DELIMITER IS DETECTED, NOT ASSUMED ────────────────────────────────────────────────────
//
// This parser split on "," and nothing else until 2026-09-04, when a 3,000-row TAB-separated lead
// list was pasted into `/sales/import`. Every line contained no comma, so every line parsed as ONE
// column, and 3,193 prospects were created with the entire line repeated into each mapped field.
// The import reported success the whole way: a single-column sheet is a legal sheet, so nothing in
// the pipeline had grounds to object.
//
// The lesson is not "support tabs". It is that the delimiter was an ASSUMPTION WEARING NO LABEL —
// unstated, unvalidated, and wrong in a way that produced confident garbage rather than an error.
// It is now derived from the bytes and reported alongside the parse, so a caller can say which
// separator it read and a reviewer can disagree with it.

export type CsvRow = Record<string, string>;

/**
 * The separators a pasted sheet may plausibly use.
 *
 * Ordered by preference, which is also the tie-break: a header line containing equal counts of two
 * candidates is read as comma-separated. Tabs are second because that is what Google Sheets,
 * Numbers and Excel put on the clipboard when a range is copied rather than exported — the exact
 * path that produced the bad import.
 */
export const CSV_DELIMITERS = [",", "\t", ";", "|"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Which separator this sheet uses, decided from its HEADER LINE ALONE.
 *
 * The header is the only line guaranteed to hold one separator between every pair of columns; data
 * rows may legitimately contain a stray comma or semicolon inside a quoted cell and would skew a
 * whole-file tally. Quoted regions are skipped for the same reason — `"Acme, Inc"` is one column,
 * and a header that says so must not be counted as two.
 *
 * A sheet with no candidate at all is a single-column sheet, and comma is returned. That is not a
 * guess: with one column there is no separator to be wrong about.
 *
 * `core/intake/batch.ts` carries a byte-identical copy of this function, deliberately — see the
 * note above `parseRecords` there, and `tests/intake/delimiter-agreement.test.ts`, which pins the
 * two to the same answer for the same input.
 */
export function detectDelimiter(input: string): CsvDelimiter {
  const counts = new Map<string, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { i++; continue; }
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === "\n") break; // the header line is the whole sample
    const seen = counts.get(ch);
    if (seen !== undefined) counts.set(ch, seen + 1);
  }

  let best: CsvDelimiter = ",";
  for (const d of CSV_DELIMITERS) {
    if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  }
  return best;
}

/**
 * Parse a sheet into trimmed rows, reporting the separator it read.
 *
 * `delimiter` is returned rather than kept private so the surface can SHOW the operator what was
 * detected. The 2026-09-04 import failed silently precisely because this decision was invisible;
 * a parse that announces its own assumption can be contradicted before it writes 3,000 rows.
 */
export function parseCsv(input: string): { headers: string[]; rows: CsvRow[]; delimiter: CsvDelimiter } {
  const delimiter = detectDelimiter(input);
  const records = parseRecords(input, delimiter);
  if (records.length === 0) return { headers: [], rows: [], delimiter };
  const headers = records[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    if (r.length === 1 && r[0] === "") continue; // skip blank lines
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (r[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows, delimiter };
}

function parseRecords(input: string, delimiter: CsvDelimiter): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // skip — treat \r\n as line break via the \n branch
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // flush trailing
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
