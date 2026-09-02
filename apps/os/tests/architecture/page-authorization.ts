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
// ─── A NOTE THAT WENT STALE, AND THE RULE IT WAS RIGHT ABOUT ───────────────────────────────────
//
// This block used to say `console` and `search` both declare `[]` because the knowledge index
// demanded no authority. That stopped being true when 2G.1 slice 4 scoped the index: `console` now
// declares `["prospects:read", "search"]` — see its own entry below, which records the measurement —
// and `search` is a retired redirect whose `[]` has an entirely different cause. Corrected 2G.4.4,
// noticed while moving the admin entries; it is the same rotting-prose defect §29.6c names three
// instances of, and the correction is recorded rather than quietly overwritten.
//
// What the block was RIGHT about is the rule, which stands: when a page's runtime demand changes,
// **F51 must fail until the declaration is updated**. That failure is the point. It is cheaper to
// let the gate catch a transition than to write the map in anticipation of an implementation that
// has not happened — a declaration written ahead of the code describes a system nobody has built.

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
  // 2G.3 §28.5. The partner's landing surface: the pipeline through the guarded reader, plus the
  // knowledge index, which authorizes the ACT of assembling through `search`. Capability-gated, so
  // an owner holding the superset renders it too — that is correct, not a leak.
  "partner": ["prospects:read", "search"],
  // 2G.3 §28.4. The FIRST `admin/*` page to reach a guarded reader — it denied a sales principal for
  // the ordinary reason while its three siblings still rendered. 2G.4.4 brought the other three here.
  "admin/invitations": ["admin:*"],
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
  // 2G.2. It looks NOTHING up: validating the token server-side would make a rendered form mean
  // "valid" and an error mean "not", which is the enumeration oracle §27 forbids. Every token
  // renders the same form and only the POST decides, so this page reaches no boundary at all.
  "invite/[token]": [],
  "portal/[token]": [],                     // token-scoped invite record only (slice 2d)
  "portal/[token]/approve/[reqId]": [],     // findInviteByToken + getApprovalRequest, both unguarded
  "portal/[token]/thanks": [],

  // ─── 2G.4.4 · THE THREE PAGES THAT MOVED OFF `[]` ────────────────────────────────────────────
  //
  // They were "presentational shells that fetch nothing" and that was true and was the defect:
  // parked finding 1, and by §29.2(c) a live disclosure — `admin/wipe`'s copy named two clients and
  // a $4,541 revenue figure to a principal denied that material everywhere else. §29.6c measured
  // the second half: a page demanding nothing also renders in full for a REVOKED principal, because
  // revocation is enforced where authority is REQUESTED. All three now reach `core/admin/tools`,
  // whose readers require `admin:*`, so both halves close through the ordinary mechanism.
  //
  // `NAV_DESTINATIONS` moved with this entry, not after it — F56 holds the two equal.
  "admin": ["admin:*"],
  "admin/import": ["admin:*"],
  "admin/wipe": ["admin:*"],
  // NOT the seven-capability fan-out. Measured per page: the opportunity/operator briefs reach
  // production state and the time log, and nothing else. An earlier reading assigned it all seven
  // from a DEDUPLICATED diff list rather than from its own row — inference, not measurement.
  "signals": ["production:read", "prospects:read", "time:*"],

  // ─── THE TWO PERMANENT REDIRECTS. `[]` HERE IS PERMANENT, NOT PROVISIONAL. ───────────────────
  //
  // `search` is a retired permanent redirect to /console; `dashboard` is `redirect("/")` and nothing
  // else. Neither owns any composition, so neither can reach a boundary — and their `[]` is not the
  // admin shape above, which was a page that COULD have demanded something and did not.
  //
  // 2G.4.4 reclassified `dashboard` here by DEMONSTRATION rather than assertion (§29.3 Ruling 2):
  // `page-matrix-provisioned`'s Fact C renders it, parses the redirect target out of Next's own
  // digest, finds that target IS a row in the same matrix, and asserts that row denies sales. A
  // redirect inherits its destination's boundary, and the destination is measured, not assumed.
  "dashboard": [],
  "search": [],
};
