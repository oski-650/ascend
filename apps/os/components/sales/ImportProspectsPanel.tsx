// components/sales/ImportProspectsPanel — the CSV import surface, as a client component.
//
// It moved out of `app/admin/import/page.tsx` in 2G.4.4 and out of `components/admin` in 2G.4.7,
// when the page it serves was reclassified from administration to sales. The page is a Server
// Component that awaits `listImportFields()` — guarded by `import:run` — and hands the result down,
// so a principal without that capability never reaches this markup at all. This file decides
// nothing: it renders the fields it is given and posts to a route that authorizes independently.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportField } from "@/core/crm/import";

type ColumnMap = {
  name: string;
  business_type?: string;
  location?: string;
  status?: string;
  website?: string;
  website_quality?: string;
  decision_maker_access?: string;
  project_urgency?: string;
  niche_alignment?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  source?: string;
  notes?: string;
};

export function ImportProspectsPanel({ fields }: { fields: readonly ImportField[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRowCount, setParsedRowCount] = useState(0);
  const [columnMap, setColumnMap] = useState<ColumnMap>({ name: "" });
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ slug: string; name: string; written: boolean; reason?: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "previewed">("idle");

  // Quick client-side header detection (server is source of truth on actual parse)
  function previewHeaders() {
    setErr(null);
    setResults(null);
    setMode("idle");
    if (!csv.trim()) {
      setParsedHeaders([]);
      setParsedRowCount(0);
      return;
    }
    // Naive header line read — server will do the real parse
    const firstNewline = csv.indexOf("\n");
    const headerLine = firstNewline === -1 ? csv : csv.slice(0, firstNewline);
    const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    setParsedHeaders(headers);
    const remaining = firstNewline === -1 ? "" : csv.slice(firstNewline + 1);
    setParsedRowCount(remaining.split("\n").filter((l) => l.trim().length > 0).length);

    // Smart-guess obvious header → field mappings
    const guess: ColumnMap = { name: columnMap.name };
    for (const h of headers) {
      const low = h.toLowerCase();
      if (!guess.name && /^(name|business|company)$/i.test(low)) guess.name = h;
      if (!guess.business_type && /(industry|type|category)/i.test(low)) guess.business_type = h;
      if (!guess.location && /(location|city|region)/i.test(low)) guess.location = h;
      if (!guess.status && /^status$/i.test(low)) guess.status = h;
      if (!guess.website && /(website|url|domain)/i.test(low)) guess.website = h;
      if (!guess.contact_name && /(contact|owner)/i.test(low)) guess.contact_name = h;
      if (!guess.contact_phone && /phone/i.test(low)) guess.contact_phone = h;
      if (!guess.contact_email && /email/i.test(low)) guess.contact_email = h;
      if (!guess.notes && /(notes?|comments?|details)/i.test(low)) guess.notes = h;
    }
    if (!guess.name && headers.length > 0) guess.name = headers[0];
    setColumnMap({ ...columnMap, ...guess });
  }

  async function run(dryRun: boolean) {
    if (!columnMap.name) {
      setErr("Map a column to 'Business name' first");
      return;
    }
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/import/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, column_map: columnMap, dry_run: dryRun, overwrite }),
      });
      const json = (await res.json()) as { results?: typeof results; error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Import failed");
        return;
      }
      setResults(json.results ?? []);
      setMode("previewed");
      if (!dryRun) router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const writtenCount = useMemo(() => results?.filter((r) => r.written).length ?? 0, [results]);

  return (
    <div>
      <div className="mb-6 border-b border-[var(--color-border-hi)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">admin · bulk import</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Import Prospects from CSV</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-mute)]">
          Paste your CSV (export from Google Sheets, Numbers, etc.). The first row should be column headers. One row per
          prospect is converted to a markdown file in <code className="rounded bg-[var(--color-surface-hi)] px-1 py-0.5 font-mono text-[10px]">02 - Sales &amp; Hit List/</code>.
        </p>
      </div>

      {/* CSV input */}
      <section className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">step 1 · paste CSV</h2>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={`name,business_type,location,status,website\nValley Roofing,Roofing,Modesto,lead,\nModesto HVAC,HVAC,Modesto,contacted,https://example.com`}
          rows={10}
          className="w-full rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={previewHeaders}
            disabled={!csv.trim()}
            className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
          >
            Detect columns
          </button>
          {parsedHeaders.length > 0 && (
            <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
              {parsedHeaders.length} columns · {parsedRowCount} data rows
            </span>
          )}
        </div>
      </section>

      {/* Column mapping */}
      {parsedHeaders.length > 0 && (
        <section className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-mute)]">step 2 · map columns</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                  {f.label} {f.required && <span className="text-[var(--color-danger)]">*</span>}
                </span>
                <select
                  value={(columnMap[f.key as keyof ColumnMap] as string) ?? ""}
                  onChange={(e) => setColumnMap({ ...columnMap, [f.key]: e.target.value || undefined })}
                  className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">— (skip) —</option>
                  {parsedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                {f.hint && <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">{f.hint}</span>}
              </label>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-fg-mute)]">Overwrite existing prospect files with same slug</span>
          </label>
        </section>
      )}

      {/* Run actions */}
      {parsedHeaders.length > 0 && (
        <section className="sticky bottom-4 z-40 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-bg)]/95 p-4 backdrop-blur sm:p-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => run(true)}
              disabled={busy || !columnMap.name}
              className="rounded-md border border-[var(--color-border-hi)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-fg-mute)] hover:border-[var(--color-fg-mute)] hover:text-[var(--color-fg)] disabled:opacity-40"
            >
              {busy ? "…" : "Dry run (preview)"}
            </button>
            <button
              type="button"
              onClick={() => run(false)}
              disabled={busy || !columnMap.name}
              className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
            >
              {busy ? "Importing…" : "🚀 Import to vault"}
            </button>
          </div>
          {err && <p className="mt-2 font-mono text-xs text-[var(--color-danger)]">{err}</p>}
        </section>
      )}

      {/* Results */}
      {results && (
        <section className="mt-6 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            results · {writtenCount}/{results.length} written
          </h2>
          <ul className="flex flex-col gap-1 text-xs">
            {results.map((r, i) => (
              <li key={i} className="font-mono">
                <span className={r.written ? "text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}>
                  {r.written ? "✓" : "○"}
                </span>{" "}
                <span className="text-[var(--color-fg)]">{r.name}</span>{" "}
                <span className="text-[var(--color-fg-dim)]">— {r.reason}</span>
                {r.written && (
                  <a
                    href={`/sales/${r.slug}`}
                    className="ml-2 text-[var(--color-accent)] hover:underline"
                  >
                    open →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
