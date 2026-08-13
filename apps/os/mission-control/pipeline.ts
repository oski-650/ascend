// mission-control/pipeline — the Sales-Pipeline-Funnel ORCHESTRATOR (Phase 11, MC-1/MC-3).
//
// Mission Control GATHERS prospects (via the frozen core/crm reader) and INVOKES the pure engine; it
// performs no aggregation itself. It maps each Prospect to the engine input, CONSUMING the pre-derived
// `score`/`tier` (never re-scoring). Read-only: no writes, no events.

import "server-only";
import { listProspects } from "@/core/crm";
import { buildPipelineDigest, type PipelineDigest } from "@/engines/pipeline-engine";

export async function assemblePipeline(): Promise<PipelineDigest> {
  const prospects = await listProspects();
  return buildPipelineDigest(
    prospects.map((p) => ({
      status: p.frontmatter.status,
      score: p.score.score, // consumed, not recomputed (computeScore stays the authority)
      tier: p.score.tier,
    }))
  );
}
