// Layer A — PAGE DENIAL HANDLING (2G.1 slice 3, STAGE2G §22).
//
// ─── THE PROPERTY ──────────────────────────────────────────────────────────────────────────────
//
//   > A page can respond to an authorization refusal, but it cannot manufacture, suppress, or
//   > reinterpret authorization.
//
// Thirteen of twenty-six pages deny a `sales` principal outright. Until this slice the refusal was
// real and the surface lied about it: `CapabilityDenied` propagated to `app/error.tsx`, which told
// the operator that the VAULT had failed — a cause it cannot know and, in this case, does not have.
//
// ─── WHY THE CLASSIFICATION HAS TO HAPPEN ON THE SERVER ────────────────────────────────────────
//
// Not a preference. `next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:111`:
//
//   > "Errors forwarded from Server Components show a generic message with an identifier. This is
//   >  to prevent leaking sensitive details."
//
// So `app/error.tsx` receives a redacted message and a digest, and CANNOT tell a denial from an
// outage in production. `catchError` is also a client boundary and inherits the limitation.
// `forbidden()` still requires `experimental.authInterrupts`, measured in §9 spike 3 as a 500.
//
// ─── THE DANGEROUS IMPLEMENTATION THIS FILE EXISTS TO REJECT ───────────────────────────────────
//
//       anything thrown  →  "Access denied"
//
// That conceals database outages, malformed records and configuration failures behind an
// authorization message, and it is a lie in the opposite direction from the one being fixed. Half
// the tests below are controls against exactly that, and the classification is asserted to be by
// TYPE — never by matching an error message, which any unrelated failure could imitate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { notFound, redirect } from "next/navigation";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { CapabilityDenied, NoAuthority } from "@/core/auth/authority";
import { Denied } from "@/components/auth/Denied";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import {
  bindTestAuthority, installStubDb, removeStubDb, resetMemberships, unbindTestAuthority,
} from "@/tests/support/operator-session";
import { PAGE_AUTHORIZATION } from "@/tests/architecture/page-authorization";

const ok = () => createElement("p", null, "the real view");

/**
 * Anything shaped like a capability. Matching the SHAPE rather than a list means a capability added
 * later is caught without this file being updated to know about it.
 */
const CAPABILITY_TOKEN = /\b\w+:(\*|read|write|toggle|admin|run|identity)\b/;

/** Was this element produced by the denial path? A structural check, not a string search. */
const isDenied = (el: unknown): boolean =>
  typeof el === "object" && el !== null && (el as ReactElement).type === Denied;

describe("§22.3 · the helper CLASSIFIES a refusal — it never decides one", () => {
  it("passes a successful render through untouched", async () => {
    const el = await renderOrDenied("Finance", async () => ok());
    expect(isDenied(el)).toBe(false);
    expect(renderToStaticMarkup(el as ReactElement)).toContain("the real view");
  });

  it("CapabilityDenied → the Denied surface", async () => {
    const el = await renderOrDenied("Finance", async () => {
      throw new CapabilityDenied("finance:*", "sales");
    });
    expect(isDenied(el)).toBe(true);
    const html = renderToStaticMarkup(el as ReactElement);
    // It NAMES NOTHING THAT DESCRIBES THE DECISION. A denial that explains itself is a map of the
    // system for whoever is probing it — the same rule the 403 JSON body follows in lib/route-guard.
    //
    // Asserted against capability TOKENS and role ATTRIBUTION rather than the bare words. The copy
    // legitimately says "ask the account owner" and legitimately links to /sales, and a blunt
    // /owner|sales/ match would fail on that — which would pressure the next person to reword
    // honest copy instead of removing a real disclosure.
    expect(html, "a capability token reached the page").not.toMatch(CAPABILITY_TOKEN);
    expect(html, "the caller's role was attributed on the page").not.toMatch(/\brole\s+\w+/i);
    expect(html).toContain("don");   // "You don't have access to this"
  });

  it("CLASSIFIES BY TYPE, never by message — a lookalike error is NOT a denial", async () => {
    // The failure this forbids: `/does not hold/.test(e.message)`. Any unrelated component could
    // produce that string, and a denial page shown for a parser bug is the same lie inverted.
    const lookalike = new Error("role sales does not hold finance:* — CapabilityDenied");
    await expect(renderOrDenied("Finance", async () => { throw lookalike; }))
      .rejects.toThrow(lookalike);
  });

  // ─── THE OUTAGE CONTROLS ─────────────────────────────────────────────────────────────────────
  //
  // `NoAuthority` covers BOTH "nobody is signed in" and "the database is unreachable". Catching it
  // wholesale would report an outage as a permission decision — which is why the reason is
  // discriminated rather than the class.

  it("an OUTAGE is not a denial — NoAuthority('unavailable') is rethrown", async () => {
    const outage = new NoAuthority("unavailable");
    await expect(renderOrDenied("Finance", async () => { throw outage; })).rejects.toThrow(outage);
  });

  it("a resolver that was never bound is a BUG, not a denial — rethrown", async () => {
    const unbound = new NoAuthority("no-resolver");
    await expect(renderOrDenied("Finance", async () => { throw unbound; })).rejects.toThrow(unbound);
  });

  it("a vault or database failure reaches the error boundary untouched", async () => {
    const vault = new Error("ENOENT: no such file or directory, open '02 - Sales & Hit List/x.md'");
    await expect(renderOrDenied("Sales", async () => { throw vault; })).rejects.toThrow(vault);
  });

  // ─── FRAMEWORK CONTROL FLOW ──────────────────────────────────────────────────────────────────
  //
  // notFound(), redirect() and permanentRedirect() WORK BY THROWING. A catch that does not rethrow
  // them turns every missing document into a denial page. Five of the thirteen wrapped pages throw
  // one of these inside the region the handler wraps, so this is a live hazard, not a precaution.

  it("notFound() survives the handler", async () => {
    let thrown: unknown;
    try { await renderOrDenied("Documents", async () => { notFound(); }); }
    catch (e) { thrown = e; }
    expect(thrown, "notFound() was swallowed").toBeDefined();
    expect(isDenied(thrown)).toBe(false);
    let control: unknown;
    try { notFound(); } catch (e) { control = e; }
    // Identical shape to an uncaught notFound(): the handler passed it through unchanged.
    expect((thrown as { digest?: string }).digest).toBe((control as { digest?: string }).digest);
  });

  it("redirect() survives the handler", async () => {
    let thrown: unknown;
    try { await renderOrDenied("Clients", async () => { redirect("/sales"); }); }
    catch (e) { thrown = e; }
    expect(thrown, "redirect() was swallowed").toBeDefined();
    let control: unknown;
    try { redirect("/sales"); } catch (e) { control = e; }
    expect((thrown as { digest?: string }).digest).toBe((control as { digest?: string }).digest);
  });

  it("CONTROL · the assertions above can tell a denial from a rethrow", async () => {
    // Without this, "rejects.toThrow" and "returns Denied" could both be satisfied by a helper that
    // did nothing at all. One input of each kind, checked for OPPOSITE outcomes.
    const denied = await renderOrDenied("X", async () => { throw new CapabilityDenied("finance:*", "sales"); });
    expect(isDenied(denied)).toBe(true);
    await expect(renderOrDenied("X", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });

  it("holds no principal, takes no capability, and reads nothing", () => {
    // The line between coping and authorizing, enforced on the module's own text. If this file ever
    // resolves a principal or names a capability it has stopped classifying and started deciding.
    const src = readFileSync(path.join(process.cwd(), "components/auth/renderOrDenied.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/requireCapability|requirePagePrincipal|pageAuthority|\bcan\s*\(/);
    expect(src).not.toMatch(/Capability\s*[,)]|capability:/);
    expect(src).toMatch(/unstable_rethrow/);
    // Arity: a subtree and a label. Nothing that could carry authority.
    expect(renderOrDenied.length).toBeLessThanOrEqual(2);
  });
});

describe("§22.2 · the premise the design rests on", () => {
  it("no async Server Component exists under components/ — denials cannot escape a page handler", () => {
    // The handler wraps the PAGE FUNCTION. If a component rendered by a page were itself an async
    // Server Component that read guarded data, its refusal would be thrown after the page returned
    // and the handler would never see it — it would reach app/error.tsx and read as a vault failure
    // again. Measured today: every async component is a page; everything under components/ is
    // either synchronous or "use client". This asserts that premise instead of assuming it.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(abs, "utf8");
        if (/^\s*["']use client["']/m.test(src)) continue;
        if (/export\s+(default\s+)?async\s+function/.test(src)) {
          offenders.push(path.relative(process.cwd(), abs));
        }
      }
    };
    walk(path.join(process.cwd(), "components"));
    // EXACTLY ONE name, not a growable exemption list. `renderOrDenied` is async and lives here, and
    // it is not a component: a page CALLS it and awaits it, so anything it catches was thrown inside
    // the page's own await. Every other async export under components/ would be rendered as a CHILD,
    // and a child's refusal is thrown after its page returned — bypassing the handler and surfacing
    // as a vault failure again. Asserting the exact set means a second one fails this test.
    expect(offenders,
      "an async Server Component under components/ can refuse AFTER its page returned, so its " +
      "denial would bypass the page's handler and be reported as a vault failure. Either wrap it " +
      "in its own handler or move the read into the page."
    ).toEqual(["components/auth/renderOrDenied.tsx"]);
  });
});

// ─── THE PAGES THEMSELVES ──────────────────────────────────────────────────────────────────────

const SALES_HOLDS = new Set(["prospects:read", "prospects:write", "pipeline:read", "pipeline:write", "search"]);

/**
 * Derived from the COMMITTED contract, never a hand-written list — see §22.1 question 6.
 *
 * THIS IS THE COMPLETE DENIAL INVENTORY. Every page a sales principal cannot render is here, whether
 * or not it appears in navigation. `tests/auth/nav-boundary` (F57) asks a NARROWER and DIFFERENT
 * question over the navigation subset — that what the rail HIDES still refuses — and states the
 * relationship in its own header. Neither suite is the whole picture on its own.
 */
const DENIES_SALES = Object.entries(PAGE_AUTHORIZATION)
  .filter(([, caps]) => caps.length > 0 && caps.some((c) => !SALES_HOLDS.has(c)))
  .map(([page]) => page)
  .sort();

const PAGES: Record<string, () => Promise<Record<string, unknown>>> = {
  "/": () => import("@/app/page"),
  // 2G.4.4. These three arrived in the inventory by DERIVATION, not by being added: they moved off
  // `[]` in `PAGE_AUTHORIZATION`, and `DENIES_SALES` is computed from that map. The importers below
  // are what the derived set then demanded — the totality assertion is what made it impossible to
  // change the contract and forget the coverage.
  "admin": () => import("@/app/admin/page"),
  "admin/import": () => import("@/app/admin/import/page"),
  "admin/invitations": () => import("@/app/admin/invitations/page"),
  "admin/wipe": () => import("@/app/admin/wipe/page"),
  "clients/[slug]": () => import("@/app/clients/[slug]/page"),
  "clients/[slug]/portal": () => import("@/app/clients/[slug]/portal/page"),
  "clients/[slug]/project": () => import("@/app/clients/[slug]/project/page"),
  "crm": () => import("@/app/crm/page"),
  "documents": () => import("@/app/documents/page"),
  "documents/[id]": () => import("@/app/documents/[id]/page"),
  "finance": () => import("@/app/finance/page"),
  "maintenance": () => import("@/app/maintenance/page"),
  "production": () => import("@/app/production/page"),
  "production/[client]": () => import("@/app/production/[client]/page"),
  "signals": () => import("@/app/signals/page"),
  "tasks": () => import("@/app/tasks/page"),
};

let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-denial-"));
  for (const d of [".ascend-os", "01 - CRM & Clients", "02 - Sales & Hit List", "03 - SOP Library", "04 - Documents"]) {
    await fs.mkdir(path.join(vaultDir, d), { recursive: true });
  }
  for (const f of ["crm", "production", "intelligence"]) {
    await fs.writeFile(path.join(vaultDir, ".ascend-os", `${f}.events.jsonl`), "");
  }
  process.env.ASCEND_VAULT_PATH = vaultDir;
  // The DEPLOYED store, for the same reason F51 uses it (a8167ec): the vault reader needs no
  // capability, so measuring against it would understate which pages can refuse.
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  installStubDb();
  resetMemberships();
});

afterAll(async () => {
  unbindTestAuthority();
  removeStubDb();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
  else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

async function render(key: string, role: "owner" | "sales"): Promise<{ el?: unknown; err?: unknown }> {
  bindTestAuthority(role);
  try {
    const mod = await PAGES[key]();
    const page = mod.default as (props: unknown) => Promise<unknown>;
    const el = await page({
      params: Promise.resolve({ slug: "acme-co", client: "acme-co", id: "doc-1" }),
      searchParams: Promise.resolve({}),
    });
    return { el };
  } catch (err) {
    return { err };
  } finally {
    unbindTestAuthority();
  }
}

describe("§22.5 · every page that CAN deny, DOES — visibly, and without leaking", () => {
  it("the wrapped set is exactly the set the contract says denies sales", () => {
    // Coverage is DERIVED, so a page that starts denying sales later cannot quietly go unwrapped.
    expect(Object.keys(PAGES).sort()).toEqual(DENIES_SALES);
    expect(DENIES_SALES).toHaveLength(17);   // +3: 2G.4.4's admin surface (§29.3 Ruling 2)
  });

  for (const key of Object.keys(PAGES).sort()) {
    it(`${key} · a sales principal sees Denied, and no protected data`, async () => {
      const { el, err } = await render(key, "sales");
      expect(err, `${key} threw instead of rendering a denial`).toBeUndefined();
      expect(isDenied(el), `${key} did not render Denied`).toBe(true);
      const html = renderToStaticMarkup(el as ReactElement);
      // No fixture data, no money, no capability token. The page refused before it obtained
      // anything, so there is nothing of the client's for the markup to carry.
      expect(html, `${key} leaked fixture data into a denial`).not.toMatch(/acme|invoice|\$[\d,]+/i);
      expect(html, `${key} named a capability on a denial`).not.toMatch(CAPABILITY_TOKEN);
    });
  }

  for (const key of Object.keys(PAGES).sort()) {
    it(`${key} · an owner is NOT denied`, async () => {
      // The other half of the property. A handler that returned Denied for everyone would satisfy
      // every assertion above.
      const { el, err } = await render(key, "owner");
      expect(isDenied(el), `${key} denied its own owner`).toBe(false);
      if (err) {
        expect(err, `${key} refused an owner`).not.toBeInstanceOf(CapabilityDenied);
        expect(err, `${key} found no authority for an owner`).not.toBeInstanceOf(NoAuthority);
      }
    });
  }
});
