// tests/support/route-surface — THE ROUTE IMPORTER MAP, held apart from any authority mechanism
// (STAGE2G §29.6, slice 2G.4.2).
//
// ─── WHY THIS MODULE EXISTS, AND WHY IT IS SO NARROW ───────────────────────────────────────────
//
// `tests/api/route-matrix.test.ts` (2F step 7.4) and `tests/db/route-matrix-provisioned.test.ts`
// (2G.4.2) both need to invoke the same 29 route handlers the same way — a real `Request`, a real
// exported handler, no shortcut. Everything BOTH suites need to build that request lives here:
// which file backs which route, which HTTP methods a module exports, how to shape the URL and the
// cookie. Neither suite's chosen AUTHORITY mechanism (a stubbed membership lookup for one, a real
// provisioned database for the other) belongs here at all.
//
// **BINDING (STAGE2G §29.6): this module imports NOTHING from `tests/support/operator-session` and
// NOTHING from `tests/support/provisioned-partner`.** A suite whose whole thesis is "no stubbed
// membership" must not carry the stub registrar in its module graph, where a stray `installStubDb()`
// would silently redirect the app-db slot and turn the provisioned suite into a re-run of the 2F
// suite under a new name. The one-importer-map fitness rule (`tests/architecture/fitness.test.ts`)
// checks that no OTHER file under `tests/` holds its own copy of the importer list; it does not, and
// cannot, check what this file itself imports — so that half of the guarantee is enforced here, by
// construction, not by a scan.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SESSION_COOKIE } from "@/lib/auth";
import { ROUTE_AUTHORIZATION, type RouteAuthorization } from "@/core/auth/routes";

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

export function urlFor(route: string): string {
  return "https://os.test/" + route.replace(/^app\//, "").replace(/\/route\.ts$/, "") + "?q=x";
}

/**
 * A request carrying a session cookie, exactly as a browser sends one.
 *
 * A second definition of the same five lines `tests/support/operator-session.ts` already has —
 * deliberately, not an oversight. That module's whole purpose there is binding a STUBBED authority;
 * importing it from here to save five lines would violate the BINDING above for a cosmetic reason.
 */
export function requestAs(token: string | undefined, url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; other=x`);
  return new Request(url, { ...init, headers });
}

// ─── The vault fixture ─────────────────────────────────────────────────────────────────────────

/** A term that appears in a CLIENT and in a PROSPECT — the whole point of the search fixture. */
export const SHARED_TERM = "Northwind";
export const CLIENT_NAME = "Northwind Trading Co";
export const PROSPECT_NAME = "Northwind Roofing";
/** Appears ONLY in owner-only material, so its absence is a second, independent signal. */
export const SOP_TERM = "Fenwick";

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

// ─── The importer map ──────────────────────────────────────────────────────────────────────────

/**
 * One importer per route file.
 *
 * Written out rather than computed: a bundler cannot analyse `import(variable)`, and the honest
 * alternative — skipping routes that fail to resolve — would let a route quietly leave the matrix.
 * The totality test in each consuming suite makes the list impossible to leave stale, and the
 * one-importer-map fitness rule (F52-shaped, `tests/architecture/fitness.test.ts`) makes THIS the
 * only file under `tests/` allowed to hold one.
 */
export const ROUTE_IMPORTERS: Record<string, () => Promise<RouteModule>> = {
  "app/api/admin/wipe/route.ts":
    () => import("@/app/api/admin/wipe/route"),
  "app/api/audits/route.ts":
    () => import("@/app/api/audits/route"),
  "app/api/audits/run/route.ts":
    () => import("@/app/api/audits/run/route"),
  "app/api/auth/login/route.ts":
    () => import("@/app/api/auth/login/route"),
  "app/api/invitations/accept/route.ts":
    () => import("@/app/api/invitations/accept/route"),
  "app/api/invitations/route.ts":
    () => import("@/app/api/invitations/route"),
  "app/api/auth/logout/route.ts":
    () => import("@/app/api/auth/logout/route"),
  "app/api/automations/dismiss/route.ts":
    () => import("@/app/api/automations/dismiss/route"),
  "app/api/console/search/route.ts":
    () => import("@/app/api/console/search/route"),
  "app/api/documents/[id]/route.ts":
    () => import("@/app/api/documents/[id]/route"),
  "app/api/documents/[id]/version/route.ts":
    () => import("@/app/api/documents/[id]/version/route"),
  "app/api/documents/route.ts":
    () => import("@/app/api/documents/route"),
  "app/api/finance/invoices/[id]/route.ts":
    () => import("@/app/api/finance/invoices/[id]/route"),
  "app/api/finance/invoices/route.ts":
    () => import("@/app/api/finance/invoices/route"),
  "app/api/import/prospects/route.ts":
    () => import("@/app/api/import/prospects/route"),
  "app/api/portal/approval-requests/route.ts":
    () => import("@/app/api/portal/approval-requests/route"),
  "app/api/portal/approvals/route.ts":
    () => import("@/app/api/portal/approvals/route"),
  "app/api/portal/invites/route.ts":
    () => import("@/app/api/portal/invites/route"),
  "app/api/portal/me/route.ts":
    () => import("@/app/api/portal/me/route"),
  "app/api/portal/submissions/route.ts":
    () => import("@/app/api/portal/submissions/route"),
  "app/api/production/toggle/route.ts":
    () => import("@/app/api/production/toggle/route"),
  "app/api/prospects/[slug]/promote/route.ts":
    () => import("@/app/api/prospects/[slug]/promote/route"),
  "app/api/prospects/[slug]/route.ts":
    () => import("@/app/api/prospects/[slug]/route"),
  "app/api/prospects/from-url/route.ts":
    () => import("@/app/api/prospects/from-url/route"),
  "app/api/time/active/route.ts":
    () => import("@/app/api/time/active/route"),
  "app/api/time/log/route.ts":
    () => import("@/app/api/time/log/route"),
  "app/api/time/start/route.ts":
    () => import("@/app/api/time/start/route"),
  "app/api/time/stop/route.ts":
    () => import("@/app/api/time/stop/route"),
  "app/api/time/summary/route.ts":
    () => import("@/app/api/time/summary/route"),
};

// ─── The matrix — importer paired with the DECLARED verdict, so neither suite retypes either ─────

export type RouteMatrixEntry = { importer: () => Promise<RouteModule>; auth: RouteAuthorization };

export const ROUTE_MATRIX: Record<string, RouteMatrixEntry> = Object.fromEntries(
  Object.entries(ROUTE_IMPORTERS).map(([route, importer]) => {
    const auth = ROUTE_AUTHORIZATION[route];
    // Each consuming suite runs its own totality check against `ROUTE_AUTHORIZATION`; this throw is
    // a second, load-bearing floor under that check — a pairing built here is never allowed to be
    // silently incomplete, whatever a consuming suite does or does not assert.
    if (!auth) throw new Error(`route-surface: ${route} has an importer but no ROUTE_AUTHORIZATION entry`);
    return [route, { importer, auth }];
  })
);

type CapabilityMatrixEntry = RouteMatrixEntry & { auth: Extract<RouteAuthorization, { kind: "capability" }> };
type PublicMatrixEntry = RouteMatrixEntry & { auth: Extract<RouteAuthorization, { kind: "public" }> };

export const capabilityRoutes: Array<[string, CapabilityMatrixEntry]> = Object.entries(ROUTE_MATRIX)
  .filter((e): e is [string, CapabilityMatrixEntry] => e[1].auth.kind === "capability");

export const publicRoutes: Array<[string, PublicMatrixEntry]> = Object.entries(ROUTE_MATRIX)
  .filter((e): e is [string, PublicMatrixEntry] => e[1].auth.kind === "public");
