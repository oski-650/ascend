// eslint.config.mjs — lint configuration for apps/os (hardening pass).
//
// WHY THIS FILE EXISTS: apps/os had a `lint` script but no config and no eslint dependency, so bare
// `eslint` walked up to the repository-root config. That root config wraps eslint-config-next in
// FlatCompat (`compat.extends("next/core-web-vitals", "next/typescript")`) — the legacy eslintrc
// pattern. eslint-config-next@16 ships NATIVE flat configs, and asking FlatCompat to resolve them as
// eslintrc shareable configs throws a circular-JSON error during validation. Result: `npm run lint`
// crashed rather than linting.
//
// This config imports the flat exports directly, which is the supported path for eslint 9 +
// eslint-config-next 16. It does not touch the root config (the root site has the same pre-existing
// breakage, reported separately).

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  // Build output and dependencies must be ignored FIRST — linting generated bundles produces
  // thousands of meaningless findings and pulls in rule names this config does not define.
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts", "**/*.tsbuildinfo"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;