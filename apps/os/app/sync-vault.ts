"use server";

// The SYNC VAULT transport — the one place in Ascend where looking at the vault may append to memory.
//
// Deliberately an explicit operator action, not a page-load side effect. Reconciling on read would
// make every page view silently mutate the event spine, collapsing the cleanest boundary the system
// has: observing is not mutating. Keeping it manual also makes the reconciler's behaviour
// inspectable while it is still earning trust — the operator chooses when history is written.
//
// This action owns NO reconciliation logic. It invokes core/reconciler, which observes the vault,
// replays prior observations, and emits only what the observed state proves. Here we shape the
// result for display and revalidate the surfaces whose content may now have changed.

import { revalidatePath } from "next/cache";
import { reconcileVault } from "@/core/reconciler";

/** A quiet, factual summary. No interpretation, no urgency, no generated prose. */
export type SyncOutcome = {
  ok: boolean;
  /** One line stating what happened, assembled from counts the reconciler reported. */
  summary: string;
  /** Plain descriptions of each business transition recorded, in emission order. */
  changes: string[];
  skipped: number;
};

/** Event type → operator-facing phrase. A vocabulary map; it interprets nothing. */
const CHANGE_PHRASE: Record<string, (from: string, to: string) => string> = {
  "project.phase_completed": () => "project phase completed",
  "project.phase_started": () => "project phase started",
  "project.phase_skipped": () => "project phase skipped",
  "project.launched": () => "project launched",
  "client.status_changed": (from, to) => `client status ${from} → ${to}`,
  "prospect.status_changed": (from, to) => `prospect status ${from} → ${to}`,
  "document.status_changed": (from, to) => `document status ${from} → ${to}`,
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function syncVault(): Promise<SyncOutcome> {
  try {
    const report = await reconcileVault();

    const changes = report.transitions.map((t) => {
      const phrase = CHANGE_PHRASE[t.type]?.(t.from, t.to) ?? t.type.replace(/[._]/g, " ");
      return `${t.entityId} · ${phrase}`;
    });

    // Surfaces that read the event spine or vault state may now show something different.
    revalidatePath("/", "layout");

    const parts: string[] = [];
    if (report.baseline > 0) parts.push(`${plural(report.baseline, "observation")} recorded`);
    if (report.updated > 0) parts.push(`${plural(report.updated, "object")} changed`);
    if (report.skipped.length > 0) parts.push(`${plural(report.skipped.length, "object")} skipped`);

    return {
      ok: true,
      // The honest empty case gets its own sentence rather than "0 changes".
      summary: parts.length === 0 ? "No state changes detected." : parts.join(" · "),
      changes,
      skipped: report.skipped.length,
    };
  } catch (e) {
    // The vault being unreadable is an ordinary condition (an unmounted iCloud volume, a bad path),
    // not a crash. It is reported plainly and no memory is written.
    return {
      ok: false,
      summary: e instanceof Error ? e.message : "Sync failed.",
      changes: [],
      skipped: 0,
    };
  }
}