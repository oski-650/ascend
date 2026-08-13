// Minimal CSV parser — handles quoted fields, escaped quotes, embedded commas/newlines.
// No external deps.

export type CsvRow = Record<string, string>;

export function parseCsv(input: string): { headers: string[]; rows: CsvRow[] } {
  const records = parseRecords(input);
  if (records.length === 0) return { headers: [], rows: [] };
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
  return { headers, rows };
}

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
    if (ch === ",") {
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
