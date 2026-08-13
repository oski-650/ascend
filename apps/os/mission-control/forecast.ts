// mission-control/forecast — the Forecast ORCHESTRATOR (Phase 6.1, MC-1/MC-3).
//
// Mission Control GATHERS + ADAPTS the inputs and INVOKES the pure engine; it computes no forecast
// itself. lib/forecast remains the CANONICAL owner of the forecast mathematics (computeKpis) — this
// layer composes/adapts its outputs into the Forecast contract, re-implementing no formula (DF-3). `now`
// is read HERE (surface boundary) and INJECTED into the engine, keeping the engine clock-free (DF-7).
// Read-only: no writes, no events.

import "server-only";
import { computeKpis } from "@/lib/forecast";
import { listProspects } from "@/lib/sales";
import { getConfig } from "@/lib/config";
import { deriveForecast, type Forecast } from "@/engines/intelligence-engine/forecast";

const CLOSED_STATUSES = new Set(["closed-won", "closed-lost"]);

export async function assembleForecast(now: Date = new Date()): Promise<Forecast[]> {
  const config = await getConfig();
  const [kpis, prospects] = await Promise.all([
    computeKpis(config.monthly_target_usd), // lib/forecast owns the math
    listProspects(),
  ]);

  // Adaptation only: count the prospects that actually contribute to the weighted pipeline, so the
  // engine can size confidence honestly (small-N). No forecast math is performed here.
  const pipelineProspectCount = prospects.filter((p) => {
    const status = String(p.frontmatter.status ?? "lead");
    return !CLOSED_STATUSES.has(status);
  }).length;

  return deriveForecast(
    {
      thisMonthReceived: kpis.thisMonthReceived,
      thisMonthTarget: kpis.thisMonthTarget,
      pipeline90d: kpis.pipeline90d,
      pipelineProspectCount,
    },
    now
  );
}
