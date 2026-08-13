// packages/commands — PURE command contracts + metadata + deterministic matching (Phase 5, Face 2).
//
// This package is INCAPABLE of executing anything: it holds no handlers, no execute() closures, no
// registry of definitions — only metadata shapes and a deterministic matcher. It imports ONLY the
// domain kernel (`EntityKind`); it cannot reach core / engines / fs / Next / handlers. Discovery here
// NEVER invokes a command and NEVER causes a side effect. (CommandCatalog aggregation + execution live
// in core/command-runtime; concrete definitions are owned by their capability modules.)
//
// Separation of concerns (DC-5.2): metadata + matching = here (pure); execution = core/command-runtime.

import type { EntityKind } from "@/domain";

export type CommandId = string;

/**
 * "navigation" = surface-resolved; "read" = executed via core/command-runtime; "mutation" = a
 * confirm-gated write executed via core/command-runtime that DELEGATES to an existing core write API
 * (Phase 5.x). This union is additive — navigation/read behavior is unchanged. Matching treats all
 * kinds identically; the runtime enforces the per-kind execution rules.
 */
export type CommandKind = "navigation" | "read" | "mutation";

/** A single explicit, declared argument. No inference, no NL — the operator supplies it explicitly. */
export type CommandArg = { name: string; required: boolean; description?: string };

/**
 * Navigation target descriptor — an ENTITY intent ONLY (DC-5.7). It carries no route string and no
 * routing logic; the presentation layer (navigation/routing) remains the sole owner of entity→route.
 */
export type NavTarget = { entity: EntityKind };

/** The discovery projection — everything the matcher and the surface may see. Contains NO handler. */
export type CommandMetadata = {
  id: CommandId;
  label: string;
  description: string;
  verbs: readonly string[];
  kind: CommandKind;
  args: readonly CommandArg[];
  nav?: NavTarget; // present iff kind === "navigation"
};

export type CommandMatch = { metadata: CommandMetadata; score: number };

/** The minimal typed result contract. The runtime shapes it; the Console renders it. */
export type CommandResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Deterministic mechanical normalization — the ONLY normalization applied. It lowercases, trims, and
 * collapses runs of internal whitespace to a single space. It changes no meaning: no stemming, no
 * synonyms, no fuzzy folding.
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

const EXACT = 3;
const PREFIX = 2;
const SUBSTRING = 1;

/**
 * Deterministic command discovery over a catalog of metadata. Pure and side-effect-free — it NEVER
 * invokes a handler. Per command, score = the best tier across its verbs: exact(3) > prefix(2) >
 * substring(1); tier 0 excludes the command. An empty query lists the whole catalog (score 0) for
 * discovery. Stable sort: score↓ → label↑ → id↑. No fuzzy matching, no semantics, no clock, no
 * randomness, no hidden state → same (catalog, input) ⇒ identical matches.
 */
export function matchCommands(catalog: readonly CommandMetadata[], input: string): CommandMatch[] {
  const q = normalize(input);
  const matches: CommandMatch[] = [];

  for (const metadata of catalog) {
    let score = 0;
    if (q.length > 0) {
      for (const verb of metadata.verbs) {
        const v = normalize(verb);
        const tier = v === q ? EXACT : v.startsWith(q) ? PREFIX : v.includes(q) ? SUBSTRING : 0;
        if (tier > score) score = tier;
      }
      if (score === 0) continue; // no verb matched — exclude
    }
    matches.push({ metadata, score });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.metadata.label.localeCompare(b.metadata.label) ||
      a.metadata.id.localeCompare(b.metadata.id)
  );
  return matches;
}
