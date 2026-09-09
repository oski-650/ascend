// core/research/website — THE RESEARCH RUNNER, and the first thing in this system to act as
// `ascend_automation`.
//
// ─── WHAT IT MAY WRITE, AND WHAT IT MAY NEVER WRITE ────────────────────────────────────────────
//
// 001's grant block named this module before it existed:
//
//     GRANT UPDATE (name, business_type, location, website, …, website_quality, source, updated_at)
//       ON prospects TO ascend_automation;
//     -- AUTOMATION MAY NOT JUDGE. `website_opportunity`, `assessed_by` and `assessed_at` are absent
//     -- from this grant, so the research runner cannot write a human assessment even if a future
//     -- code path tried to.
//
// So the database already bounds this file. Within those bounds it writes exactly ONE column:
// `website`, and only when a probe actually answered.
//
// ─── IT DOES NOT WRITE `website_quality`, THOUGH IT IS PERMITTED TO ────────────────────────────
//
// The grant allows it. This module declines it, and the reason is the most important thing in the
// file.
//
// `computeScore` pays +30 for `website_quality: 'none'` — exactly the `warm` threshold — and only
// for a STATED claim: *"`none` means someone asserted this business has no site."* A failed probe
// is not that assertion. It is consistent with the business having no site, and equally with slow
// DNS, a host that blocks datacentre traffic, an http-only server that timed out, or a domain
// nobody guessed. `./probe` cannot tell those apart and neither can this.
//
// Writing `none` on a miss would promote ~3,000 of the imported leads to `warm` on no evidence —
// the precise failure `core/crm/scoring.ts` was repaired to remove, re-entering through a different
// door. So a miss writes NOTHING and is recorded as an observation for a human to act on.
//
//   > Ascend may report that it looked. Only a person may conclude that there is nothing there.

import "server-only";
import type { OrganizationId } from "@/domain";
import { appendEvent, findProspectRef } from "@/core/db";
import { asPrincipal } from "@/core/db";
import { requireCapability } from "@/core/auth/authority";
import { requireAppDb } from "@/core/auth/connection";
import { candidatesFor, type Candidate } from "./candidates";
import { probeDomain, type Fetcher, type ProbeOutcome } from "./probe";

export class ProspectNotFound extends Error {}

export type ResearchResult =
  /** A live site answered. `website` was written. */
  | { readonly kind: "found"; readonly website: string; readonly basis: Candidate["basis"] }
  /** Nothing answered. NO prospect field was written — see this file's header. */
  | { readonly kind: "not_found"; readonly tried: readonly ProbeOutcome[] }
  /** The record already states a website. Nothing was probed and nothing was written. */
  | { readonly kind: "already_known"; readonly website: string }
  /** The record says too little to derive any address worth checking. */
  | { readonly kind: "no_candidates" };

type Row = {
  id: string;
  organization_id: string;
  name: string | null;
  contact_email: string | null;
  website: string | null;
};

/**
 * Look for one prospect's website.
 *
 * ─── TWO PRINCIPALS, ONE REQUEST, AND THE DIFFERENCE IS DELIBERATE ───────────────────────────
 *
 *   the CALLER   a human holding `research:run` — authorizes the act, and scopes it to their org
 *   the WRITER   `ascend_automation` — performs it, under a role that CANNOT write a judgment
 *
 * The caller's organization is carried across; their identity is not. That is what makes the
 * finding attributable to Ascend rather than to the person who pressed the button — a distinction
 * D-3 already draws for import, and the reason the automation role holds no `created_by`.
 *
 * A caller cannot escalate through this: `ascend_automation` is strictly weaker than either human
 * role on `prospects` (no `website_opportunity`, no `assessed_by`, no `assessed_at`, and no access
 * at all to `prospect_notes`). The switch trades authority DOWN.
 */
export async function researchProspectWebsite(
  ref: string,
  opts: { fetchImpl?: Fetcher; timeoutMs?: number } = {}
): Promise<ResearchResult> {
  const principal = await requireCapability("research:run");
  const organizationId = principal.organizationId as OrganizationId;

  return requireAppDb()(async (client) => {
    // READ as the caller: the human's own scoping decides which prospects they can see at all.
    const row = await asPrincipal(client, principal, async (tx) => {
      const id = await findProspectRef(tx, ref);
      if (id === null) return null;
      const { rows } = await tx.query<Row>(
        `SELECT id, organization_id, name, contact_email, website FROM prospects WHERE id = $1`,
        [id]
      );
      return rows[0] ?? null;
    });
    if (!row) throw new ProspectNotFound(ref);

    if (row.website && row.website.trim() !== "") {
      return { kind: "already_known", website: row.website } as const;
    }

    const candidates = candidatesFor({
      name: row.name, contactEmail: row.contact_email, website: row.website,
    });
    if (candidates.length === 0) return { kind: "no_candidates" } as const;

    // ─── THE NETWORK CALLS HAPPEN OUTSIDE ANY TRANSACTION ──────────────────────────────────────
    //
    // Probing inside one would hold a database transaction open across third-party latency — the
    // 2026-09 import already showed what a long transaction costs here, and that one at least was
    // doing database work. These are HTTP requests to strangers.
    const tried: ProbeOutcome[] = [];
    let hit: { outcome: ProbeOutcome; basis: Candidate["basis"] } | null = null;
    for (const c of candidates) {
      const outcome = await probeDomain(c.domain, opts);
      tried.push(outcome);
      // FIRST ANSWER WINS, and the list is ordered by confidence — so a business whose contact
      // writes from its own domain is never attributed a domain guessed from its name.
      if (outcome.reachable) { hit = { outcome, basis: c.basis }; break; }
    }

    const evidence = {
      candidates: candidates.map((c) => ({ domain: c.domain, basis: c.basis })),
      probes: tried.map((p) => ({ domain: p.domain, reachable: p.reachable, status: p.status, error: p.error })),
    };

    if (!hit) {
      // NOTHING IS WRITTEN TO THE PROSPECT. Only the observation that Ascend looked, with what it
      // tried and how each attempt failed, so a person can judge whether the absence means anything.
      await asPrincipal(client, automationFor(organizationId), (tx) =>
        appendEvent(tx, organizationId, {
          type: "prospect.website_researched",
          subject: { entity: "prospect", entity_id: row.id },
          actor: "system",
          data: { outcome: "not_found", ...evidence },
        })
      );
      return { kind: "not_found", tried } as const;
    }

    const website = hit.outcome.url ?? `https://${hit.outcome.domain}`;

    // WRITE AND RECORD IN ONE TRANSACTION, as `ascend_automation`. The row and the reason it
    // changed commit together or neither does.
    await asPrincipal(client, automationFor(organizationId), (tx) =>
      tx.transaction(async (t) => {
        await t.query(
          `UPDATE prospects SET website = $2, updated_at = now() WHERE id = $1`,
          [row.id, website]
        );
        await appendEvent(t, organizationId, {
          type: "prospect.website_researched",
          subject: { entity: "prospect", entity_id: row.id },
          actor: "system",
          data: { outcome: "found", website, basis: hit.basis, ...evidence },
        });
      })
    );

    return { kind: "found", website, basis: hit.basis } as const;
  });
}

/**
 * The writer principal.
 *
 * Not a `ResolvedPrincipal` and cannot be one — `core/db/client` types `automation` as a separate
 * arm precisely because no membership vouches for it. There is no human here to name, which is the
 * fact `actor: "system"` reports.
 */
function automationFor(organizationId: OrganizationId) {
  return { role: "automation" as const, organizationId, userId: null };
}

/** Re-exported so a caller need not reach into two modules to read one result. */
export type { Candidate, ProbeOutcome };
export { candidatesFor } from "./candidates";
