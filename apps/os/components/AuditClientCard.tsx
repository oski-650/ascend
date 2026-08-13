import Link from "next/link";
import type { Audit, AuditStrategy } from "@/lib/audits";
import type { CareClient } from "@/lib/care";
import { ScoreSparkline } from "./ScoreSparkline";
import { RunAuditButton } from "./RunAuditButton";

function scoreColor(score: number | null): string {
  if (score === null) return "text-[var(--color-fg-dim)]";
  if (score >= 90) return "text-[var(--color-accent)]";
  if (score >= 50) return "text-amber-300";
  return "text-[var(--color-danger)]";
}

function fmtMs(n: number | null): string {
  if (n === null) return "—";
  return `${(n / 1000).toFixed(2)}s`;
}

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

function StrategyBlock({
  strategy,
  latest,
  history,
  client,
  url,
}: {
  strategy: AuditStrategy;
  latest: Audit | null;
  history: Audit[];
  client: string;
  url: string;
}) {
  const values = history.map((h) => h.scores.performance);
  const delta = (() => {
    if (history.length < 2) return null;
    const a = history[history.length - 2].scores.performance;
    const b = history[history.length - 1].scores.performance;
    if (a === null || b === null) return null;
    return b - a;
  })();

  return (
    <div className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          {strategy}
        </span>
        <RunAuditButton client={client} url={url} strategy={strategy} />
      </div>

      {latest ? (
        <>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <p className={`font-mono text-2xl font-bold tabular-nums ${scoreColor(latest.scores.performance)}`}>
                {latest.scores.performance ?? "—"}
              </p>
              <p className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                {daysAgo(latest.run_at)}
                {delta !== null && (
                  <span className={delta >= 0 ? " text-[var(--color-accent)]" : " text-[var(--color-danger)]"}>
                    {" "}({delta >= 0 ? "+" : ""}{delta})
                  </span>
                )}
              </p>
            </div>
            <ScoreSparkline values={values} />
          </div>

          <div className="grid grid-cols-2 gap-1 border-t border-[var(--color-border-hi)] pt-2 font-mono text-[10px]">
            <Mini label="a11y" value={latest.scores.accessibility} colorize />
            <Mini label="best practices" value={latest.scores.best_practices} colorize />
            <Mini label="SEO" value={latest.scores.seo} colorize />
            <Mini label="LCP" value={fmtMs(latest.cwv.lcp_ms)} />
            <Mini label="CLS" value={latest.cwv.cls ?? "—"} />
            <Mini label="TTFB" value={fmtMs(latest.cwv.ttfb_ms)} />
          </div>
        </>
      ) : (
        <p className="font-mono text-[11px] text-[var(--color-fg-dim)]">no audit yet — click ▶ to run</p>
      )}
    </div>
  );
}

function Mini({ label, value, colorize }: { label: string; value: number | string | null; colorize?: boolean }) {
  const displayValue = value === null ? "—" : value;
  const cls = colorize && typeof value === "number" ? scoreColor(value) : "text-[var(--color-fg)]";
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[var(--color-fg-dim)]">{label}</span>
      <span className={`font-semibold tabular-nums ${cls}`}>{displayValue}</span>
    </div>
  );
}

export function AuditClientCard({
  client,
  mobileHistory,
  desktopHistory,
}: {
  client: CareClient;
  mobileHistory: Audit[];
  desktopHistory: Audit[];
}) {
  const mobileLatest = mobileHistory[mobileHistory.length - 1] ?? null;
  const desktopLatest = desktopHistory[desktopHistory.length - 1] ?? null;
  const url = client.website;

  return (
    <article className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href={`/crm/${client.slug}`}
            className="text-base font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] sm:text-lg"
          >
            {client.name}
          </Link>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)]">
                {url}
              </a>
            ) : (
              "no website URL set"
            )}
            {client.retainer_started && <> · retainer since {client.retainer_started.slice(0, 10)}</>}
          </p>
        </div>
        {client.retainer_active ? (
          <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            on retainer
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-fg-dim)]/40 bg-[var(--color-surface-hi)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            no retainer
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StrategyBlock strategy="mobile" latest={mobileLatest} history={mobileHistory} client={client.slug} url={url} />
        <StrategyBlock strategy="desktop" latest={desktopLatest} history={desktopHistory} client={client.slug} url={url} />
      </div>
    </article>
  );
}
