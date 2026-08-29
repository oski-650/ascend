// vitest.config.ts — test-only configuration. Adds no production capability.
//
// Node environment only: Layer A tests pure engine functions and Layer B reads source text.
// Nothing under test requires a DOM, so no jsdom/happy-dom is installed.
//
// The aliases mirror tsconfig.json `paths` exactly so tests import production modules by their
// real specifiers (`@/domain`, `@/engines/...`). Tests therefore exercise the same module graph the
// application does — no parallel wiring, no second source of truth.
//
// `server-only` is aliased to an empty stub because it is not a standalone package here: Next
// resolves it at build time via its own alias. The stub exists ONLY so that importing a module
// which declares `import "server-only"` (e.g. core/command-runtime) does not fail resolution under
// Vitest. It changes no production behaviour and introduces no runtime seam into frozen code.

import { defineConfig } from "vitest/config";
import path from "node:path";

// import.meta.dirname keeps this file ESM-native (Node 20+), avoiding the CJS interop warning
// that `__dirname` produces under Vite's native config loader.
const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    // Order matters: the more specific `@/domain` patterns must precede the general `@/` pattern.
    // Replacements carry an explicit trailing separator — without it `@/engines/x` concatenates
    // into `<root>engines/x` and fails to resolve.
    alias: [
      { find: /^@\/domain$/, replacement: path.join(root, "packages", "domain") },
      { find: /^@\/domain\//, replacement: path.join(root, "packages", "domain") + path.sep },
      { find: /^server-only$/, replacement: path.join(root, "tests", "support", "server-only-stub.ts") },
      { find: /^@\//, replacement: root + path.sep },
    ],
  },
  test: {
    environment: "node",
    // Clears ASCEND_PROSPECT_SOURCE so a deployment setting sourced from .env.production.local
    // cannot decide which store a unit test reads. See tests/support/hermetic-env.ts.
    setupFiles: ["tests/support/hermetic-env.ts"],
    include: ["tests/**/*.test.ts"],
    // Deterministic reporting order; tests themselves must not depend on execution order.
    sequence: { shuffle: false },
    clearMocks: true,
    restoreMocks: true,
  },
});