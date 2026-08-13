// mission-control/insights — the Insights ORCHESTRATOR (Phase 6, MC-1/MC-3).
//
// Mission Control GATHERS the inputs (the single event reader core/events + core/finance reads) and
// INVOKES the pure engine; it computes no insight itself. `now` is read HERE (the surface boundary) and
// INJECTED into the engine, keeping the engine clock-free and deterministic (DC-6.4). Read-only: no
// writes, no events.

import "server-only";
import { readEvents } from "@/core/events";
import { listInvoices } from "@/core/finance";
import { deriveInsights, type Insight } from "@/engines/intelligence-engine";

export async function assembleInsights(now: Date = new Date()): Promise<Insight[]> {
  const [events, invoices] = await Promise.all([readEvents(), listInvoices()]);
  return deriveInsights({ events, invoices }, now);
}
