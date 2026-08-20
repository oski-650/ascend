// app/signals/actions — the notification action seam (docs/WORKING-SURFACE.md, slice 1).
//
// This is the missing piece the working-surface investigation identified. The notification engine,
// its assembler, its durable writers, and their event emission ALL already existed; the writers were
// simply unreachable from `app/`. So the operator could be told something needed attention and had
// no way to act on it — a surface you read, then leave. These three actions close that loop:
//
//     notification → attention queue → decision → dismiss/snooze/open → event in the spine
//
// WHAT THESE DO NOT DO. They contain no notification logic. Each is a thin delegation to the core
// writer that already owns the transition, which is also what keeps F21 satisfied: the durable write
// and its event emission stay inside `core/notifications`, never here. A route handler (or an action)
// that wrote the record itself would be exactly the arrangement F21 exists to prevent.
//
// No new event types were needed — `notification.dismissed`, `.viewed` and `.snoozed` already exist
// and are already emitted by the writers.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  dismissNotification,
  snoozeNotification,
  viewNotification,
} from "@/core/notifications";
import { snoozeUntil } from "@/mission-control";

/** The surface this action refreshes. Both live on Signals today. */
const SURFACE = "/signals";

export async function dismissNotificationAction(formData: FormData): Promise<void> {
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!signalKey) return;
  await dismissNotification(signalKey, fingerprint);
  revalidatePath(SURFACE);
}

export async function snoozeNotificationAction(formData: FormData): Promise<void> {
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!signalKey) return;
  // The surface REQUESTS a snooze; it does not define one. The duration is the engine's
  // (SNOOZE_DURATION_MS), reached through mission-control because F14 forbids app/ value-importing
  // an engine. All this layer contributes is the clock reading, injected as a value.
  await snoozeNotification(signalKey, fingerprint, snoozeUntil(Date.now()));
  revalidatePath(SURFACE);
}

/**
 * Record that the operator explicitly opened a notification's subject.
 *
 * EXPLICIT ONLY — never on render. `core/notifications` states the same rule (D-3.6b.2), and it
 * matters more than it looks: a view recorded by rendering would make merely loading the page mutate
 * the spine, which is the boundary `syncVault` was built to protect ("observing is not mutating").
 * It is also precisely the class of framework-generated signal the observation design rules out.
 */
export async function viewNotificationAction(formData: FormData): Promise<void> {
  const signalKey = String(formData.get("signalKey") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!signalKey) return;
  await viewNotification(signalKey, fingerprint);
  revalidatePath(SURFACE);

  // Opening is one operator gesture that both records the view and navigates, so the loop closes in
  // a single click rather than asking the operator to act twice.
  //
  // The destination is resolved by navigation/routing on the server and round-trips through the
  // form, so it is treated as untrusted on the way back: only a same-origin absolute path is
  // followed. `//host` would be protocol-relative and off-site, hence the second check.
  const href = String(formData.get("href") ?? "");
  if (href.startsWith("/") && !href.startsWith("//")) redirect(href);
}
