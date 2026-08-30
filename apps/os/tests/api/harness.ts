// tests/api/harness — the fixtures the 2F security suite shares.
//
// ─── WHAT IS REAL HERE, AND WHAT IS NOT ────────────────────────────────────────────────────────
//
// REAL: the route handlers (imported and invoked as Next invokes them), the guard, the trust
// boundary, session signing and verification, the capability table, the knowledge index, and the
// vault on disk.
//
// STUBBED: the database behind `resolvePrincipal` — one SELECT against `users`/`memberships`. It is
// stubbed so a membership can be REVOKED between two requests and a user DISABLED mid-session,
// which is what threat-model items 9–11 require and what a fixed fixture cannot express. The
// database's own half of the boundary — RLS, column grants, cross-organization isolation — is
// proven against real Postgres in tests/db/production-authorization.test.ts and
// tests/db/request-isolation.test.ts. Neither suite stands in for the other.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export {
  installStubDb, removeStubDb, requestAs, resetMemberships, setMembership, tokenFor,
  TEST_ORG_A as ORG_A, TEST_ORG_B as ORG_B, TEST_OWNER_ID as OWNER_ID,
  TEST_SALES_ID as SALES_ID, TEST_SECRET as SECRET,
} from "@/tests/support/operator-session";

/** A term that appears in a CLIENT and in a PROSPECT — the whole point of the search fixture. */
export const SHARED_TERM = "Northwind";
export const CLIENT_NAME = "Northwind Trading Co";
export const PROSPECT_NAME = "Northwind Roofing";
/** Appears ONLY in owner-only material, so its absence is a second, independent signal. */
export const SOP_TERM = "Fenwick";

export type RouteModule = Record<string, unknown>;

/** The HTTP methods a route file actually exports. Read from the module, never from a list. */
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export function methodsOf(mod: RouteModule): Method[] {
  return METHODS.filter((m) => typeof mod[m] === "function");
}

/**
 * Invoke a route handler the way Next does: `(request, { params })`.
 *
 * `params` is deliberately over-supplied — every dynamic segment this app uses — so one call site
 * serves `[id]` and `[slug]` alike. A handler reads only the key it declares.
 */
export async function invoke(
  mod: RouteModule, method: Method, req: Request
): Promise<Response> {
  const handler = mod[method] as (r: Request, ctx: unknown) => Promise<Response>;
  return handler(req, { params: Promise.resolve({ id: "does-not-exist", slug: "does-not-exist" }) });
}

// ─── The vault fixture ─────────────────────────────────────────────────────────────────────────

const file = (fm: Record<string, string>, body: string) =>
  `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}\n`;

/**
 * A POPULATED vault — clients, prospects, SOPs, invoices, time, documents.
 *
 * F49's second half depends on this being real. A denial test against an EMPTY vault proves nothing:
 * the route would return nothing anyway. Every vault-backed denial is therefore run twice, and this
 * is the second run.
 */
export async function seedVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-authz-"));
  const crm = path.join(dir, "01 - CRM & Clients", "northwind-trading");
  const hits = path.join(dir, "02 - Sales & Hit List");
  const sops = path.join(dir, "03 - SOP Library");
  const docs = path.join(dir, "04 - Documents", "northwind-trading");
  const app = path.join(dir, ".ascend-os");
  for (const d of [crm, hits, sops, docs, app]) await fs.mkdir(d, { recursive: true });

  await fs.writeFile(path.join(crm, "business_context.md"),
    file({ name: CLIENT_NAME, status: "active" },
      `${CLIENT_NAME} is a retained client. Monthly retainer, renewal in March.`));

  await fs.writeFile(path.join(hits, "northwind-roofing.md"),
    file({ name: PROSPECT_NAME, business_type: "Roofing", status: "lead", location: "Modesto, CA" },
      `## Call Log\n\nSpoke with the owner about a rebuild. ${SHARED_TERM} referral.`));
  await fs.writeFile(path.join(hits, "coastal-dental.md"),
    file({ name: "Coastal Dental", business_type: "Dental", status: "contacted" }, "Follow up Tuesday."));

  await fs.writeFile(path.join(sops, "client-onboarding.md"),
    file({ title: "Client Onboarding" }, `Escalate to ${SOP_TERM} for contract review.`));

  await fs.writeFile(path.join(docs, "proposal-v1.md"),
    file({ type: "proposal", client: "northwind-trading", title: `${CLIENT_NAME} proposal`, status: "draft" },
      "Scope and pricing."));

  const now = new Date().toISOString();
  await fs.writeFile(path.join(app, "invoices.jsonl"),
    JSON.stringify({ id: "inv-1", client: "northwind-trading", amount_usd: 4200, issued_at: now, paid: false }) + "\n");
  await fs.writeFile(path.join(app, "time_log.jsonl"),
    JSON.stringify({ id: "t-1", client: "northwind-trading", started_at: now, ended_at: now, minutes: 45 }) + "\n");
  await fs.writeFile(path.join(app, "portal_invites.jsonl"),
    JSON.stringify({ token: "portal-token-1", client: "northwind-trading", created_at: now }) + "\n");

  return dir;
}
