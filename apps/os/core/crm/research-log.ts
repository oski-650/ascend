// core/crm/research-log — EVERY TIME ASCEND LOOKED AT THIS BUSINESS'S WEBSITE.
//
// ─── THE RECORD ALREADY EXISTED; NOTHING COULD READ IT ─────────────────────────────────────────
//
// `core/research/website` emits `prospect.website_researched` for every prospect it examines —
// found or not — carrying the candidates it tried, how each probe failed, what tied the site to the
// business, and the basis for the verdict. Two audit runs put 187 of those on the spine.
//
// The prospect page showed none of it. It rendered `website_quality` as a bare word in a fact grid,
// so an operator could see the grade `outdated` and had no way to learn that it meant "no TLS —
// Chrome refuses to load it", still less that Ascend had checked twice on different days.
//
// This module is the reader for that history. It derives nothing and stores nothing.
//
// ─── WHY THE LOG IS THE HONEST SURFACE FOR THIS ────────────────────────────────────────────────
//
// A grade is a conclusion. The spine holds the EVIDENCE the conclusion came from, including runs
// that concluded nothing — which is the half `website_quality` structurally cannot express, because
// "we looked twice and could not tell" and "we never looked" are the same NULL in that column.
// Showing the log is what makes the difference visible.

import "server-only";
import { requireCapability } from "@/core/auth/authority";
import { findProspectRef } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { withProspectDb } from "./source";

/** One recorded look at this prospect's web presence. */
export type ResearchEntry = {
  readonly eventId: string;
  readonly at: string;
  /** `audited` · `unverified` · `found` · `not_found` · `corrected` · `retracted` */
  readonly outcome: string;
  readonly website: string | null;
  readonly quality: string | null;
  readonly domain: string | null;
  /** Why the verdict — the sentence a human should read before trusting the grade. */
  readonly basis: string | null;
  readonly identityEvidence: string | null;
  readonly geographyEvidence: string | null;
  readonly method: string | null;
  /** Each address tried and how it answered, when the run recorded them. */
  readonly probes: readonly { domain: string; reachable?: boolean; status?: number | null; error?: string | null }[];
};

type Data = Record<string, unknown>;
const str = (d: Data, k: string): string | null => (typeof d[k] === "string" ? (d[k] as string) : null);

/**
 * This prospect's research history, newest first.
 *
 * `ref` is what the URL carries — a slug or a row id (`findProspectRef`). An unknown ref returns an
 * EMPTY list rather than throwing, matching `listNotes`: the page has already decided whether the
 * prospect exists, and a history reader is not the place to re-litigate it.
 *
 * Guarded by `prospects:read` through `withProspectDb`. `readEvents` additionally resolves its own
 * caller and filters by capability domain, so a principal who may not see prospect events gets
 * nothing here even though this function asked for them.
 */
export async function listResearchLog(ref: string): Promise<readonly ResearchEntry[]> {
  await requireCapability("prospects:read");
  return withProspectDb(async (tx) => {
    const prospect = await findProspectRef(tx, ref);
    if (prospect === null) return [];

    const events = await readEvents(tx, {
      types: ["prospect.website_researched"],
      entity: "prospect",
      entity_id: prospect,
    });

    return events
      .map((e) => {
        const d = (e.data ?? {}) as Data;
        const probes = Array.isArray(d.probes) ? (d.probes as ResearchEntry["probes"]) : [];
        return {
          eventId: e.event_id as string,
          at: e.occurred_at,
          outcome: str(d, "outcome") ?? "recorded",
          website: str(d, "website"),
          quality: str(d, "website_quality"),
          domain: str(d, "domain"),
          basis: str(d, "basis"),
          identityEvidence: str(d, "identity_evidence"),
          geographyEvidence: str(d, "geography_evidence"),
          method: str(d, "method"),
          probes,
        };
      })
      // Newest first. `readEvents` returns spine order (oldest first) and the page wants the most
      // recent look at the top; reversing here keeps that decision out of the component.
      .reverse();
  });
}
