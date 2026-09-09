// components/sales/ImportProspectsPanel — the CSV import surface, as a client component.
//
// It moved out of `app/admin/import/page.tsx` in 2G.4.4 and out of `components/admin` in 2G.4.7,
// when the page it serves was reclassified from administration to sales. The page is a Server
// Component that awaits `listImportFields()` — guarded by `import:run` — and hands the result down,
// so a principal without that capability never reaches this markup at all. This file decides
// nothing: it renders the fields it is given and posts to a route that authorizes independently.
//
// ─── THE FOURTEEN DROPDOWNS ARE GONE (2026-09-04) ──────────────────────────────────────────────
//
// This component used to hold a "smart-guess" block — nine regexes run against a header line it
// split on "," itself — and then pre-fill fourteen `<select>` elements for the operator to approve.
// Two things were wrong with that, and the tab-separated import that created 3,193 garbage
// prospects needed both.
//
// The guess ran on the WRONG HEADERS. A tab-separated paste has no comma, so the split produced one
// header, every dropdown offered that single option, and the mapping was nonsense before the
// operator saw it. And the approval step made the nonsense look deliberate: a dropdown showing the
// wrong column and a dropdown showing the right one are the same UI.
//
// So the detection moved to the server, where the real parser lives, and the vocabulary to
// `core/crm/column-inference`, where the domain lives. What remains here is a REPORT: the delimiter
// that was read, the columns that were recognised, and the ones that were not. The operator's
// check is now reading an answer instead of assembling one — and the dry run still stands between
// that answer and the database.
//
// `fields` is still the guarded read. It supplies the human labels this report is written in, so
// the surface never invents a name for a field the domain already named.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportField } from "@/core/crm/import";

/** What the route reports back about how it read the sheet. */
type Detection = {
  headers: string[];
  delimiter: string;
  column_map: Record<string, string>;
  unmapped: string[];
  total_rows: number;
};

/** One row's fate on the Postgres path (`core/intake/import`). */
type Outcome =
  | { kind: "projected"; rowIndex: number; prospectId: string }
  | { kind: "recorded"; rowIndex: number; reason: string; refs?: string[] };

const DELIMITER_LABEL: Record<string, string> = {
  ",": "comma",
  "\t": "tab",
  ";": "semicolon",
  "|": "pipe",
};

export function ImportProspectsPanel({ fields }: { fields: readonly ImportField[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ slug: string; name: string; written: boolean; reason?: string }[] | null>(null);
  // The DEPLOYED store answers in `outcomes`, not `results` — one entry per row, projected or not.
  // The panel reported only the vault's shape until 2026-09-04, so a real Postgres import rendered
  // an empty results list and the operator learned nothing about what had just happened.
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  // Whether what is on screen came from a PREVIEW or from a write. The vault path reports both in
  // the same `results` shape, and "0/3 written" is an alarming way to say "nothing was written yet,
  // as promised" — the two need different words.
  const [wasDryRun, setWasDryRun] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ─── ONE REQUEST SHAPE FOR BOTH BUTTONS ──────────────────────────────────────────────────────
  //
  // No `column_map` is sent, ever. The route infers it from the headers ITS parser found, which is
  // the only way this surface can be sure the mapping and the parse agree about the sheet.
  async function run(dryRun: boolean) {
    setBusy(true);
    setErr(null);
    setResults(null);
    setOutcomes(null);
    try {
      const res = await fetch("/api/import/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, dry_run: dryRun, overwrite }),
      });
      const json = (await res.json()) as Partial<Detection> & {
        results?: typeof results;
        outcomes?: Outcome[];
        error?: string;
        detected?: Record<string, string>;
      };
      if (!res.ok) {
        setErr(json.error ?? "Import failed");
        // A refusal still carries what was read. Showing it is the difference between "no" and
        // "no, and here is the sheet I saw" — the latter is what lets the operator fix the file.
        if (json.headers) {
          setDetection({
            headers: json.headers, delimiter: json.delimiter ?? ",",
            column_map: json.detected ?? {}, unmapped: json.unmapped ?? [], total_rows: 0,
          });
        }
        return;
      }
      setDetection({
        headers: json.headers ?? [], delimiter: json.delimiter ?? ",",
        column_map: json.column_map ?? {}, unmapped: json.unmapped ?? [],
        total_rows: json.total_rows ?? 0,
      });
      setResults(json.results ?? []);
      setOutcomes(json.outcomes ?? null);
      setWasDryRun(dryRun);
      if (!dryRun) router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const writtenCount = useMemo(() => results?.filter((r) => r.written).length ?? 0, [results]);
  const mapped = useMemo(
    () => fields.filter((f) => detection?.column_map[f.key]),
    [fields, detection]
  );
  const missing = useMemo(
    () => fields.filter((f) => !detection?.column_map[f.key]),
    [fields, detection]
  );

  // §1.3 keeps every row, projected or not, and the reason it was not is the fact a reviewer needs.
  // Grouping is the only way to show that for a 3,000-row batch without printing 3,000 lines.
  const outcomeSummary = useMemo(() => {
    if (!outcomes) return null;
    const created = outcomes.filter((o) => o.kind === "projected").length;
    const reasons = new Map<string, number>();
    for (const o of outcomes) {
      if (o.kind === "recorded") reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1);
    }
    return { created, total: outcomes.length, reasons: [...reasons].sort((a, b) => b[1] - a[1]) };
  }, [outcomes]);

  return (
    <div>
      <div className="mb-6 border-b border-[var(--color-border-hi)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">sales · bulk import</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Import Prospects</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-mute)]">
          Paste your sheet — comma, tab, semicolon or pipe separated, with column headers in the first row.
          Ascend detects the separator and matches your column titles to prospect fields automatically.
          Preview first; nothing is written until you import.
        </p>
      </div>

      {/* Sheet input */}
      <section className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">step 1 · paste your sheet</h2>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={`company,industry,city,website,contact email\nValley Roofing,Roofing,Modesto,,hi@valleyroofing.com\nModesto HVAC,HVAC,Modesto,https://example.com,`}
          rows={10}
          className="w-full rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={busy || !csv.trim()}
            className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
          >
            {busy ? "…" : "Preview detection"}
          </button>
          {err && <span className="font-mono text-[11px] text-[var(--color-danger)]">{err}</span>}
        </div>
      </section>

      {/* What the server read */}
      {detection && (
        <section className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">step 2 · what Ascend read</h2>

          <p className="mb-4 font-mono text-[11px] text-[var(--color-fg-dim)]">
            {DELIMITER_LABEL[detection.delimiter] ?? "unknown"}-separated · {detection.headers.length} columns
            {detection.total_rows > 0 && <> · {detection.total_rows.toLocaleString()} data rows</>}
          </p>

          {mapped.length > 0 && (
            <ul className="mb-4 flex flex-col gap-1.5">
              {mapped.map((f) => (
                <li key={f.key} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono text-[var(--color-accent)]">✓</span>
                  <span className="font-mono text-[11px] text-[var(--color-fg)]">
                    {detection.column_map[f.key]}
                  </span>
                  <span className="text-[var(--color-fg-dim)]">→</span>
                  <span className="text-[var(--color-fg-mute)]">{f.label}</span>
                </li>
              ))}
            </ul>
          )}

          {/* NOT AN ERROR, AND SAID SO. An unmapped field is simply unstated — §1.4's rule is that
              a column the sheet does not have is not a value on the prospect. */}
          {missing.length > 0 && (
            <p className="mb-2 max-w-prose text-[11px] text-[var(--color-fg-dim)]">
              <span className="font-mono uppercase tracking-widest">not found</span> — left unset, not guessed:{" "}
              {missing.map((f) => f.label).join(", ")}
            </p>
          )}

          {detection.unmapped.length > 0 && (
            <p className="max-w-prose text-[11px] text-[var(--color-fg-dim)]">
              <span className="font-mono uppercase tracking-widest">ignored columns</span> — no matching prospect field:{" "}
              <span className="font-mono">{detection.unmapped.join(", ")}</span>
            </p>
          )}

          <label className="mt-4 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-fg-mute)]">Overwrite existing prospects with the same slug</span>
          </label>
        </section>
      )}

      {/* Run */}
      {detection && detection.total_rows > 0 && (
        <section className="sticky bottom-4 z-40 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-bg)]/95 p-4 backdrop-blur sm:p-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={busy}
              className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
            >
              {busy ? "Importing…" : `🚀 Import ${detection.total_rows.toLocaleString()} rows`}
            </button>
          </div>
          {err && <p className="mt-2 font-mono text-xs text-[var(--color-danger)]">{err}</p>}
        </section>
      )}

      {/* Results — the deployed (Postgres) store */}
      {outcomeSummary && (
        <section className="mt-6 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            results · {outcomeSummary.created.toLocaleString()}/{outcomeSummary.total.toLocaleString()} prospects created
          </h2>
          {outcomeSummary.reasons.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {outcomeSummary.reasons.map(([reason, n]) => (
                <li key={reason} className="font-mono text-[var(--color-fg-mute)]">
                  <span className="text-[var(--color-fg-dim)]">○</span> {n.toLocaleString()} —{" "}
                  <span className="text-[var(--color-fg-dim)]">{reason}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 max-w-prose text-[11px] text-[var(--color-fg-dim)]">
            Every row was recorded as evidence, including the ones that created nothing.
          </p>
        </section>
      )}

      {/* Results — the vault store */}
      {results && results.length > 0 && (
        <section className="mt-6 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            {wasDryRun
              ? `preview · ${results.length.toLocaleString()} rows read, nothing written`
              : `results · ${writtenCount.toLocaleString()}/${results.length.toLocaleString()} written`}
          </h2>
          {wasDryRun && (
            <p className="mb-3 max-w-prose text-[11px] text-[var(--color-fg-dim)]">
              The business name Ascend read from each row. If these look right, the mapping is right.
            </p>
          )}
          {/* A 3,000-row import must not render 3,000 list items. The first 200 are the sample; the
              count above is the answer. */}
          <ul className="flex flex-col gap-1 text-xs">
            {results.slice(0, 200).map((r, i) => (
              <li key={i} className="font-mono">
                <span className={r.written ? "text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}>
                  {r.written ? "✓" : "○"}
                </span>{" "}
                <span className="text-[var(--color-fg)]">{r.name}</span>
                {!wasDryRun && <span className="text-[var(--color-fg-dim)]"> — {r.reason}</span>}
                {r.written && (
                  <a href={`/sales/${r.slug}`} className="ml-2 text-[var(--color-accent)] hover:underline">
                    open →
                  </a>
                )}
              </li>
            ))}
          </ul>
          {results.length > 200 && (
            <p className="mt-2 font-mono text-[11px] text-[var(--color-fg-dim)]">
              … and {(results.length - 200).toLocaleString()} more
            </p>
          )}
        </section>
      )}
    </div>
  );
}
