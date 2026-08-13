// engines/sop-engine — PURE read-only Production-Template Compliance (Phase 7).
//
// Answers "is this project following its defined process, and what's missing?" — a FACTUAL structural
// diff of a project's actual checklist against its canonical production template. It reports; it never
// executes, never writes status, never recommends (no score/priority/ranking — that would be Decision).
// Pure: imports ONLY domain types/constants — no fs, no core, no other engine, no Next, no vault. No
// clock, no randomness → deterministic. Step matching is deterministic mechanical normalization
// (case + whitespace) only — no fuzzy, no NLP, no AI.

import { PHASE_KEYS, type PhaseKey, type ChecklistItem } from "@/domain";

// ─── Inputs (parsed structures gathered + injected by the orchestrator) ─────────────────────────────
export type CompliancePhaseInput = { key: PhaseKey; checklist: readonly ChecklistItem[] };
export type ProjectComplianceInput = {
  clientSlug: string;
  industryTemplate: string;
  phases: readonly CompliancePhaseInput[];
};
/** null ⇒ no template exists for this industry (handled gracefully — never a fabricated 0%). */
export type TemplateComplianceInput = {
  industryTemplate: string;
  steps: Readonly<Record<PhaseKey, readonly ChecklistItem[]>>;
} | null;

// ─── Output contract (DS-8) — facts only: coverage + missing/extra steps ────────────────────────────
export type PhaseCompliance = {
  phase: PhaseKey;
  templateStepCount: number;
  presentCount: number;
  missingSteps: string[]; // canonical steps absent from the project
  extraSteps: string[]; // project steps not in the template
  coverage: number; // 0–100
};
export type TemplateComplianceReport = {
  clientSlug: string;
  industryTemplate: string;
  hasTemplate: boolean;
  overallCoverage: number | null; // null when hasTemplate === false (no fabricated 0%)
  phases: PhaseCompliance[];
};

/** Deterministic mechanical normalization — the ONLY normalization: lowercase, trim, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compare a project's actual checklist against its canonical template. Pure and deterministic — same
 * (project, template) ⇒ identical report. Unknown template (null) ⇒ hasTemplate:false, coverage null.
 */
export function compareToTemplate(
  project: ProjectComplianceInput,
  template: TemplateComplianceInput
): TemplateComplianceReport {
  if (!template) {
    return {
      clientSlug: project.clientSlug,
      industryTemplate: project.industryTemplate,
      hasTemplate: false,
      overallCoverage: null,
      phases: [],
    };
  }

  const projectByPhase = new Map<PhaseKey, readonly ChecklistItem[]>(project.phases.map((p) => [p.key, p.checklist]));

  const phases: PhaseCompliance[] = [];
  let totalTemplate = 0;
  let totalPresent = 0;

  for (const key of PHASE_KEYS) {
    const templateSteps = template.steps[key] ?? [];
    const projectSteps = projectByPhase.get(key) ?? [];
    const projectNorm = new Set(projectSteps.map((s) => normalize(s.text)));
    const templateNormSet = new Set(templateSteps.map((s) => normalize(s.text)));

    const missingSteps: string[] = [];
    let present = 0;
    for (const step of templateSteps) {
      if (projectNorm.has(normalize(step.text))) present += 1;
      else missingSteps.push(step.text);
    }
    const extraSteps = projectSteps.filter((s) => !templateNormSet.has(normalize(s.text))).map((s) => s.text);
    const coverage = templateSteps.length === 0 ? 100 : Math.round((present / templateSteps.length) * 100);

    phases.push({
      phase: key,
      templateStepCount: templateSteps.length,
      presentCount: present,
      missingSteps,
      extraSteps,
      coverage,
    });
    totalTemplate += templateSteps.length;
    totalPresent += present;
  }

  const overallCoverage = totalTemplate === 0 ? 100 : Math.round((totalPresent / totalTemplate) * 100);
  return {
    clientSlug: project.clientSlug,
    industryTemplate: project.industryTemplate,
    hasTemplate: true,
    overallCoverage,
    phases,
  };
}
