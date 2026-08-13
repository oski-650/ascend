// mission-control/assemble.ts — CALLER-OWNED assembly (MC-1: invoke; compute nothing).
//
// MC-4: the firing-signal producer is owned once by ./signals (assembleFiringSignals) and shared
// across consumers. This module only invokes Decision.rank() over that single producer output —
// it scores nothing, detects nothing, and ranks nothing of its own. (Behavior of the priority feed
// is unchanged from Phase 3.1: rank(assembleFiringSignals()) === the former inline assembly + rank.)

import "server-only";
import { rank, type PriorityItem } from "@/engines/decision-engine";
import { assembleFiringSignals } from "./signals";

export async function assemblePriorityFeed(): Promise<PriorityItem[]> {
  return rank(await assembleFiringSignals());
}
