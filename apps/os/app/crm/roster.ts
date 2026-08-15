// app/crm/roster — SURFACE-OWNED gathering for the Clients index.
//
// Same posture as app/clients/[slug]/dossier.ts, and colocated with the route it serves for the
// same reason: so it cannot be mistaken for a new layer. Where the dossier narrows global output to
// ONE client, this joins the same global outputs across ALL clients by identity.
//
// WHAT IT DOES: calls existing canonical readers and Mission Control assemblers, then keys their
// output by client slug. Every assembler here is already global by design — `listClients()`,
// `assembleHealthOverview()`, `assemblePriorityFeed()`, `listInvoices()` — so this is a join on an
// id, not a query layer.
//
// WHAT IT MUST NEVER DO — no scoring, ranking, health derivation, status derivation, or threshold
// logic. Health arrives from the Health Engine via Mission Control; ranked attention from the
// Decision Engine via `assemblePriorityFeed()` in its order; invoice lifecycle from the domain
// deriver. `rank()` and `computeHealthScore()` are never imported (F14 is absolute).
//
// The one arithmetic operation below is summing a single client's open invoice amounts — the same
// "sum a filtered list of one read-model family" the Finance surface already performs for its
// overdue total. It is presentation aggregation of amounts, not a derived business metric.
//
// It performs no filesystem access of its own, writes nothing, and emits no events.

import "server-only";

import { listClients } from "@/core/crm";
import { listProductionStates, type ProductionState } from "@/core/production";
import { listInvoices, listCareClients } from "@/core/finance";
import { readEvents } from "@/core/events";
import { assembleHealthOverview, assemblePriorityFeed } from "@/mission-control";
import { deriveInvoiceStatus } from "@/domain";
import type { HealthTile } from "@/mission-control";
import type { PriorityItem } from "@/engines/decision-engine";

export type ClientRow = {
  slug: string;
  name: string;
  /** The client's project, or null when the vault has no production_state.md for it. */
  production: ProductionState | null;
  /** Health exactly as the Health Engine produced it. `null` when there is no project to score. */
  health: HealthTile["health"] | null;
  /** Decision-ranked items whose subject IS this client. Decision's order is preserved. */
  attention: PriorityItem[];
  /** Money owed: count and total of this client's unpaid invoices, plus how many are overdue. */
  openInvoiceCount: number;
  openInvoiceTotal: number;
  overdueCount: number;
  /** Whether a care retainer is running — read from core/finance, not inferred here. */
  retainerActive: boolean;
  /** ISO timestamp of the newest event about this client, or null if it has none. */
  lastEventAt: string | null;
};

export type Roster = {
  /** Every client, in `listClients()`'s own alphabetical order. */
  rows: ClientRow[];
  /**
   * The full Decision feed, in Decision's order, restricted to subjects that are clients in this
   * roster. Rendered as the attention section above the index — never used to reorder the index.
   */
  ranked: PriorityItem[];
};

/** How far back the activity join reads. A presentation limit, not a business rule. */
const EVENT_SCAN_LIMIT = 400;

export async function getRoster(): Promise<Roster> {
  const [clients, states, healthTiles, invoices, careClients, priority, events] = await Promise.all([
    listClients(),
    listProductionStates(),
    assembleHealthOverview(), // Mission Control invokes the Health Engine — the surface never does
    listInvoices(),
    listCareClients(),
    assemblePriorityFeed(), // Decision's ranked output, consumed in Decision's order
    readEvents({ limit: EVENT_SCAN_LIMIT }),
  ]);

  // ── Key every global output by slug. Each of these is a lookup, not a derivation. ──
  const stateBySlug = new Map(states.map((s) => [s.clientSlug, s]));
  const healthBySlug = new Map(healthTiles.map((t) => [t.clientSlug, t.health]));
  const retainerBySlug = new Map(careClients.map((c) => [c.slug, c.retainer_active]));

  // Newest event per client. `readEvents` returns oldest-first, so the last write wins.
  const lastEventBySlug = new Map<string, string>();
  for (const e of events) {
    const id = e.subject?.entity_id;
    if (id) lastEventBySlug.set(id, e.occurred_at);
  }

  const rows: ClientRow[] = clients.map((c) => {
    // Invoice lifecycle belongs to the domain deriver (D2); it is copied, never re-derived.
    const own = invoices.filter((inv) => inv.client === c.slug);
    const open = own.filter((inv) => deriveInvoiceStatus(inv) !== "paid");
    const overdue = own.filter((inv) => deriveInvoiceStatus(inv) === "overdue");

    return {
      slug: c.slug,
      name: c.name,
      production: stateBySlug.get(c.slug) ?? null,
      health: healthBySlug.get(c.slug) ?? null,
      attention: priority.filter((item) => item.subject.id === c.slug),
      openInvoiceCount: open.length,
      openInvoiceTotal: open.reduce((sum, inv) => sum + inv.amount_usd, 0),
      overdueCount: overdue.length,
      retainerActive: retainerBySlug.get(c.slug) ?? false,
      lastEventAt: lastEventBySlug.get(c.slug) ?? null,
    };
  });

  const slugs = new Set(rows.map((r) => r.slug));

  return {
    rows,
    // `filter` preserves array order, so Decision's ranking survives intact.
    ranked: priority.filter((item) => slugs.has(item.subject.id)),
  };
}