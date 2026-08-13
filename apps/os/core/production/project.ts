// core/production/project.ts — Project initialization + checklist writes (Phase 2.3).
// Project identity = the client (1:1, Decision 3 — no project_id yet). Byte-faithful edits
// of production_state.md via the raw core/vault primitives. Emission is exactly-once.

import "server-only";
import path from "node:path";
import { crmDir, sopDir } from "@/core/vault/paths";
import { listSubdirs } from "@/core/vault/io";
import { readTextFile, writeFileAtomic } from "@/core/vault/markdown";
import { emitEvent } from "@/core/events";
import { PHASE_KEYS, type PhaseKey } from "@/domain";

const PRODUCTION_FILE = "production_state.md";

// ─── createProject (idempotent) ───────────────────────────────────────────────

export type CreateProjectResult =
  | { ok: true; clientSlug: string; created: boolean } // created=false ⇒ already existed (no write, no event)
  | { ok: false; code: "client_not_found" | "template_not_found"; message: string };

/**
 * Scaffold production_state.md for a client from an industry template.
 *
 * CONTRACT — callers check the RESULT; NEVER infer success from event emission:
 *   success → { ok: true, clientSlug, created }   (`created: false` ⇒ already existed = idempotent no-op)
 *   failure → { ok: false, code, message }
 *   (returns `clientSlug`, not a Project object — call getProductionState() if the full state is needed;
 *    no consumer needs the object yet, second-consumer rule.)
 *
 * INVARIANT — validate → persist → emitEvent → return:
 *   `project.created` is emitted ONLY after a successful write, NEVER before persistence, and NEVER on
 *   an idempotent (`created: false`) or error return. Emission is exactly-once per creation.
 *
 * IDEMPOTENT REPAIR: safe to re-run — a client that has a client but no project gets its project created
 *   (no manual cleanup; future Phase-3 reconciliation signals surface the partial); an existing one is a no-op.
 * Byte-faithful copy of the template (matches the prior route behavior exactly).
 */
export async function createProject(
  clientSlug: string,
  opts: { template?: string; launchTarget?: string } = {}
): Promise<CreateProjectResult> {
  const dir = crmDir();
  if (!(await listSubdirs(dir)).includes(clientSlug)) {
    return { ok: false, code: "client_not_found", message: `client "${clientSlug}" not found` };
  }

  const psPath = path.join(dir, clientSlug, PRODUCTION_FILE);
  // Idempotency guard — existing project is returned as-is; no overwrite, no event.
  if ((await readTextFile(psPath)) !== null) {
    return { ok: true, clientSlug, created: false };
  }

  const template = opts.template ?? "generic";
  const templateBody = await readTextFile(path.join(sopDir(), "production-templates", `${template}.md`));
  if (templateBody === null) {
    return { ok: false, code: "template_not_found", message: `production template "${template}.md" not found` };
  }

  let content = templateBody;
  if (opts.launchTarget) {
    content = content.replace(/launch_target:\s*""/, `launch_target: ${JSON.stringify(opts.launchTarget)}`);
  }
  await writeFileAtomic(psPath, content);

  await emitEvent({
    type: "project.created",
    subject: { entity: "project", entity_id: clientSlug }, // Decision 3: identity = client (1:1)
    data: { client_slug: clientSlug, template, launch_target: opts.launchTarget ?? null },
  });

  return { ok: true, clientSlug, created: true };
}

// ─── toggleChecklistItem (emits only on real change) ──────────────────────────

const PHASE_HEADING_RX = /^##\s+Phase:\s+(.+?)\s*$/i;
const TASK_RX = /^(\s*-\s*\[)([ xX])(\]\s+)(.+?)\s*$/;

export type ToggleResult =
  | { ok: true; done: boolean; changed: boolean }
  | { ok: false; code: "project_not_found" | "item_not_found"; message: string };

/**
 * Flip a checklist item's checkbox in production_state.md (body only; frontmatter bytes
 * preserved). Emits project.checklist_toggled ONLY when the persisted content actually changes.
 */
export async function toggleChecklistItem(
  clientSlug: string,
  phase: PhaseKey,
  itemIndex: number
): Promise<ToggleResult> {
  const psPath = path.join(crmDir(), clientSlug, PRODUCTION_FILE);
  const raw = await readTextFile(psPath);
  if (raw === null) {
    return { ok: false, code: "project_not_found", message: `production_state.md not found for ${clientSlug}` };
  }

  const lines = raw.split(/\r?\n/);
  let currentPhase: PhaseKey | null = null;
  let perPhaseIndex = 0;
  let newDone: boolean | null = null;
  let toggled = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(PHASE_HEADING_RX);
    if (heading) {
      const norm = heading[1].toLowerCase().trim();
      currentPhase = (PHASE_KEYS.find((k) => norm.startsWith(k)) as PhaseKey | undefined) ?? null;
      perPhaseIndex = 0;
      continue;
    }
    if (/^##\s+/.test(line) && !PHASE_HEADING_RX.test(line)) {
      currentPhase = null;
      continue;
    }
    if (currentPhase !== phase) continue;
    const task = line.match(TASK_RX);
    if (!task) continue;
    if (perPhaseIndex === itemIndex) {
      const wasChecked = task[2].toLowerCase() === "x";
      const newMarker = wasChecked ? " " : "x";
      lines[i] = `${task[1]}${newMarker}${task[3]}${task[4]}`;
      newDone = !wasChecked;
      toggled = true;
      break;
    }
    perPhaseIndex++;
  }

  if (!toggled) {
    return { ok: false, code: "item_not_found", message: `no checklist item at phase=${phase}, index=${itemIndex}` };
  }

  const updated = lines.join("\n");
  const done = newDone as boolean;
  // Change-detection: no persisted change ⇒ no write, no event (exactly-once guarantee).
  if (updated === raw) {
    return { ok: true, done, changed: false };
  }

  await writeFileAtomic(psPath, updated);
  await emitEvent({
    type: "project.checklist_toggled",
    subject: { entity: "project", entity_id: clientSlug },
    data: { phase, item_index: itemIndex, done },
  });

  return { ok: true, done, changed: true };
}
