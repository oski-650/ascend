// mission-control/notifications.ts — CALLER-OWNED assembly for the Notification consumer (MC-1/MC-4).
//
// Maps the SHARED firing signals (assembled once by ./signals) into the Notification Engine's input,
// reads the stored operator-action state (core/notifications), and invokes the pure reconcile().
// It ranks nothing, detects nothing, and writes nothing. The producer-owned fingerprint is PRESERVED
// from the signal (severity/tier) — never derived here.

import "server-only";
import type { RankableSignal } from "@/engines/decision-engine";
import { reconcile, type FiringSignal, type Notification } from "@/engines/notification-engine";
import { readActionState } from "@/core/notifications";

/** Stable idempotency key `kind:entity:id` (mirrors the automations `firing_id`). Structural, not interpretive. */
export function signalKeyOf(s: RankableSignal): string {
  return `${s.kind}:${s.subject.entity}:${s.subject.id}`;
}

/** Producer-owned fingerprint: the producer's own severity (opportunity) or tier (health), PRESERVED. */
export function fingerprintOf(s: RankableSignal): string {
  return s.severity ?? s.tier ?? "";
}

/** Structural transform: shared RankableSignal[] → the engine's FiringSignal[]. No interpretation. */
export function toFiringSignals(signals: RankableSignal[]): FiringSignal[] {
  return signals.map((s) => ({
    signalKey: signalKeyOf(s),
    fingerprint: fingerprintOf(s),
    subject: s.subject,
    kind: s.kind,
    severity: s.severity,
    title: s.evidence.detail,
  }));
}

/**
 * Reconcile the shared firing signals against stored operator actions → the inbox read-model.
 * Takes the already-assembled signals (MC-4: assembled once, distributed) — it does not re-assemble.
 * Pure read-time projection (D-3.6.3): reads action-state, invokes reconcile(); emits nothing.
 */
export async function assembleNotifications(signals: RankableSignal[]): Promise<Notification[]> {
  const actions = await readActionState();
  // D-3.6b.1: the clock is read HERE (surface orchestration) and injected — never inside the engine.
  return reconcile(toFiringSignals(signals), actions, Date.now());
}
