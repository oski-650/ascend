// components/sales/ProspectResearch — the web-presence panel: grade, site, and every look taken.
//
// A Server Component. The page reads the log through `listResearchLog` (guarded by
// `prospects:read`) and the grade off the prospect itself; the only client code here is the
// `Find website` button, which posts to a route that authorizes independently.
//
// ─── THE GRADE IS SHOWN WITH WHAT IT IS WORTH ──────────────────────────────────────────────────
//
// `website_quality` was rendered as a bare word in the fact grid — `outdated` with no indication
// that it is the difference between a cold lead and a warm one. `computeScore` pays +30 for `none`
// and `outdated`, exactly the `warm` threshold, so the grade IS the ranking on this axis. Saying so
// where it is displayed is the difference between a label and an explanation.
//
// ─── AND UNGRADED IS RENDERED AS A QUESTION, NOT AS A ZERO ─────────────────────────────────────
//
// A NULL `website_quality` means one of two completely different things: nobody has looked, or
// somebody looked and could not tell. The column cannot distinguish them — the LOG can, and that is
// why this panel exists. An ungraded prospect with research entries says "checked, inconclusive";
// one with none says "not checked yet".

import { FindWebsiteButton } from "./FindWebsiteButton";
import type { ResearchEntry } from "@/core/crm/research-log";

const GRADE: Record<string, { label: string; blurb: string; tone: string; worth: string }> = {
  none: {
    label: "No website",
    blurb: "Their own domain is parked, for sale, or serves nothing.",
    tone: "var(--color-accent)",
    worth: "+30 to the score — top of the pipeline",
  },
  outdated: {
    label: "Outdated site",
    blurb: "It exists and is failing them — no TLS, not responsive, or visibly dated.",
    tone: "var(--color-accent)",
    worth: "+30 to the score — top of the pipeline",
  },
  acceptable: {
    label: "Acceptable site",
    blurb: "Works, responsive, nothing broken. A refresh, not a rebuild.",
    tone: "var(--color-t2)",
    worth: "no score contribution",
  },
  modern: {
    label: "Modern site",
    blurb: "Current and well built. Low priority for a rebuild.",
    tone: "var(--color-t3)",
    worth: "no score contribution",
  },
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const OUTCOME_TONE: Record<string, string> = {
  audited: "var(--color-accent)",
  found: "var(--color-accent)",
  corrected: "var(--color-accent)",
  unverified: "var(--color-t3)",
  not_found: "var(--color-t3)",
  retracted: "var(--color-risk)",
};

export function ProspectResearch({
  prospect,
  website,
  quality,
  log,
}: {
  prospect: string;
  website?: string | null;
  quality?: string | null;
  log: readonly ResearchEntry[];
}) {
  const g = quality ? GRADE[quality] : null;
  const looked = log.length > 0;
  // THE RECORDED WEBSITE CAN BE STALE, AND THE LOG IS WHAT KNOWS IT.
  //
  // `Concrete Chemicals of California` carries concrete-chemicals.com on its record; the most
  // recent check found that domain now serves a Vietnamese gambling site. Rendering it as an
  // ordinary link invites someone to click through to it believing it is the prospect's. When the
  // newest check could not confirm the site, the link says so.
  const latest = log[0];
  const unconfirmed =
    !!website && !!latest && (latest.outcome === "unverified" || latest.outcome === "retracted");

  return (
    <div className="flex flex-col gap-6">
      {/* ── GRADE + CURRENT SITE ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {g ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-h1" style={{ color: g.tone }}>{g.label}</span>
            <span className="t-mono text-[var(--color-t3)]">{g.worth}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-h1 text-[var(--color-t2)]">
              {looked ? "Checked — inconclusive" : "Not checked yet"}
            </span>
            <span className="t-mono text-[var(--color-t3)]">
              {looked ? "Ascend looked and could not tell" : "no research recorded"}
            </span>
          </div>
        )}
        {g && <p className="t-body max-w-prose text-[var(--color-t2)]">{g.blurb}</p>}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="t-label text-[var(--color-t3)]">Website</span>
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noreferrer noopener"
              className="t-body break-all text-[var(--color-t1)] underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
            >
              {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          ) : (
            <span className="t-body text-[var(--color-t3)]">
              {quality === "none" ? "none — verified" : "none recorded"}
            </span>
          )}
          {unconfirmed && (
            <span className="t-label text-[var(--color-risk)]">last check could not confirm this</span>
          )}
        </div>

        <div><FindWebsiteButton prospect={prospect} /></div>
      </div>

      {/* ── THE LOG ──────────────────────────────────────────────────────────────────────── */}
      {looked && (
        <div className="flex flex-col gap-2">
          <p className="t-label text-[var(--color-t3)]">
            {log.length} {log.length === 1 ? "check" : "checks"} recorded · newest first
          </p>
          <ul className="flex max-w-[72ch] flex-col">
            {log.map((e) => (
              <li key={e.eventId} className="border-b border-[var(--color-line)] py-3 last:border-b-0">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="t-label" style={{ color: OUTCOME_TONE[e.outcome] ?? "var(--color-t2)" }}>
                    {e.outcome.replace(/_/g, " ")}
                  </span>
                  <span className="t-mono text-[var(--color-t3)]">{when(e.at)}</span>
                  {e.quality && <span className="t-mono text-[var(--color-t2)]">graded {e.quality}</span>}
                </div>

                {/* The sentence that makes the grade reviewable rather than merely visible. */}
                {e.basis && <p className="t-body max-w-prose text-[var(--color-t2)]">{e.basis}</p>}

                {(e.identityEvidence || e.geographyEvidence) && (
                  <p className="mt-1 t-meta text-[var(--color-t3)]">
                    {e.identityEvidence && <>identity: {e.identityEvidence}</>}
                    {e.identityEvidence && e.geographyEvidence && " · "}
                    {e.geographyEvidence && <>geography: {e.geographyEvidence}</>}
                  </p>
                )}

                {e.probes.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {e.probes.map((p, i) => (
                      <li key={`${p.domain}-${i}`} className="t-mono text-[var(--color-t3)]">
                        {p.reachable ? "✓" : "○"} {p.domain}
                        {p.error ? ` — ${p.error}` : p.status ? ` — HTTP ${p.status}` : ""}
                      </li>
                    ))}
                  </ul>
                )}

                {e.method && <p className="mt-1 t-meta text-[var(--color-t3)]">↳ {e.method}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
