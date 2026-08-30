// tests/architecture/authorization-surface — THE F54 MATCHER, shared by the rule and its control.
//
// One function, two callers. F54 runs it over the real page surface and expects `[]`; F55 runs the
// SAME function over a fixture directory of deliberate violations and expects each to be reported.
// If they used different logic, F55 would prove nothing about F54.
//
//   > F54/F55 enforce WHERE authorization may happen. They do not change authorization behaviour.
//
// ─── WHY THIS READS CODE AND NOT PROSE ─────────────────────────────────────────────────────────
//
// `filesMatching`/`stripComments` remove comments before matching, and that is deliberate here:
// slice 3 wrote doc comments on thirteen pages explaining that `requireCapability` decides at the
// DATA boundary. A rule that failed on those would pressure the next person to delete the
// explanation rather than the violation.
//
// This is the OPPOSITE of §23's choice for the retired unscoped-index constant, which is banned even
// inside comments — there the identifier must not survive anywhere to be copied back. Here the
// identifiers are legitimately discussed. The difference is intentional, not an inconsistency.

import { read, sourceFiles, stripComments } from "./source-graph";

/**
 * The DECISION surface. Referencing any of these is authorizing, wherever it happens.
 *
 * `requirePagePrincipal` is included while it still has ZERO consumers — slice 1 built it, slice 2
 * put the check inside the DAL instead, and it is the most convenient tool a page could use to start
 * deciding. Banning an unused affordance costs nothing; banning it after something depends on it is
 * a negotiation.
 */
const DECISION_IDENTIFIERS =
  /\bcan\s*\(|\brequireCapability\b|\bcapabilitiesFor\b|\bROLE_CAPABILITIES\b|\bvisibilityFor\b|\brequirePagePrincipal\b|\bpageAuthority\b|\b__unsafePrincipalForTests\b/;

/** The decision TABLE and the principal CONSTRUCTOR. No file on this surface may import either. */
const FORBIDDEN_MODULES = /from\s+"@\/core\/auth\/(capabilities|principal)"/;

/** `@/core/auth/authority` — importable by the denial handler, and by nothing else. */
const AUTHORITY_MODULE = /from\s+"@\/core\/auth\/authority"/;

/**
 * The ONE file permitted to import the authority module, and only for `CapabilityDenied`.
 *
 * Pinned to an exact path in the same style as `__unsafePrincipalForTests` in F50: a second importer
 * FAILS rather than being appended to a list, because an exemption list is how a narrow exception
 * becomes a general one.
 */
export const DENIAL_HANDLER = "components/auth/renderOrDenied.tsx";

/**
 * Every file the rule governs: all of `components/`, and `app/` EXCEPT `app/api/`.
 *
 * Routes are excluded because F46–F49 already own them, and they authorize on purpose — `authorize()`
 * is their whole job. Including them would make this rule contradict those.
 */
export function pageSurfaceFiles(): string[] {
  return [
    ...sourceFiles("app").filter((f) => !f.startsWith(`app${"/"}api/`)),
    ...sourceFiles("components"),
  ];
}

/** Files under a fixture directory, for the F55 control. */
export function fixtureFiles(which: "violating" | "clean"): string[] {
  return sourceFiles(`tests/architecture/fixtures/authorization-surface/${which}`);
}

/**
 * Report every way a file on this surface authorizes rather than copes.
 *
 * Returns human-readable findings rather than booleans so a failure names the file AND the reason —
 * a rule that says only "something is wrong" gets muted rather than fixed.
 */
export function authorizationViolations(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const code = stripComments(read(file));

    if (FORBIDDEN_MODULES.test(code)) {
      out.push(`${file}: imports the capability table or the principal constructor`);
    }
    if (AUTHORITY_MODULE.test(code) && !file.endsWith(DENIAL_HANDLER)) {
      out.push(`${file}: imports @/core/auth/authority — only ${DENIAL_HANDLER} may`);
    }
    const decision = DECISION_IDENTIFIERS.exec(code);
    if (decision) {
      out.push(`${file}: references the decision surface (${decision[0].trim()})`);
    }
  }
  return out.sort();
}
