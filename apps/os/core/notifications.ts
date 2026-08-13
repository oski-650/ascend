// core/notifications — the ONLY writer of notification.* events (D-3.6.1/A).
//
// Owns the notification write (append operator-action events via core/events — the sole physical
// writer) and the read (fold notification.* → the latest operator action per signalKey). It stores
// ONLY operator actions (3.6a: dismiss); raised/resolved are derived by the engine, never persisted.
// No engine may emit notification.* — all writes route through here.

import "server-only";
import { emitEvent, readEvents } from "@/core/events";
import type { EntityKind } from "@/domain";

/** Operator actions persisted in 3.6a. (viewed / snoozed arrive in 3.6b.) */
export type NotificationActionKind = "dismissed" | "viewed" | "snoozed";

/** The folded latest action for a signalKey — a rebuildable read-model, never a second source of truth. */
export type ActionRecord = {
  signalKey: string;
  action: NotificationActionKind;
  fingerprint: string;
  at: string;
  until?: string; // present for `snoozed` — the ISO time the snooze expires
};

/** Recover the event subject from a `kind:entity:id` signalKey (structural split, no interpretation). */
function subjectOf(signalKey: string): { entity: EntityKind; entity_id: string } | null {
  const parts = signalKey.split(":");
  if (parts.length < 3) return null;
  return { entity: parts[1] as EntityKind, entity_id: parts.slice(2).join(":") };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Record an operator DISMISS for a signalKey, storing the producer-owned fingerprint at dismissal.
 * Idempotent: if the latest stored action is already `dismissed` with the SAME fingerprint, emit
 * nothing. Otherwise append one `notification.dismissed` event (actor: operator) via core/events.
 */
export async function dismissNotification(signalKey: string, fingerprint: string): Promise<void> {
  const state = await readActionState();
  const cur = state.get(signalKey);
  if (cur && cur.action === "dismissed" && cur.fingerprint === fingerprint) return; // idempotent no-op

  const subject = subjectOf(signalKey);
  if (!subject) return;

  await emitEvent({
    type: "notification.dismissed",
    actor: "operator",
    subject,
    data: { signal_key: signalKey, fingerprint },
  });
}

/** Record an operator VIEW (explicit only — never on render; D-3.6b.2). Idempotent per (signalKey, fingerprint). */
export async function viewNotification(signalKey: string, fingerprint: string): Promise<void> {
  const cur = (await readActionState()).get(signalKey);
  if (cur && cur.action === "viewed" && cur.fingerprint === fingerprint) return; // idempotent no-op
  const subject = subjectOf(signalKey);
  if (!subject) return;
  await emitEvent({ type: "notification.viewed", actor: "operator", subject, data: { signal_key: signalKey, fingerprint } });
}

/**
 * Record an operator SNOOZE until an ISO time. Idempotent per (signalKey, fingerprint, until). The
 * `until` is computed by the caller (surface) — core stores the fact; there is no timer or scheduler.
 */
export async function snoozeNotification(signalKey: string, fingerprint: string, until: string): Promise<void> {
  const cur = (await readActionState()).get(signalKey);
  if (cur && cur.action === "snoozed" && cur.fingerprint === fingerprint && cur.until === until) return;
  const subject = subjectOf(signalKey);
  if (!subject) return;
  await emitEvent({ type: "notification.snoozed", actor: "operator", subject, data: { signal_key: signalKey, fingerprint, until } });
}

/** Fold the notifications log → the latest operator action per signalKey (ascending order = latest wins). */
export async function readActionState(): Promise<Map<string, ActionRecord>> {
  const events = await readEvents({ domains: ["notifications"] });
  const map = new Map<string, ActionRecord>();
  for (const e of events) {
    const key = str(e.data?.signal_key);
    if (!key) continue;
    if (e.type === "notification.dismissed") {
      map.set(key, { signalKey: key, action: "dismissed", fingerprint: str(e.data?.fingerprint) ?? "", at: e.occurred_at });
    } else if (e.type === "notification.viewed") {
      map.set(key, { signalKey: key, action: "viewed", fingerprint: str(e.data?.fingerprint) ?? "", at: e.occurred_at });
    } else if (e.type === "notification.snoozed") {
      map.set(key, {
        signalKey: key,
        action: "snoozed",
        fingerprint: str(e.data?.fingerprint) ?? "",
        at: e.occurred_at,
        until: str(e.data?.until) ?? undefined,
      });
    }
  }
  return map;
}
