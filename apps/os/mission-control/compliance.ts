// mission-control/compliance — the Template-Compliance ORCHESTRATOR (Phase 7, MC-1/MC-3).
//
// Mission Control GATHERS the parsed inputs (project states via core/production; canonical templates via
// the read-only template reader) and INVOKES the pure engine; it computes no compliance itself.
// Read-only: no writes, no events. Templates are NOT added to the KnowledgeIndex (DS-3).

import "server-only";
import { listProductionStates } from "@/core/production";
import { getProductionTemplate } from "@/core/production/templates";
import { compareToTemplate, type TemplateComplianceReport } from "@/engines/sop-engine";

export async function assembleCompliance(): Promise<TemplateComplianceReport[]> {
  const states = await listProductionStates();
  return Promise.all(
    states.map(async (s) => {
      const industry = s.industryTemplate ?? "";
      const template = await getProductionTemplate(industry); // null ⇒ graceful no-template
      return compareToTemplate(
        {
          clientSlug: s.clientSlug,
          industryTemplate: industry,
          phases: s.phases.map((p) => ({ key: p.key, checklist: p.checklist })),
        },
        template
      );
    })
  );
}
