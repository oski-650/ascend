// tests/architecture/invite-separation — THE F58 MATCHER, shared by the rule and its control.
//
// One function, two callers, exactly as `authorization-surface` serves F54/F55: F58 runs it over the
// real surfaces and expects `[]`, and its control runs the SAME function over deliberate violations
// and expects each to be reported. Different logic in the two places would make the control prove
// nothing about the rule.
//
// ─── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
//
// The §28 evidence review found F58 passing with its matchers inlined and NOTHING proving they could
// fire. They did fire — verified by hand against `app/portal/[token]/page.tsx` — but a hand check is
// not a control the gate re-runs, and a regex that silently stopped matching would leave the rule
// green forever. That is the shape of fitness rule this project has spent two stages removing.

import { read, sourceFiles, stripComments } from "./source-graph";

/** The CLIENT PORTAL token mechanism. `lib/portal` itself is the module, not an importer of it. */
const PORTAL_MODULE = /from\s+"@\/lib\/portal"|from\s+"@\/lib\/portalTypes"/;

/** The OPERATOR invitation mechanism. */
const OPERATOR_MODULE = /from\s+"@\/core\/auth\/invitations"/;

/** Everything that participates in the OPERATOR invitation flow. */
export const PARTNER_INVITE_SURFACE = [
  "core/auth/invitations.ts",
  "core/auth/directory.ts",
  "app/api/invitations/route.ts",
  "app/api/invitations/accept/route.ts",
  "app/invite/[token]/page.tsx",
  "app/admin/invitations/page.tsx",
  "components/InvitePartnerPanel.tsx",
  "components/auth/AcceptInvitationForm.tsx",
];

/** The client-portal token mechanism, and the surfaces that legitimately use it. */
export const PORTAL_SURFACE = [
  "lib/portal.ts",
  "components/InviteLinkPanel.tsx",
  "app/api/portal/invites/route.ts",
  "app/portal/[token]/page.tsx",
];

/** Files under a fixture directory, for the control. */
export function fixtureFiles(which: "violating" | "clean"): string[] {
  return sourceFiles(`tests/architecture/fixtures/invite-separation/${which}`);
}

/**
 * Report every crossing between the two invitation systems.
 *
 * Human-readable findings rather than booleans, so a failure names the file AND the direction — a
 * rule that says only "something is wrong" gets muted rather than fixed.
 *
 * `both` is checked first and reported alone: a file importing both is one defect, and reporting it
 * three times would make the count meaningless.
 */
export function inviteSeparationViolations(
  files: readonly string[],
  side: "partner" | "portal" | "any"
): string[] {
  const out: string[] = [];
  for (const file of files) {
    const code = stripComments(read(file));
    const portal = PORTAL_MODULE.test(code);
    const operator = OPERATOR_MODULE.test(code);

    if (portal && operator) {
      out.push(`${file}: imports BOTH invitation systems`);
      continue;
    }
    if (side !== "portal" && portal) {
      out.push(`${file}: a partner invitation surface imports the CLIENT PORTAL mechanism`);
    }
    if (side !== "partner" && operator && side === "portal") {
      out.push(`${file}: the client portal imports the OPERATOR invitation mechanism`);
    }
  }
  return out.sort();
}

/** Every production file, for the whole-repository sweep that catches files nobody listed. */
export function allProductionFiles(): string[] {
  return [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib"), ...sourceFiles("core")];
}
