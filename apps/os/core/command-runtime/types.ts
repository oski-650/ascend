// core/command-runtime/types — the EXECUTABLE command definition shape (types only; no runtime code).
//
// Kept separate from index.ts so capability-owned definition modules (which the aggregator imports)
// can import this type without an import cycle. `packages/commands` intentionally does NOT define this
// — an executable definition (with a handler) belongs to the execution layer, never the pure package.

import type { CommandMetadata, CommandResult } from "@/packages/commands";

/** Explicit argument bag — string values supplied by the operator; validated by the runtime. */
export type CommandArgs = Record<string, string>;

/**
 * A concrete command: its discovery metadata plus handlers owned by the capability.
 *  • navigation → no handlers (surface-resolved).
 *  • read       → `execute` only.
 *  • mutation   → `preview` (READ-ONLY: describes the intended change; NO write, NO event) AND
 *                 `execute` (the write, which DELEGATES to an existing core write API).
 * Handlers are invoked ONLY by core/command-runtime.runCommand — `preview` when unconfirmed, `execute`
 * when confirmed — and never during discovery/matching.
 */
export type CommandDefinition = {
  metadata: CommandMetadata;
  preview?: (args: CommandArgs) => Promise<CommandResult> | CommandResult;
  execute?: (args: CommandArgs) => Promise<CommandResult> | CommandResult;
};
