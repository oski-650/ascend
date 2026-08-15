"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import {
  CHECKBOX_CLASS,
  FIELD_LABEL_CLASS,
  FORM_ERROR_CLASS,
  INPUT_CLASS,
} from "@/components/primitives/form";

/** Site intel summary returned by POST /api/prospects/from-url. */
type ExtractedSummary = {
  platform: string | null;
  phones: string[];
  emails: string[];
  social_count: number;
  location: string;
};

/** A completed intake, as held in component state. */
type IntakeResult = {
  slug: string;
  name: string;
  website_quality: string;
  psi_performance: number | null;
  psi_error: string | null;
  extracted: ExtractedSummary;
};

/**
 * The raw response body. Every field is optional because the same endpoint returns success,
 * validation-failure and conflict shapes. Previously this used a conditional-type expression that
 * indexed an unconstrained type parameter (`T["extracted"]`), which does not compile.
 */
type IntakeResponse = Partial<IntakeResult> & {
  ok?: boolean;
  error?: string;
  reason?: string;
  message?: string;
};

export function AddTargetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [runPsi, setRunPsi] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "fetching" | "auditing" | "done">("idle");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    setPhase(runPsi ? "auditing" : "fetching");
    try {
      const res = await fetch("/api/prospects/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), run_psi: runPsi, overwrite }),
      });
      const json = (await res.json()) as IntakeResponse;
      if (!res.ok || !json.ok) {
        setErr(json.error ?? json.message ?? "Failed to intake target");
        return;
      }
      // Validate rather than assert: a malformed success body would otherwise put `undefined`
      // into state and throw during render.
      if (!json.slug || !json.name || !json.website_quality || !json.extracted) {
        setErr("The server returned an incomplete response.");
        return;
      }
      setResult({
        slug: json.slug,
        name: json.name,
        website_quality: json.website_quality,
        psi_performance: json.psi_performance ?? null,
        psi_error: json.psi_error ?? null,
        extracted: json.extracted,
      });
      setPhase("done");
      setUrl("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // A plain disclosure rather than a card: intake is an occasional action, and a boxed panel
    // sitting above the index made it read as the page's main event.
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="border-b border-[var(--color-line)]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 [&::-webkit-details-marker]:hidden">
        <span className="t-body flex items-center gap-2 text-[var(--color-t2)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
          <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span>Add a target from its URL</span>
        </span>
        <span className="t-label text-[var(--color-t3)]">auto-extract · auto-audit</span>
      </summary>

      <form onSubmit={submit} className="border-t border-[var(--color-line)] py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>prospect site URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://prospect-site.com"
              disabled={busy}
              required
              className={INPUT_CLASS}
            />
          </label>
          {/* Amber is earned: this is the single committing action of an opened form. */}
          <Button type="submit" disabled={busy || !url.trim()} variant="primary">
            {busy ? (phase === "auditing" ? "Running PSI…" : "Fetching…") : "Run intake"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="t-meta flex items-center gap-1.5 text-[var(--color-t2)]">
            <input
              type="checkbox"
              checked={runPsi}
              onChange={(e) => setRunPsi(e.target.checked)}
              disabled={busy}
              className={CHECKBOX_CLASS}
            />
            Run Lighthouse audit
          </label>
          <label className="t-meta flex items-center gap-1.5 text-[var(--color-t2)]">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={busy}
              className={CHECKBOX_CLASS}
            />
            Overwrite if exists
          </label>
        </div>

        {err && <p className={`mt-3 ${FORM_ERROR_CLASS}`}>{err}</p>}

        {result && (
          // A left accent rule rather than a tinted card — the same treatment ranked items use.
          <div className="relative mt-5 border-l border-[var(--color-accent)]/45 pl-4">
            <p className="t-label text-[var(--color-accent)]">intake complete</p>
            <p className="t-h2 mt-1 text-[var(--color-t1)]">{result.name}</p>
            <ul className="t-mono mt-2 flex flex-col gap-1 text-[var(--color-t2)]">
              {result.psi_performance !== null && (
                <li>
                  {/* The raw PSI score is stated as a FACT and left uncolored. Coloring it here
                      would mean re-deriving the Lighthouse bands the Site Quality Engine owns, and
                      that engine digests STORED audits — this number has no audit record yet. The
                      API's own `website_quality` verdict is shown beside it instead. */}
                  PSI mobile performance:{" "}
                  <span className="text-[var(--color-t1)]">{result.psi_performance}/100</span>
                  {" → website_quality: "}
                  <span className="text-[var(--color-t1)]">{result.website_quality}</span>
                </li>
              )}
              {result.psi_error && (
                <li className="text-[var(--color-risk)]">PSI failed: {result.psi_error.slice(0, 120)}</li>
              )}
              {result.extracted.platform && <li>Platform detected: <span className="text-[var(--color-t1)]">{result.extracted.platform}</span></li>}
              {result.extracted.location && <li>Location: <span className="text-[var(--color-t1)]">{result.extracted.location}</span></li>}
              {result.extracted.phones.length > 0 && <li>Phones: <span className="text-[var(--color-t1)]">{result.extracted.phones.join(", ")}</span></li>}
              {result.extracted.emails.length > 0 && <li>Emails: <span className="text-[var(--color-t1)]">{result.extracted.emails.join(", ")}</span></li>}
              {result.extracted.social_count > 0 && <li>{result.extracted.social_count} social link{result.extracted.social_count === 1 ? "" : "s"} captured</li>}
            </ul>
            {/* ACTION → ENTITY: intake creates a prospect, so the next step is that prospect.
                A full navigation (not a Link) is deliberate — the router.refresh() above has
                already re-read the vault, and the new file is on disk. */}
            <a href={`/sales/${result.slug}`} className="mt-3 inline-block">
              <Button variant="primary">Open {result.name} →</Button>
            </a>
          </div>
        )}
      </form>
    </details>
  );
}
