// tests/architecture/gate-2g4 — THE 2G.4 ACCOUNTING (STAGE2G §29.6, slice 2G.4.6).
//
// ─── IT DOES NO FIXING, AND THAT IS A BINDING, NOT A PREFERENCE ────────────────────────────────
//
// §29.6: *"2G.4.6 DOES NO FIXING. §26.1 already drew the line this slice must not cross — the gate
// adds no behaviour, fixes no parked finding, touches no page. §26.4 names tidying-while-assembling
// as the exact temptation this slice exists to resist."*
//
// So this file states what the five slices before it did, in a form a test can check, and changes
// nothing. Every claim below points at a suite that ran.
//
// ─── WHY A SECOND FILE RATHER THAN MORE OF `gate-2g1` ──────────────────────────────────────────
//
// `PARKED_FINDINGS` in `gate-2g1.ts` is 2G.1's FROZEN snapshot of what that stage closed with, and
// §29.8 binds 2G.4 not to edit it: *"editing it to say a finding is proven, or that it covers a
// different scope than it did in 2G.1, rewrites history to match a later measurement."* The parked
// record is history. A disposition is new evidence with its own witness, and it belongs beside the
// history rather than inside it.
//
// The link between the two is VERBATIM STRING EQUALITY, deliberately: a disposition names the
// finding word for word, so a finding cannot be quietly reworded into one that is easier to close.

import { PARKED_FINDINGS } from "./gate-2g1";

/** How a 2G.1 parked finding stands after 2G.4. One per snapshot entry, no more and no fewer. */
export type Disposition = {
  /** VERBATIM from `PARKED_FINDINGS`. Checked by string equality, never by paraphrase. */
  readonly finding: string;
  readonly state: "DISCHARGED" | "DEFERRED" | "RETIRED" | "STILL PARKED";
  /** The slice or section that did it. */
  readonly by: string;
  /** Where to look. A disposition with no witness is an assertion about the past. */
  readonly evidence: string;
};

const F = PARKED_FINDINGS.map((p) => p.finding);

export const DISPOSITIONS: readonly Disposition[] = [
  {
    finding: F[0],
    state: "DISCHARGED",
    by: "2G.4.4 (§29.3 Ruling 2, §29.6f)",
    evidence:
      "SPLIT, per §29.2(c): the render/route-guard half of the 2G.1 wording ('no data leaks — those " +
      "routes are guarded') was always true; the half that was not is that admin/wipe disclosed two " +
      "client names and a $4,541 revenue figure in MARKUP. All three pages now demand admin:* through " +
      "core/admin/tools. Measured by page-matrix-provisioned's Fact A, INVERTED rather than rewritten — " +
      "the same derivation and the same five strings that recorded the defect at 87bf7b7. dashboard was " +
      "reclassified beside search as a permanent redirect, demonstrated by Fact C, not asserted.",
  },
  {
    finding: F[1],
    state: "DISCHARGED",
    by: "2G.4.5 (§29.3 Ruling 3, §29.6g)",
    evidence:
      "AccountRefused extends NoAuthority; lib/authority classifies every PageDenial in an exhaustive " +
      "switch with no default; renderOrDenied converts the ANSWERED half to components/auth/AccountInactive " +
      "and still rethrows the outage and the unbound resolver. page-matrix-provisioned arms A/B/C answer " +
      "'inactive' and ARM D proves an outage on the SAME page still answers unauthorized/unavailable. " +
      "Four pages that nobody had wrapped (automations, console, sales, sales/[prospect]) were wrapped — " +
      "unwrapped they kept sending a revoked partner to app/error.tsx, which is this finding surviving " +
      "inside its own fix.",
  },
  {
    finding: F[2],
    state: "DEFERRED",
    by: "2G.4.6 (§29.3 Ruling 4)",
    evidence:
      "Deferred with a STATED retirement condition and an ENFORCED boundary, which is why it is not " +
      "'still parked': the asymmetry retires when clients/SOPs move to Postgres OR when a second caller " +
      "of assemble() appears, and F52's 2G.4.6 extension fails the gate on the second disjunct. §23.4 " +
      "already ruled it an asymmetry rather than an escape path; routing the discovery through the " +
      "guarded readers is a DAL coupling change, not a security fix.",
  },
  {
    finding: F[3],
    state: "RETIRED",
    by: "2G.2 (§27.12)",
    evidence: "Reclassified PROVEN at 2G.2 closure — F53, 18/18 local, both rollback directions. Predates 2G.4.",
  },
  {
    finding: F[4],
    state: "RETIRED",
    by: "2G.3 (§28.14)",
    evidence:
      "Delivered and closed at §28.14, which is the CLOSURE RECORD rather than a claim: /partner and " +
      "/admin/invitations exist, declare their capabilities in PAGE_AUTHORIZATION, and are measured by " +
      "F51, F56, F57 and page-denial like every other surface. Predates 2G.4 and is not re-proven by it.",
  },
  {
    finding: F[5],
    state: "STILL PARKED",
    by: "after 2G.4 (§29.9 item 7)",
    evidence:
      "Out of scope by contract, not by omission. §7.3 and §12 need sign-off before intake is designed, " +
      "and 2G.4 closes without touching it.",
  },
];

// ─── §8'S ELEVEN ROWS ──────────────────────────────────────────────────────────────────────────
//
// §29.4's table, in a form a test can check. Rows 5 and 11 have two halves whose fates DIFFER, and
// §29.3 Ruling 5 is explicit that flattening them would be dishonest: a row is not proven because
// one of its halves is.

export type RowEvidence = "PROVEN" | "PARKED — WITHHELD" | "PROVEN, BOUNDED";

export type MatrixRow = {
  readonly row: number;
  /** Present only where the row genuinely has two halves with different fates. */
  readonly half?: "local" | "production";
  readonly what: string;
  readonly evidence: RowEvidence;
  readonly discharged: string;
};

export const MATRIX_ROWS: readonly MatrixRow[] = [
  { row: 1, what: "a real provisioned principal reaches every route as itself", evidence: "PROVEN",
    discharged: "2G.4.2 — tests/db/route-matrix-provisioned.test.ts" },
  { row: 2, what: "a real provisioned principal reaches every page as itself", evidence: "PROVEN",
    discharged: "2G.4.3 — tests/db/page-matrix-provisioned.test.ts" },
  { row: 3, what: "the knowledge index does not contain what the principal may not know", evidence: "PROVEN",
    discharged: "§23.6 (2G.1 slice 4) — tests/auth/index-scoping.test.ts. PREDATES 2G.4 and is not re-proven by it" },
  { row: 4, what: "search returns a scoped result rather than a route-level refusal", evidence: "PROVEN",
    discharged: "§23.2 — tests/api/search-boundary.test.ts. PREDATES 2G.4 and is not re-proven by it" },

  { row: 5, half: "local", what: "cross-organization isolation — RLS returns zero rows", evidence: "PROVEN",
    discharged: "2G.4.1 — PGlite 001–007, two orgs, SET LOCAL ROLE ascend_sales" },
  { row: 5, half: "production", what: "cross-organization isolation on managed Postgres", evidence: "PROVEN",
    discharged: "tests/db/production-authorization.test.ts:156,168,180 — EXISTING, corrected by §29.2(a)" },

  { row: 6, what: "a revocation takes effect on the next request, not at token expiry", evidence: "PROVEN",
    discharged: "2G.4.2 route-side (real users.disabled_at write) and 2G.4.3 page-side; 2G.4.5 replaced the " +
                "generic error boundary with the named AccountInactive surface (§29.6g)" },
  { row: 7, what: "disabled_at denies a valid, unexpired session", evidence: "PROVEN",
    discharged: "2G.4.1 (real disabled_at, real session) and 2G.4.3 page-side; §29.6c's `[]`-declared " +
                "exception RETIRED by 2G.4.4 and measured by ARM C" },
  { row: 8, what: "invitation tokens are hashed and single-use", evidence: "PROVEN",
    discharged: "§27.6/§27.12 — F53, 18/18 local. PREDATES 2G.4 and is not re-proven by it" },
  { row: 9, what: "password minimum length, hash stored, plaintext never logged", evidence: "PROVEN",
    discharged: "§27 (predates 2G.4) for the first two; the plaintext half closed in 2G.4.1 WITH A POSITIVE CONTROL" },
  { row: 10, what: "concurrent renders do not share a principal", evidence: "PROVEN, BOUNDED",
    discharged: "tests/render/page-isolation.test.ts — proven against PROBE pages with a two-role STUB " +
                "resolver. The bound is named in §29.7 and is NOT closed by 2G.4" },

  { row: 11, half: "local", what: "ascend_sales cannot read credential material", evidence: "PROVEN",
    discharged: "2G.4.1 — refused reading password_hash under SET LOCAL ROLE ascend_sales" },
  { row: 11, half: "production", what: "ascend_sales cannot read credential material on the live server",
    evidence: "PARKED — WITHHELD",
    discharged: "2G.4.6 built the re-runnable instrument (tests/db/production-2g4-credential-read.test.ts). " +
                "EXECUTION IS WITHHELD pending §29.11 Q2. Nothing about the network prevents it — this " +
                "probe answers through the POOLER, which row 5's production half already uses in 0.2s. " +
                "What withholds it is a decision, and §26.2 forbids laundering a choice as an obstacle" },
];

// ─── WHAT 2G.4 CARRIES FORWARD ─────────────────────────────────────────────────────────────────
//
// Not parked findings — those are 2G.1's frozen six. These are things 2G.4 itself FOUND or was
// handed, and is closing without resolving. Listed so closure is a statement about a known set
// rather than a silence.

export type CarriedForward = {
  readonly item: string;
  readonly kind: "PRODUCTION DEFECT" | "OPEN DECISION" | "BOUND";
  readonly owner: string;
  /** What would end it. An item with no retirement condition is an item nobody can close. */
  readonly retires: string;
};

export const CARRIED_FORWARD: readonly CarriedForward[] = [
  {
    item: "§29.6b — app/api/console/search catches NoAuthority and returns a 200 with an error field",
    kind: "PRODUCTION DEFECT",
    owner: "a console owner, or a later slice",
    retires: "when the route either converts the swallowed refusal into a refusal, or is documented as " +
             "deliberate degradation. It fails CLOSED — the swallowed refusal yields empty data, never " +
             "another tenant's — so it costs evidence, not isolation",
  },
  {
    item: "§29.6d — lib/page-principal catches requireAppDb()'s throw where lib/route-guard lets it propagate",
    kind: "BOUND",
    owner: "recorded, not owned",
    retires: "RETIRED IN EFFECT by 2G.4.5: a revoked account and an outage are now different VERDICTS " +
             "(inactive vs unauthorized), measured on the same page by ARM B and ARM D. The asymmetry " +
             "itself remains and no longer costs evidence",
  },
  {
    item: "§29.6e — app/page.tsx:39-40 catches without unstable_rethrow over a chain reaching requireCapability",
    kind: "PRODUCTION DEFECT",
    owner: "a / owner",
    retires: "when the catch either rethrows authority failures or is documented as deliberate degradation. " +
             "OBSTACLE FOUND IN 2G.4.5 AND RECORDED: F54 forbids any file on the page surface from " +
             "importing @/core/auth/authority, so the filter needs a helper under lib/. Fails CLOSED",
  },
  {
    item: "§29.10 Q1 — does 2G.4 close with the db-phase environment exported and the phased gate green, " +
          "or on a §28.12-style SINGLE NAMED RED? ANSWERED 2026-09-02: (b), a single named red",
    kind: "OPEN DECISION",
    owner: "human — ANSWERED",
    retires: "RETIRED by the answer, and by the criterion §29.10 now carries. Its final wording was written " +
             "by a reader who did not write the rest of §29, as §29.10 BINDS — 'a contract author is the " +
             "worst reader of their own clause'. Closure is: typecheck 0, no FAILED test in gate:server or " +
             "gate:db, and EXACTLY ONE failed test in gate:static — gate-2g1.test.ts's 'every PROVEN suite's " +
             "environment gate is satisfied in THIS run'. Any second red, including an intermittent one in a " +
             "suite 2G.4 does not touch, means that run is not a closing run",
  },
  {
    item: "§29.11 Q2 — row 11's read-only production probe against the pooler: DECLINED 2026-09-02",
    kind: "OPEN DECISION",
    owner: "human — ANSWERED",
    retires: "RETIRED by the answer itself. §29.11 made declining a valid outcome, on the condition that it " +
             "be RECORDED as declined rather than left silent — which is what this entry is. The instrument " +
             "exists (tests/db/production-2g4-credential-read.test.ts), is gated on its own variable, and " +
             "has never executed. Row 11's production half stays PARKED — WITHHELD, never BLOCKED (§26.2): " +
             "nothing prevented the run, a person decided against it. The local half stays PROVEN — 2G.4.1 " +
             "refuses the same read through the same SET LOCAL ROLE ascend_sales path against PGlite",
  },
  {
    item: "007's consumed-invitation reaping — ON DELETE RESTRICT does not read consumed_at, so a membership " +
          "cannot be removed while the invitation that created it exists",
    kind: "OPEN DECISION",
    owner: "a 007 follow-up, not a 2G.4 slice",
    retires: "when member removal is actually required by a product surface. It needs a ruling on whether a " +
             "consumed invitation is still evidence worth keeping once the membership it created is gone",
  },
];
