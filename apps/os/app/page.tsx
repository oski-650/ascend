// app/page — ASCEND NEURAL CORE, the home experience.
//
// A Server Component that gathers and injects; it renders no business logic of its own.
//
// ARCHITECTURE NOTE (F14): the priority feed is obtained from mission-control.assemblePriorityFeed(),
// the declared orchestrator. The previous /dashboard value-imported `rank` from the Decision Engine
// and called it directly — the recorded F14 exemption. Going through Mission Control RETIRES that
// violation rather than carrying it forward, so the fitness rule is tightened, never weakened.
//
// The graph data producer is referenced through ONE import. When the KnowledgeIndex gains structural
// and event contributors (GAP-1/2/3), this line becomes `indexerGraphSource` and nothing else in the
// UI changes — NeuralCore depends on the contract, never on the projection.

import { assemblePriorityFeed, buildKpiSummary } from "@/mission-control";
import { computeKpis } from "@/lib/forecast";
import { secondsInWindow } from "@/lib/timeLog";
import { listCareClients } from "@/core/finance";
import { getConfig } from "@/lib/config";
import { projectGraph as graphSource } from "@/graph-view/projection";
import { EMPTY_GRAPH } from "@/graph-view/contract";
import { NeuralCore } from "@/components/graph/NeuralCore";

export const dynamic = "force-dynamic";

export default async function NeuralCorePage() {
  const config = await getConfig();

  const [model, priorityItems, financeKpis, weekSeconds, careClients] = await Promise.all([
    // A malformed vault record must degrade to an honest empty graph, never a crashed home page.
    graphSource().catch(() => EMPTY_GRAPH),
    assemblePriorityFeed().catch(() => []),
    computeKpis(config.monthly_target_usd),
    secondsInWindow(7),
    listCareClients(),
  ]);

  // Three quiet numbers, selected from the KPI summary its owner already produced. Not six cards.
  const metrics = buildKpiSummary({
    finance: financeKpis,
    hours7dSeconds: weekSeconds,
    activeCarePlans: careClients.length,
  }).filter((k) => ["collected-this-month", "outstanding", "overdue"].includes(k.key));

  const operatorDate = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <NeuralCore
      model={model}
      priorityItems={priorityItems}
      metrics={metrics}
      operatorDate={operatorDate}
    />
  );
}