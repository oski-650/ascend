// The DECLARED authorization contract of the rendered surface (2G.1, F51).
//
// ─── THIS IS A TEST CONTRACT, NOT AN AUTHORIZATION SYSTEM ──────────────────────────────────────
//
// Nothing reads this at runtime. Pages do not call `can()` or `requireCapability()`, and adding a
// second place where authority is decided is exactly what this project has spent two stages
// removing. The chain is unchanged:
//
//     page → DAL → authority → allow | CapabilityDenied → data or explicit denial
//
// What this file does is state, per page, WHICH CAPABILITIES THAT PAGE IS EXPECTED TO DEMAND, so a
// test can compare the declaration against what the page actually demands when rendered. The
// declaration describes; the DAL decides.
//
// ─── WHY DECLARED-PLUS-OBSERVED, RATHER THAN STATIC ANALYSIS ───────────────────────────────────
//
// Two instruments were measured and rejected (STAGE2G §16-20):
//
//   • import-level analysis UNDER-reported `app/finance` — it imports the `lib/finance` re-export
//     shim, so the guarded module is one hop away;
//   • it also OVER-reported `app/portal/[token]` as `portal:admin` merely for importing
//     `lib/portal`, when the page calls only unguarded client-token functions. That direction is the
//     dangerous one: a rule whose failure mode pressures someone to add an operator capability to
//     the client portal would reintroduce the defect slice 2d just fixed.
//
// So F51 measures THE AUTHORIZATION BOUNDARY ACTUALLY REACHED, not the modules syntactically
// imported. Totality comes from the filesystem; correctness comes from execution.
//
// ─── `[]` IS A VALUE ───────────────────────────────────────────────────────────────────────────
//
// A page that demands nothing declares `[]` and is TESTED for demanding nothing. It is not an
// exemption, not an omission, and not an implicit default — the same rule F49 applies to routes,
// where an unmapped route is an error rather than an allow.
//
// ─── THE COUNTS ARE OUTPUTS ────────────────────────────────────────────────────────────────────
//
// No test asserts "11 demanding" or "15 empty". Those are today's measurements and will change. F51
// derives the page set from the filesystem and compares it to the keys here; a page with no entry
// fails, and an entry naming no page fails.
//
// ─── ONE DELIBERATELY STALE-BY-DESIGN PAIR ─────────────────────────────────────────────────────
//
// `console` and `search` declare `[]` and that is CORRECT TODAY: they build the knowledge index
// through `UNSCOPED_INTERNAL_INDEX`, which demands no authority. When the index is scoped, their
// runtime demand will change and **F51 must fail until these two declarations are updated**.
//
// That failure is the point. It is cheaper to let the gate catch the transition than to write the
// map in anticipation of an implementation that has not happened — a declaration written ahead of
// the code describes a system nobody has built.

import type { Capability } from "@/core/auth/capabilities";

/**
 * Every `app/**\/page.tsx`, keyed by its path relative to `app/`, with the root page as `/`.
 *
 * Transcribed from the corrected, function-body-bounded inventory measured at `6962570`.
 */
export const PAGE_AUTHORIZATION: Record<string, readonly Capability[]> = {
  // ── Pages that reach a guarded data-access boundary ──────────────────────────────────────────
  // Reaches every store through `mission-control` and the graph/brief derivations.
  "/": ["audits:*", "clients:*", "documents:*", "finance:*", "portal:admin", "production:read",
        "prospects:read", "search", "time:*"],
  "automations": ["pipeline:read"],
  "clients/[slug]/portal": ["clients:*", "portal:admin"],

  // ─── THE getClientDossier FAN-OUT ────────────────────────────────────────────────────────────
  //
  // `app/clients/[slug]/dossier.ts` — a COLOCATED route module, imported relatively — assembles a
  // client dossier across every store, reaching `listApprovalRequests` (portal:admin) among others.
  // Traced from a render-time stack, not inferred: ProjectPage -> getClientDossier ->
  // listApprovalRequests. Every static scan missed it, because they matched `@/`-aliased imports
  // and silently ignored relative ones.
  //
  // CONSEQUENCE WORTH KNOWING BEFORE 2G.3: both client pages are owner-only in practice. A sales
  // principal cannot render the client dossier at all.
  "clients/[slug]": ["audits:*", "clients:*", "documents:*", "finance:*", "portal:admin", "production:read", "time:*"],
  "clients/[slug]/project": ["audits:*", "clients:*", "documents:*", "finance:*", "portal:admin", "production:read", "time:*"],
  "crm": ["clients:*", "finance:*", "production:read", "time:*"],  // via lib/ehr -> core/finance
  "documents": ["clients:*", "documents:*"],
  "documents/[id]": ["clients:*", "documents:*"],
  // `prospects:read` is TRACED, not merely observed. app/finance/page.tsx calls buildForecast(),
  // computeKpis() and compileFinanceBrief(); the first two call listProspects() (lib/forecast.ts:118
  // and :171) and the third composes them. A forecast is pipeline-weighted by construction —
  // expected revenue is invoiced work PLUS weighted prospect value — so finance reads the sales
  // pipeline by definition rather than by accident. It looks surprising from the page's imports and
  // is not, which is the whole reason F51 measures the runtime instead of the import graph.
  "finance": ["clients:*", "finance:*", "prospects:read"],
  "maintenance": ["audits:*", "finance:*"],
  "production": ["production:read", "time:*"],
  "production/[client]": ["production:read"],

  // ── The prospect surfaces, and the reason they stopped being `[]` ────────────────────────────
  //
  // These declared `[]` until the Server Component prospect bridge, and the `[]` was never a fact
  // about the pages. F51 renders with ASCEND_PROSPECT_SOURCE unset — which means `vault`, and the
  // vault reader needs no capability — while 2E made `postgres` the source of truth production
  // actually runs. So the contract was being measured against a store nothing deploys.
  //
  //   vault      sales  []          postgres   sales  [prospects:read]
  //
  // The harness now selects the deployed store explicitly. `console` moved off `[]` in the same
  // measurement, for the same reason and not because the knowledge index was scoped.
  // `search` arrived with 2G.1 slice 4: the knowledge index no longer accepts a caller-supplied
  // visibility, so assembling one now authorizes the ACT through `search` — which both roles hold —
  // and derives WHAT IS DISCOVERED from the same principal. `prospects:read` stayed, and that was
  // the measurement's answer rather than a prediction: an owner render still discovers prospects
  // through the guarded reader. `/` gained `search` for the same reason, via projectGraph.
  "console": ["prospects:read", "search"],
  "sales": ["prospects:read"],
  "sales/[prospect]": ["prospects:read"],
  "tasks": ["finance:*", "production:read", "time:*"],

  // ── Pages that reach no guarded boundary. `[]` is declared and tested. ───────────────────────
  //
  // Grouped by WHY, because "demands nothing" has several different causes and only one of them is
  // expected to persist.
  //
  // Public or client-token surfaces — these must never acquire an operator capability:
  "login": [],
  "portal/[token]": [],                     // token-scoped invite record only (slice 2d)
  "portal/[token]/approve/[reqId]": [],     // findInviteByToken + getApprovalRequest, both unguarded
  "portal/[token]/thanks": [],

  // Presentational or navigational shells that fetch nothing themselves:
  "admin": [],
  "admin/import": [],
  "admin/wipe": [],
  // NOT the seven-capability fan-out. Measured per page: the opportunity/operator briefs reach
  // production state and the time log, and nothing else. An earlier reading assigned it all seven
  // from a DEDUPLICATED diff list rather than from its own row — inference, not measurement.
  "signals": ["production:read", "prospects:read", "time:*"],
  "dashboard": [],

  // `search` is a RETIRED PERMANENT REDIRECT to /console (app/search/page.tsx). It owns no
  // composition and reaches no boundary, so `[]` here is permanent rather than provisional — the
  // one page in this map whose empty declaration no future change should move.
  "search": [],
};
