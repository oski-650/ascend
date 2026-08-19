// components/AuditClientCard — one site under care, at both strategies.
//
// TWO REAL DEFECTS FIXED IN THIS MIGRATION, beyond the visual language:
//
//  1. It linked to `/crm/:slug` — a second client destination. It now resolves through
//     navigation/routing, the single owner, so it lands on the canonical client view.
//  2. It reimplemented the Lighthouse bands locally (`>=90 … >=50 …`) — the exact thresholds the
//     frozen Site Quality Engine owns — and then painted a 90+ score AMBER, which inverts the
//     product's color semantics: accent means the operator must act. Bands now arrive from the
//     engine via Mission Control (`SiteQuality.categories[].band`) and map to real semantic tones.
//
// Core Web Vitals are still read off the latest Audit record: the engine classifies category
// scores and does not carry CWV, so those numbers keep their existing source.

import Link from "next/link";
import type { Audit, AuditStrategy } from "@/lib/audits";
import type { CareClient } from "@/lib/care";
import type { Classification, SiteQuality } from "@/mission-control";
import { routeForEntity } from "@/navigation/routing";
import { ScoreSparkline } from "./ScoreSparkline";
import { RunAuditButton } from "./RunAuditButton";
import { Status, type Tone } from "@/components/primitives";

/** Engine band → tone. A lookup on the engine's own word; it classifies nothing. */
const BAND_TONE: Record<Classification, Tone> = {
  good: "good",
  "needs-improvement": "accent",
  poor: "risk",
  unclassified: "neutral",
};

const BAND_LABEL: Record<Classification, string> = {
  good: "good",
  "needs-improvement": "needs work",
  poor: "poor",
  unclassified: "unscored",
};

function bandColor(band: Classification): string {
  return band === "good"
    ? "var(--color-good)"
    : band === "needs-improvement"
      ? "var(--color-accent)"
      : band === "poor"
        ? "var(--color-risk)"
        : "var(--color-t3)";
}

function fmtMs(n: number | null): string {
  return n === null ? "—" : `${(n / 1000).toFixed(2)}s`;
}

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

export type StrategyView = {
  /** The engine's classification of the latest run, or null when this site has never been audited. */
  quality: SiteQuality | null;
  history: Audit[];
};

function StrategyBlock({
  strategy,
  view,
  client,
  url,
}: {
  strategy: AuditStrategy;
  view: StrategyView;
  client: string;
  url: string;
}) {
  const latest = view.history[view.history.length - 1] ?? null;
  const values = view.history.map((h) => h.scores.performance);
  const perf = view.quality?.categories.find((c) => c.category === "performance") ?? null;

  // Movement between the last two runs. Difference of two recorded values — no trend model.
  const delta = (() => {
    if (view.history.length < 2) return null;
    const a = view.history[view.history.length - 2].scores.performance;
    const b = view.history[view.history.length - 1].scores.performance;
    return a === null || b === null ? null : b - a;
  })();

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--color-line)] pb-1.5">
        <span className="t-label text-[var(--color-t3)]">{strategy}</span>
        <RunAuditButton client={client} url={url} strategy={strategy} />
      </div>

      {latest && perf ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p
                className="t-metric-xl tabular-nums"
                style={{ color: bandColor(perf.band) }}
              >
                {perf.score ?? "—"}
              </p>
              <p className="t-mono mt-0.5 text-[var(--color-t3)]">
                {daysAgo(latest.run_at)}
                {delta !== null && delta !== 0 && (
                  <span style={{ color: delta > 0 ? "var(--color-good)" : "var(--color-risk)" }}>
                    {" "}
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                )}
              </p>
            </div>
            <ScoreSparkline values={values} color="var(--color-t3)" />
          </div>

          {/* The engine's per-category verdict, stated as a word beside its number so band is
              never carried by color alone. */}
          <ul className="mt-3 flex flex-col gap-1 border-t border-[var(--color-line)] pt-2">
            {view.quality?.categories
              .filter((c) => c.category !== "performance")
              .map((c) => (
                <li key={c.category} className="flex items-baseline justify-between gap-2">
                  <span className="t-mono text-[var(--color-t3)]">
                    {c.category.replace("_", " ")}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="t-mono tabular-nums text-[var(--color-t2)]">
                      {c.score ?? "—"}
                    </span>
                    {/* Wide enough for "needs work" on one line — at 74px it wrapped mid-phrase. */}
                    <span className="w-[96px] whitespace-nowrap text-right">
                      <Status tone={BAND_TONE[c.band]}>{BAND_LABEL[c.band]}</Status>
                    </span>
                  </span>
                </li>
              ))}
          </ul>

          <p className="t-mono mt-2 text-[var(--color-t3)]">
            LCP {fmtMs(latest.cwv.lcp_ms)} · CLS {latest.cwv.cls ?? "—"} · TTFB{" "}
            {fmtMs(latest.cwv.ttfb_ms)}
          </p>
        </>
      ) : (
        <p className="t-meta py-2 text-[var(--color-t3)]">
          Never audited{url ? " — run one to establish a baseline" : " — no website URL set"}.
        </p>
      )}
    </div>
  );
}

export function AuditClientCard({
  client,
  mobile,
  desktop,
}: {
  client: CareClient;
  mobile: StrategyView;
  desktop: StrategyView;
}) {
  const url = client.website;
  const href = routeForEntity("client", client.slug);

  return (
    <article className="border-b border-[var(--color-line)] py-6 last:border-b-0">
      <header className="mb-4 flex flex-col gap-x-6 gap-y-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="min-w-0">
          {href ? (
            <Link
              href={href}
              className="t-h2 text-[var(--color-t1)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
            >
              {client.name}
            </Link>
          ) : (
            <span className="t-h2 text-[var(--color-t1)]">{client.name}</span>
          )}
          <p className="t-mono mt-1 text-[var(--color-t3)]">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
              >
                {url.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              "no website URL set"
            )}
            {client.retainer_started && <> · retainer since {client.retainer_started.slice(0, 10)}</>}
          </p>
        </div>
        <span className="shrink-0">
          <Status tone={client.retainer_active ? "good" : "neutral"}>
            {client.retainer_active ? "on retainer" : "no retainer"}
          </Status>
        </span>
      </header>

      <div className="flex flex-col gap-7 sm:flex-row sm:gap-10">
        <StrategyBlock strategy="mobile" view={mobile} client={client.slug} url={url} />
        <StrategyBlock strategy="desktop" view={desktop} client={client.slug} url={url} />
      </div>
    </article>
  );
}