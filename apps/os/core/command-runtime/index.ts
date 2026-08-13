// core/command-runtime — CommandCatalog aggregation + the ONLY V1 execution dispatcher (Phase 5).
//
// Responsibilities (DC-5.2): assemble the one CommandCatalog from capability-owned definitions,
// project discovery metadata for the surface, validate explicit arguments, dispatch execution, and
// shape a typed CommandResult. It owns NO command logic (that lives in the capability modules) and NO
// matching (that lives in packages/commands). V1 imports only core READ capabilities — no engines, no
// writes, no event emission, no upward imports (DC-5.5).
//
// Registration (DC-5.3): a single EXPLICIT, statically-auditable, deterministically-ordered list.
// No dynamic contributors, no filesystem/environment scanning, no auto-discovery.

import "server-only";
import type { CommandMetadata, CommandResult } from "@/packages/commands";
import type { CommandArgs, CommandDefinition } from "./types";
import { navigationCommands } from "./commands/navigation";
import { financeCommands } from "@/core/finance/commands";
import { financeMutationCommands } from "@/core/finance/mutation-commands";

/** The explicit, ordered V1 registration list. Aggregates definitions; never redefines their logic. */
const DEFINITIONS: readonly CommandDefinition[] = [
  ...navigationCommands, // presentation-intent (surface-resolved)
  ...financeCommands, // capability-owned read commands
  ...financeMutationCommands, // capability-owned mutation commands (delegate to core writes; Phase 5.x)
];

/** Execution options. `confirm` gates mutation execution: unconfirmed ⇒ preview only (no write). */
export type RunOptions = { confirm?: boolean };

/** id → definition, with a load-time one-owner guarantee (duplicate id ⇒ registration error). */
const BY_ID: ReadonlyMap<string, CommandDefinition> = (() => {
  const map = new Map<string, CommandDefinition>();
  for (const def of DEFINITIONS) {
    if (map.has(def.metadata.id)) throw new Error(`Duplicate command id in registration: ${def.metadata.id}`);
    map.set(def.metadata.id, def);
  }
  return map;
})();

/**
 * The CommandCatalog — the discovery metadata projection. Handlers never reach the surface; only
 * metadata does. Deterministic order (the registration order).
 */
export function listCommands(): CommandMetadata[] {
  return DEFINITIONS.map((d) => d.metadata);
}

/**
 * The ONLY V1 execution dispatcher. Execution is EXPLICIT — invoked here, never during discovery. It
 * validates required args, dispatches to the owning capability's handler, and always returns a typed
 * CommandResult: unknown id, navigation misuse, missing args, and handler failure all become typed
 * errors — nothing throws through to the surface.
 */
export async function runCommand(id: string, args: CommandArgs = {}, options: RunOptions = {}): Promise<CommandResult> {
  const def = BY_ID.get(id);
  if (!def) return { ok: false, error: `Unknown command: ${id}` };

  const kind = def.metadata.kind;

  if (kind === "navigation") {
    return { ok: false, error: `Command "${id}" is navigation-only and is resolved by the presentation layer.` };
  }

  // Explicit argument validation (read + mutation).
  for (const arg of def.metadata.args) {
    const value = args[arg.name];
    if (arg.required && !(typeof value === "string" && value.trim().length > 0)) {
      return { ok: false, error: `Missing required argument: ${arg.name}` };
    }
  }

  // Mutation: confirm-gated. Unconfirmed ⇒ PREVIEW (read-only, no write, no event). Confirmed ⇒
  // EXECUTE, which delegates to an existing core write API (the sole writer + sole event emitter).
  // A write is therefore structurally impossible without an explicit confirm signal.
  if (kind === "mutation") {
    const handler = options.confirm ? def.execute : def.preview;
    if (!handler) {
      return { ok: false, error: `Command "${id}" is missing its ${options.confirm ? "execute" : "preview"} handler.` };
    }
    try {
      return await handler(args);
    } catch (e) {
      return { ok: false, error: `Command failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Read.
  if (!def.execute) return { ok: false, error: `Command "${id}" is not executable.` };
  try {
    return await def.execute(args);
  } catch (e) {
    return { ok: false, error: `Command failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}