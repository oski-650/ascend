// Navigation command definitions — metadata-only entity intents (Phase 5, DC-5.7).
//
// These carry NO route strings and NO routing logic — only an entity target descriptor. The Console
// surface resolves the actual route through the shared presentation router (navigation/routing), which
// remains the sole owner of entity→route semantics. Navigation commands have no `execute` handler:
// they are surface-resolved, never dispatched by the runtime. Each command has exactly one owning
// module (this file).

import type { CommandDefinition } from "../types";

export const navigationCommands: readonly CommandDefinition[] = [
  {
    metadata: {
      id: "open-client",
      label: "Open client",
      description: "Navigate to a client's page by slug.",
      verbs: ["open client", "client", "go to client"],
      kind: "navigation",
      args: [{ name: "slug", required: true, description: "The client's slug." }],
      nav: { entity: "client" },
    },
  },
  {
    metadata: {
      id: "open-prospect",
      label: "Open prospect",
      description: "Navigate to a prospect's page by slug.",
      verbs: ["open prospect", "prospect", "go to prospect"],
      kind: "navigation",
      args: [{ name: "slug", required: true, description: "The prospect's slug." }],
      nav: { entity: "prospect" },
    },
  },
];
