"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddTargetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [runPsi, setRunPsi] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "fetching" | "auditing" | "done">("idle");
  const [result, setResult] = useState<{
    slug: string;
    name: string;
    website_quality: string;
    psi_performance: number | null;
    psi_error: string | null;
    extracted: { platform: string | null; phones: string[]; emails: string[]; social_count: number; location: string };
  } | null>(null);
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
      const json = (await res.json()) as {
        ok?: boolean;
        slug?: string;
        name?: string;
        website_quality?: string;
        psi_performance?: number | null;
        psi_error?: string | null;
        extracted?: typeof result extends infer T ? T extends null ? never : T["extracted"] : never;
        error?: string;
        reason?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? json.message ?? "Failed to intake target");
        return;
      }
      setResult({
        slug: json.slug!,
        name: json.name!,
        website_quality: json.website_quality!,
        psi_performance: json.psi_performance ?? null,
        psi_error: json.psi_error ?? null,
        extracted: json.extracted!,
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
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mb-4 rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)]"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-fg)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className={`inline-block text-[var(--color-accent)] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span>+ Add target from URL</span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          auto-extract · auto-audit
        </span>
      </summary>

      <form onSubmit={submit} className="border-t border-[var(--color-border-hi)] p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">prospect site URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://prospect-site.com"
              disabled={busy}
              required
              className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] disabled:opacity-60"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? phase === "auditing"
                ? "Running PSI… (15-30s)"
                : "Fetching…"
              : "Run intake"}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 text-[var(--color-fg-mute)]">
            <input
              type="checkbox"
              checked={runPsi}
              onChange={(e) => setRunPsi(e.target.checked)}
              disabled={busy}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Run Lighthouse audit
          </label>
          <label className="flex items-center gap-1.5 text-[var(--color-fg-mute)]">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={busy}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            Overwrite if exists
          </label>
        </div>

        {err && (
          <p className="mt-3 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 font-mono text-xs text-[var(--color-danger)]">
            {err}
          </p>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">intake complete</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-fg)]">{result.name}</p>
            <ul className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-[var(--color-fg-mute)]">
              {result.psi_performance !== null && (
                <li>
                  PSI mobile performance:{" "}
                  <span className={result.psi_performance >= 90 ? "text-[var(--color-accent)]" : result.psi_performance >= 50 ? "text-amber-300" : "text-[var(--color-danger)]"}>
                    {result.psi_performance}/100
                  </span>{" "}
                  → website_quality:{" "}
                  <span className="text-[var(--color-fg)]">{result.website_quality}</span>
                </li>
              )}
              {result.psi_error && (
                <li className="text-[var(--color-danger)]">PSI failed: {result.psi_error.slice(0, 120)}</li>
              )}
              {result.extracted.platform && <li>Platform detected: <span className="text-[var(--color-fg)]">{result.extracted.platform}</span></li>}
              {result.extracted.location && <li>Location: <span className="text-[var(--color-fg)]">{result.extracted.location}</span></li>}
              {result.extracted.phones.length > 0 && <li>Phones: <span className="text-[var(--color-fg)]">{result.extracted.phones.join(", ")}</span></li>}
              {result.extracted.emails.length > 0 && <li>Emails: <span className="text-[var(--color-fg)]">{result.extracted.emails.join(", ")}</span></li>}
              {result.extracted.social_count > 0 && <li>{result.extracted.social_count} social link{result.extracted.social_count === 1 ? "" : "s"} captured</li>}
            </ul>
            <a
              href={`/sales/${result.slug}`}
              className="mt-3 inline-block rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
            >
              Open {result.name} →
            </a>
          </div>
        )}
      </form>
    </details>
  );
}
