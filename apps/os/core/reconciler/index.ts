// core/reconciler — OBSERVING WHAT HAPPENED TO THE BUSINESS, not only what Ascend did.
//
// Ascend is not the sole author of its vault. Every write Ascend performs emits an event (F21), but
// the operator also edits markdown directly in Obsidian, and those changes have always been
// invisible to memory. This module closes that half of the provenance rule:
//
//   ASCEND MUTATION   → core write → (vault state + event) → memory
//   OBSIDIAN MUTATION → vault state → RECONCILER → event   → memory
//
// THE MODEL — the same replay pattern core/notifications already uses for operator actions, applied
// to knowledge of the external world. There is NO new persistence: the event log IS the observation
// state.
//
//   current vault → normalize → fingerprint → replay observations → compare
//       unchanged → nothing
//       changed   → observation.captured + the truthful transition
//       new       → observation.captured ONLY
//       invalid   → skip entirely; the prior observation stands
//
// THE HARD RULE: the reconciler may observe the vault, but it may never infer an event the observed
// state cannot prove. If a phase moved `not_started → complete` between two syncs, that is ONE
// `project.phase_completed` — not a fabricated `phase_started` followed by `phase_completed`. The
// vault holds only the end state, so only the end state may be claimed.
//
// A BASELINE IS NOT A BIRTH. An object seen for the first time yields `observation.captured` and
// nothing else. "Ascend observed this existing state" is true on first run; "Ascend witnessed this
// being created" would be a lie about objects that predate the reconciler entirely.
//
// TIME. `occurred_at` is the OBSERVATION time, always. The vault's own dates (a phase's `completed`)
// are the operator's claim, not Ascend's knowledge, and backdating would also break the ordering
// contract in core/events: an event appended last while sorting into the past would make append
// order and occurred_at disagree.
//
// It emits; it computes no business intelligence, ranks nothing, and interprets nothing.

import "server-only";
import { emitEvent, readEvents } from "@/core/events";
import { PHASE_KEYS, type EntityKind, type EventType } from "@/domain";
import { observeVault, type Observation, type ObservedState } from "./observation";

/** One business transition the reconciler decided the evidence supports. */
export type ReconciledTransition = {
  type: EventType;
  entity: EntityKind;
  entityId: string;
  from: string;
  to: string;
};

export type SyncReport = {
  /** Objects successfully observed this run. */
  observed: number;
  /** Objects seen for the first time — observation only, never a creation event. */
  baseline: number;
  /** Objects whose observable state changed since the last observation. */
  updated: number;
  /** Objects that could not be trusted and were left alone. */
  skipped: { key: string; reason: string }[];
  /** The business events emitted, in emission order. */
  transitions: ReconciledTransition[];
};

/** A prior observation, reconstructed from the event log. */
type PriorObservation = { stateFingerprint: string; state: ObservedState };

/**
 * Replay `observation.captured` into the last known state per object.
 *
 * Later events overwrite earlier ones, so the final map is the most recent observation of each
 * object — exactly how core/notifications.readActionState reconstructs operator action state.
 */
async function replayObservations(): Promise<Map<string, PriorObservation>> {
  const events = await readEvents({ types: ["observation.captured"] });
  const map = new Map<string, PriorObservation>();
  for (const e of events) {
    const key = `${e.subject.entity}:${e.subject.entity_id}`;
    const fingerprint = e.data?.state_fingerprint;
    const state = e.data?.observed_state;
    if (typeof fingerprint !== "string") continue;
    map.set(key, {
      stateFingerprint: fingerprint,
      state: (state && typeof state === "object" ? state : {}) as ObservedState,
    });
  }
  return map;
}

/**
 * Which phase transition the evidence supports, or null when the domain has no type for it.
 *
 * Only the DESTINATION is claimed. A phase that reads `complete` where it previously read
 * `not_started` proves exactly one thing: it is complete now. Whether it passed through
 * `in_progress` is unknowable from the vault, so it is not asserted.
 *
 * Backwards moves (a phase reopened from `complete`) are real transitions with no domain event
 * type. They are deliberately left unrecorded rather than described with a forward event that would
 * misstate what happened — the same posture document reversals took before the contract gained
 * `document.status_changed`.
 */
function phaseTransitionType(from: string, to: string): EventType | null {
  if (from === to) return null;
  if (to === "complete") return "project.phase_completed";
  if (to === "skipped") return "project.phase_skipped";
  if (to === "in_progress" && from === "not_started") return "project.phase_started";
  return null;
}

/** True when every phase has reached a terminal state — the observed condition for a launch. */
function allPhasesResolved(state: ObservedState): boolean {
  return PHASE_KEYS.every((k) => state[k] === "complete" || state[k] === "skipped");
}

/**
 * Compare one object against its prior observation and emit what the evidence proves.
 *
 * Emission order per object is deliberate: business transitions first, then the observation that
 * records the new baseline. If a transition write fails, the observation is not advanced, so the
 * next sync sees the same difference again rather than silently losing it.
 */
async function reconcileObject(
  obs: Observation,
  prior: PriorObservation | undefined,
  report: SyncReport
): Promise<void> {
  // FIRST SIGHTING — baseline only. No creation event, ever.
  if (!prior) {
    report.baseline += 1;
    await emitEvent({
      type: "observation.captured",
      actor: "system",
      subject: { entity: obs.entity, entity_id: obs.entityId },
      data: {
        state_fingerprint: obs.stateFingerprint,
        content_fingerprint: obs.contentFingerprint,
        observed_state: obs.state,
        baseline: true,
      },
    });
    return;
  }

  // IDEMPOTENCY — the state fingerprint is the whole test. A prose edit moves the content
  // fingerprint but not this one, so re-syncing an unchanged business state emits nothing.
  if (prior.stateFingerprint === obs.stateFingerprint) return;

  report.updated += 1;
  const emitted: ReconciledTransition[] = [];

  if (obs.entity === "project") {
    for (const phase of PHASE_KEYS) {
      const from = prior.state[phase] ?? "not_started";
      const to = obs.state[phase] ?? "not_started";
      const type = phaseTransitionType(from, to);
      if (!type) continue;
      emitted.push({ type, entity: "project", entityId: obs.entityId, from, to });
      await emitEvent({
        type,
        actor: "system",
        subject: { entity: "project", entity_id: obs.entityId },
        data: { phase, from, to, source: "vault_observation" },
      });
    }
    // A launch is a CONDITION becoming true, not a stored field: every phase terminal now, and not
    // before. Emitted once, because after this the prior observation already satisfies it.
    if (!allPhasesResolved(prior.state) && allPhasesResolved(obs.state)) {
      emitted.push({
        type: "project.launched",
        entity: "project",
        entityId: obs.entityId,
        from: "in_progress",
        to: "launched",
      });
      await emitEvent({
        type: "project.launched",
        actor: "system",
        subject: { entity: "project", entity_id: obs.entityId },
        data: { source: "vault_observation" },
      });
    }
  } else {
    // client · prospect · document — a single `status` field, direction-neutral by design.
    const from = prior.state.status ?? "";
    const to = obs.state.status ?? "";
    const STATUS_EVENT: Partial<Record<EntityKind, EventType>> = {
      client: "client.status_changed",
      prospect: "prospect.status_changed",
      document: "document.status_changed",
    };
    const type = STATUS_EVENT[obs.entity];
    if (type && from !== to && to.length > 0) {
      emitted.push({ type, entity: obs.entity, entityId: obs.entityId, from, to });
      await emitEvent({
        type,
        actor: "system",
        subject: { entity: obs.entity, entity_id: obs.entityId },
        data: { from, to, source: "vault_observation" },
      });
    }
  }

  report.transitions.push(...emitted);

  // The new baseline, recorded after the transitions it explains.
  await emitEvent({
    type: "observation.captured",
    actor: "system",
    subject: { entity: obs.entity, entity_id: obs.entityId },
    data: {
      state_fingerprint: obs.stateFingerprint,
      content_fingerprint: obs.contentFingerprint,
      observed_state: obs.state,
      previous_state: prior.state,
    },
  });
}

/**
 * Inspect the vault, compare against what Ascend last observed, and record the difference.
 *
 * Explicit and operator-triggered by design: reads elsewhere in the product stay pure, and this is
 * the one place where looking at the vault can append to memory.
 */
export async function reconcileVault(): Promise<SyncReport> {
  const { observations, skipped } = await observeVault();
  const prior = await replayObservations();

  const report: SyncReport = {
    observed: observations.length,
    baseline: 0,
    updated: 0,
    skipped,
    transitions: [],
  };

  for (const obs of observations) {
    await reconcileObject(obs, prior.get(obs.key), report);
  }
  return report;
}