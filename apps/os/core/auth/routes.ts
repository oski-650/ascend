// core/auth/routes — THE ROUTE → CAPABILITY MAP. Total, enumerated, no wildcards.
//
// ─── WHY EVERY ROUTE IS SPELLED OUT ────────────────────────────────────────────────────────────
//
// F49 forbids authorization-by-absence, and a grouped row (`/api/time/*`) is exactly the implicit
// default it names: it decides for routes that do not exist yet, and it hides the ones that do. The
// first draft of STAGE2F §8 covered 27 routes in 16 grouped rows, and its own rule caught it.
//
// The keys are REPOSITORY PATHS, not URLs. That makes totality a set comparison against the
// filesystem rather than a judgement about whether two path patterns mean the same thing: a route
// file with no entry here fails the suite, and an entry naming no file fails it too.
//
// ─── PUBLIC IS A DECISION, NOT A GAP ───────────────────────────────────────────────────────────
//
// Five routes carry no capability, and each states WHY in the row. "Public" here never means "we
// did not get to it" — it means the route authenticates by a different credential (a password at
// login, a portal token for a client who has no operator account) and that this was chosen.
//
// ─── THE SALES COLUMN IS DOUBLE-ENTRY BOOKKEEPING ──────────────────────────────────────────────
//
// `sales` below is not consulted at runtime — `can()` is. It is recorded so the two can be checked
// against each other: F49 asserts that every row's stated verdict matches what the capability table
// actually produces. A row that says `deny` while the capability says otherwise is a mapping
// mistake, and without the second entry nothing would notice.
//
// ─── 2G.4.7: EIGHTEEN ROWS MOVED deny → allow, AND TWO DID NOT ─────────────────────────────────
//
// The sales role became a trusted business operator — `owner` minus `admin:*` — so every row whose
// capability is a BUSINESS capability now reads `allow`. The two that still read `deny` are the two
// whose capability is `admin:*`: `app/api/admin/wipe` (destructive administration) and
// `app/api/invitations` (issuing credentials, i.e. security management). **That is the entire
// boundary, and it is one capability wide.**
//
// These verdicts were not edited to match the new table by hand-reading it. F49 recomputes each row
// against `can()`, so this column and `ROLE_CAPABILITIES` cannot disagree without the gate saying
// so — which is the property the double entry exists for, and the reason a widening this broad could
// be made mechanically rather than by inspection.

import "server-only";
import type { Capability } from "./capabilities";

/** What `sales` gets. `scoped` means a 200 whose CONTENTS are filtered — see §9 and core/knowledge. */
export type SalesVerdict = "allow" | "deny" | "scoped" | "n/a";

export type RouteAuthorization =
  | { kind: "capability"; capability: Capability; sales: SalesVerdict; backing: "postgres" | "vault" | "both" }
  | { kind: "public"; why: string };

/**
 * Every `app/api/**\/route.ts` in the repository. Transcribed from STAGE2F §8.
 *
 * `backing` records where the data lives, and it is load-bearing rather than documentation: F49
 * requires every `vault`-backed denial to be tested TWICE — once with the vault absent, once with it
 * present — because a route that returns nothing today because the server has no vault is not
 * authorized, it is merely empty.
 */
export const ROUTE_AUTHORIZATION: Record<string, RouteAuthorization> = {
  "app/api/admin/wipe/route.ts":
    { kind: "capability", capability: "admin:*", sales: "deny", backing: "vault" },
  "app/api/audits/route.ts":
    { kind: "capability", capability: "audits:*", sales: "allow", backing: "vault" },
  "app/api/audits/run/route.ts":
    { kind: "capability", capability: "audits:*", sales: "allow", backing: "vault" },
  "app/api/auth/login/route.ts":
    { kind: "public", why: "the credential IS the authentication; there is no session yet to authorize" },
  // 2G.3 §28.4. ISSUING is an authorized act and ACCEPTING is not, which is why these two rows sit
  // next to each other saying opposite things. The asymmetry is the design: the accept route has no
  // principal to authorize and answers every failure identically, while this one is reached by an
  // authenticated owner acting inside their own organization, where no enumeration oracle exists.
  "app/api/invitations/route.ts":
    { kind: "capability", capability: "admin:*", sales: "deny", backing: "postgres" },
  "app/api/invitations/accept/route.ts":
    { kind: "public", why: "the TOKEN is the authorization; there is no session yet, and establishing " +
      "the credential a session would be minted from is the whole purpose. The authority is the " +
      "database role ascend_invite, assumed inside the acceptance transaction — not a principal" },
  "app/api/auth/logout/route.ts":
    { kind: "public", why: "clears a cookie; refusing to let an unauthenticated caller log out protects nothing" },
  "app/api/automations/dismiss/route.ts":
    { kind: "capability", capability: "pipeline:write", sales: "allow", backing: "vault" },
  "app/api/console/search/route.ts":
    { kind: "capability", capability: "search", sales: "scoped", backing: "both" },
  "app/api/documents/[id]/route.ts":
    { kind: "capability", capability: "documents:*", sales: "allow", backing: "vault" },
  "app/api/documents/[id]/version/route.ts":
    { kind: "capability", capability: "documents:*", sales: "allow", backing: "vault" },
  "app/api/documents/route.ts":
    { kind: "capability", capability: "documents:*", sales: "allow", backing: "vault" },
  "app/api/finance/invoices/[id]/route.ts":
    { kind: "capability", capability: "finance:*", sales: "allow", backing: "vault" },
  "app/api/finance/invoices/route.ts":
    { kind: "capability", capability: "finance:*", sales: "allow", backing: "vault" },
  "app/api/import/prospects/route.ts":
    { kind: "capability", capability: "import:run", sales: "allow", backing: "both" },
  "app/api/portal/approval-requests/route.ts":
    { kind: "capability", capability: "portal:admin", sales: "allow", backing: "vault" },
  "app/api/portal/approvals/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/portal/invites/route.ts":
    { kind: "capability", capability: "portal:admin", sales: "allow", backing: "vault" },
  "app/api/portal/me/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/portal/submissions/route.ts":
    { kind: "public", why: "authenticated by the client's portal invite token; clients hold no operator account" },
  "app/api/production/toggle/route.ts":
    { kind: "capability", capability: "production:toggle", sales: "allow", backing: "vault" },
  // §8 defines `prospects:write` as "notes, contacts, status, follow-ups". This is that list's FIRST
  // entry finally acquiring a writer — the note log 008 introduced — so the row needs no tightening
  // note of the kind its DELETE sibling below carries. It is the capability doing exactly its job.
  //
  // POST is the only verb. Reading the log is `prospects:read` and therefore a different capability,
  // which F46 will not let share a file; the page reads it server-side instead. See the route.
  // ─── 2A.1c · SALES ACTIONS ─────────────────────────────────────────────────────────────────
  //
  // §8's `prospects:write` list — "notes, contacts, status, follow-ups" — acquiring its remaining
  // writers. The Save and the self-claim are the partner's daily work, so `prospects:write` (sales
  // allowed). Reassignment and the follow-up edit are the OWNER's (2A preflight §20, 2A.1b decision 1):
  // they map to `prospects:manage` — owner-level CRM lifecycle authority, NOT `admin:*`, which stays
  // for administration (owner decision at 2A.1c acceptance) — so the route refuses sales before the
  // domain command and the guarded database function refuse it again.
  "app/api/prospects/[slug]/actions/route.ts":
    { kind: "capability", capability: "prospects:write", sales: "allow", backing: "postgres" },
  "app/api/prospects/[slug]/claim/route.ts":
    { kind: "capability", capability: "prospects:write", sales: "allow", backing: "postgres" },
  "app/api/prospects/[slug]/assignment/route.ts":
    { kind: "capability", capability: "prospects:manage", sales: "deny", backing: "postgres" },
  "app/api/prospects/[slug]/followups/[followupId]/route.ts":
    { kind: "capability", capability: "prospects:manage", sales: "deny", backing: "postgres" },
  "app/api/prospects/[slug]/notes/route.ts":
    { kind: "capability", capability: "prospects:write", sales: "allow", backing: "postgres" },
  // OUTBOUND REQUESTS, hence its own capability rather than `prospects:write` — the same split
  // `import:run` carries. The route authorizes a HUMAN holding `research:run`; the write beneath it
  // happens as `ascend_automation`, which the schema forbids from writing any judgment column.
  "app/api/prospects/[slug]/research/route.ts":
    { kind: "capability", capability: "research:run", sales: "allow", backing: "postgres" },
  "app/api/prospects/[slug]/promote/route.ts":
    { kind: "capability", capability: "promote", sales: "allow", backing: "both" },
  // ─── A DELIBERATE TIGHTENING OF §8, FLAGGED RATHER THAN SILENT ───────────────────────────────
  //
  // §8 records this path as `prospects:read / prospects:write` with sales ✅, anticipating a route
  // that reads and edits a prospect. The file implements ONE method: DELETE, which removes the
  // prospect record entirely.
  //
  // §8 defines `prospects:write` as "notes, contacts, status, follow-ups". Deleting the record is
  // none of those — it destroys the identity anchor, and it does so by unlinking a FILE, which
  // means the column grants that stop `ascend_sales` writing `prospect_id` or `identity_state` are
  // not in the path at all. Granting sales this route would let the weaker capability accomplish
  // what the stronger one is specifically denied.
  //
  // So it is mapped to `prospects:identity`. That mapping is a TIGHTENING of §8 and it STANDS —
  // deletion is still a different capability from editing, and a future narrower role would be
  // denied it by this row without anyone revisiting the question.
  //
  // **THE ONE LINE CHANGED, 2G.4.7.** This note used to end "if the intent was that a partner may
  // delete a prospect, one line changes." It was, and it did: `sales` now holds
  // `prospects:identity`. The capability boundary is unchanged and the ROLE moved across it, which
  // is exactly the shape this row was written to make possible — the mapping did its job by making
  // the grant a decision instead of a side effect of `prospects:write`.
  //
  // WORTH KNOWING BEFORE USING IT: deletion is a vault-file `unlink` (`route.ts:23`) and there is no
  // `DELETE FROM prospects` anywhere, so with `ASCEND_PROSPECT_SOURCE=postgres` this removes the
  // file while the row survives. That asymmetry predates this grant and is not created by it — it is
  // named here because more people can now reach it.
  "app/api/prospects/[slug]/route.ts":
    { kind: "capability", capability: "prospects:identity", sales: "allow", backing: "both" },
  "app/api/prospects/from-url/route.ts":
    { kind: "capability", capability: "prospects:write", sales: "allow", backing: "both" },
  "app/api/time/active/route.ts":
    { kind: "capability", capability: "time:*", sales: "allow", backing: "vault" },
  "app/api/time/log/route.ts":
    { kind: "capability", capability: "time:*", sales: "allow", backing: "vault" },
  "app/api/time/start/route.ts":
    { kind: "capability", capability: "time:*", sales: "allow", backing: "vault" },
  "app/api/time/stop/route.ts":
    { kind: "capability", capability: "time:*", sales: "allow", backing: "vault" },
  "app/api/time/summary/route.ts":
    { kind: "capability", capability: "time:*", sales: "allow", backing: "vault" },
};
