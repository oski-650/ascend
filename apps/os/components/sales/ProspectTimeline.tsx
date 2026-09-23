// components/sales/ProspectTimeline — one prospect's history, newest first, grouped by Pacific day
// (Slice 2A.2b). Presentational: the entries arrive from the page's server read, and every word comes
// from `presentation`. The read already excludes events a canonical table represents, so each fact
// appears once.

import Link from "next/link";
import type { TimelineEntry } from "@/core/crm/sales";
import { entryTime, groupTimeline, presentTimelineEntry } from "./presentation";

export function ProspectTimeline({
  entries, names, before, earlierHref, latestHref, now = new Date(),
}: {
  entries: TimelineEntry[];
  names: Record<string, string>;
  /** Set when this page shows entries older than some point. */
  before?: string | null;
  earlierHref: string | null;
  latestHref: string;
  now?: Date;
}) {
  const groups = groupTimeline(entries.map((e) => presentTimelineEntry(e, names, now)), now);
  return (
    <section id="timeline" aria-labelledby="timeline-h" className="min-w-0 scroll-mt-16">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-2">
        <h2 id="timeline-h" className="t-section text-[var(--color-t2)]">Timeline</h2>
        {before && <Link href={latestHref} className="t-meta text-[var(--color-t3)] hover:text-[var(--color-t1)]">Back to latest</Link>}
      </div>
      {groups.length === 0 ? (
        <p className="t-meta py-3 text-[var(--color-t3)]">
          {before ? "Nothing earlier." : "Nothing recorded yet. Contacts, stage changes and follow-ups will appear here."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.day}>
              <h3 className="t-label mb-2 text-[var(--color-t3)]">{g.label}</h3>
              <ol className="flex flex-col">
                {g.lines.map((l) => (
                  <li key={l.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 border-b border-[var(--color-line)] py-2.5 last:border-b-0">
                    <time dateTime={l.at} className="t-mono pt-[1px] text-[var(--color-t3)]">{entryTime(l.at).replace(" PT", "")}</time>
                    <div className="min-w-0">
                      <p className="t-body text-[var(--color-t1)]">
                        {l.title}
                        {l.badge && <span className="t-label ml-2 rounded-[var(--radius-xs)] border border-[var(--color-line-strong)] px-1.5 py-0.5 text-[var(--color-t2)]">{l.badge}</span>}
                      </p>
                      {(l.detail || l.who) && (
                        <p className="t-meta text-[var(--color-t3)]">{[l.detail, l.who].filter(Boolean).join(" · ")}</p>
                      )}
                      {l.prose && <p className="t-meta mt-1 whitespace-pre-line break-words text-[var(--color-t2)]">{l.prose}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="t-meta text-[var(--color-t3)]">Times are Pacific.</p>
        </div>
      )}
      {earlierHref && (
        <Link href={earlierHref} className="t-meta mt-3 inline-flex min-h-9 items-center text-[var(--color-t2)] underline-offset-4 hover:text-[var(--color-t1)] hover:underline">
          Earlier entries
        </Link>
      )}
    </section>
  );
}
