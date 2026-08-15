"use server";

// The mutation CONFIRM transport (DC-5x.4): a POST-only Server Action. Reads/navigation stay on GET;
// a state change can only be triggered by this POST. The action owns NO mutation logic — it forwards
// the explicit confirm to core/command-runtime.runCommand, which dispatches to the capability handler,
// which delegates to the existing core write API. Post-Redirect-Get: after the write it redirects back
// to /console with a compact outcome, so a refresh never re-submits the write.
//
// ─── CLOSING Action → Event → Entity ────────────────────────────────────────────────────────────
// `CommandResult` is `{ ok, message, data? }` and carries no entity — the finance mutations return
// only `{ changed }`. The affected entity is nonetheless already recorded, by the frozen writer
// itself: core/finance.markPaid/markUnpaid emit an event whose `subject` is exactly
// `{ entity: EntityKind, entity_id: string }` — the shape routeForEntity and focusHrefFor consume.
//
// So this action does not need a richer command contract, and does not get one. It brackets the
// confirmed call with a read of the canonical event log and identifies the events THIS execution
// produced by diffing `event_id` (unique, and the reader returns them ordered). That is the loop
// stated literally: confirm → mutation → event emitted → result identifies the affected entity.
//
// Nothing is inferred. If the frozen writer emitted no event — which is exactly what an idempotent
// no-op does — no destination is offered. The argument NAME is never used to guess an EntityKind,
// even though today's three executable commands happen to name their argument after one; that is a
// naming coincidence, not a contract.
//
// The subject is carried across the redirect as two SEPARATE params. Composing `entity:id` here
// would duplicate the graph id format that graph-view/contract owns (F19); the page resolves both
// destinations from the parts through the canonical owners.

import { redirect } from "next/navigation";
import { runCommand } from "@/core/command-runtime";
import { readEvents } from "@/core/events";

/**
 * How far back the before/after diff reads. A mutation emits at most one event, so this only has to
 * exceed the number of events a single confirmed command can produce. Bounded to keep the read cheap.
 */
const EVENT_SCAN_LIMIT = 30;

export async function confirmMutation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const argName = String(formData.get("argName") ?? "");
  const argValue = String(formData.get("arg") ?? "");
  const q = String(formData.get("q") ?? "");

  const args = argName ? { [argName]: argValue } : {};

  // Snapshot the event log's identity set BEFORE the write, so the events this call produces can be
  // told apart from everything already there.
  const before = await readEvents({ limit: EVENT_SCAN_LIMIT });
  const knownEventIds = new Set(before.map((e) => e.event_id));

  const result = await runCommand(id, args, { confirm: true }); // the ONLY confirmed call path

  const changed = result.ok && (result.data as { changed?: boolean } | undefined)?.changed === true;
  const outcome = result.ok ? (changed ? "applied" : "noop") : "error";

  const params = new URLSearchParams({ q, prev: id, arg: argValue, outcome });

  // The typed error is carried through rather than collapsed into a generic banner — the runtime
  // already normalised it into operator-safe text, and discarding it would be swallowing it.
  if (!result.ok) params.set("error", result.error);

  // Only an OBSERVED event may produce the event row and the entity destinations. A no-op emits
  // nothing by design, so it gets nothing here.
  if (changed) {
    const after = await readEvents({ limit: EVENT_SCAN_LIMIT });
    const emitted = after.filter((e) => !knownEventIds.has(e.event_id));
    const event = emitted[emitted.length - 1];
    if (event) {
      params.set("eventType", event.type);
      params.set("subjectEntity", event.subject.entity);
      params.set("subjectId", event.subject.entity_id);
      // `data.client` is a field the frozen writer already puts on the envelope. Copied, never
      // derived — the same posture dossier.eventQualifier takes toward `data.phase`.
      const client = event.data?.client;
      if (typeof client === "string" && client.length > 0) params.set("subjectClient", client);
    }
  }

  redirect(`/console?${params.toString()}`);
}