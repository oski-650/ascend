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
  // Only the rankable channel. Indeterminate signals carry no score and must never be handed to
  // rank(), whose weighting ternary would silently score an absent tier at 15 — the `healthy`
  // weight. They reach the operator through the attention queue instead (./signals).
  return rank((await assembleFiringSignals()).rankable);
}
