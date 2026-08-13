// mission-control/effort — the Effort-Distribution ORCHESTRATOR (Phase 10, MC-1/MC-3).
//
// Mission Control GATHERS time entries (via the existing frozen core/production reader) and INVOKES the
// pure engine; it performs no aggregation/derivation itself. Read-only: no writes, no events. The engine
// is clock-free, so nothing is injected.

import "server-only";
import { getAllEntries } from "@/core/production";
import { buildEffortDigest, type EffortDigest } from "@/engines/effort-engine";

export async function assembleEffort(): Promise<EffortDigest> {
  const entries = await getAllEntries();
  return buildEffortDigest(entries);
}
