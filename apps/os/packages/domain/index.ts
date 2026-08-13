// domain — the shared kernel of Ascend OS (Part IV §IV.1).
//
// PURITY CONTRACT: nothing under domain/ may import fs, vault paths, Next.js,
// databases, or any core/engine/agent module. Entities, branded ids, enums,
// invariants, and event types ONLY. Safe for client bundles, server, CLI, MCP.
//
// Fitness function (Part I §9): `packages/*` import nothing with I/O.

export * from "./ids";
export * from "./enums";
export * from "./entities";
export * from "./events";
