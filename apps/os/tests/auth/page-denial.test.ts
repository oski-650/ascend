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
import { AccountRefused, CapabilityDenied, NoAuthority } from "@/core/auth/authority";
import { capabilitiesForRole } from "@/core/auth/capabilities";
import { AccountInactive } from "@/components/auth/AccountInactive";
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

/** Was this element the REVOCATION surface? Same structural discipline (2G.4.5). */
const isInactive = (el: unknown): boolean =>
  typeof el === "object" && el !== null && (el as ReactElement).type === AccountInactive;

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

  // ─── THE ANSWERED HALF, ADDED 2G.4.5 (§29.3 Ruling 3) ───────────────────────────────────────
  //
  // The two controls ABOVE are what make these tests mean something. If this handler ever went back
  // to converting `NoAuthority` as a class, every assertion here would still pass and both of those
  // would fail — which is why they are not being relaxed to accommodate the new branch.

  it("AccountRefused → the AccountInactive surface, NOT the Denied one", async () => {
    const el = await renderOrDenied("Finance", async () => { throw new AccountRefused("disabled"); });
    expect(isInactive(el), "a revoked account did not reach the named surface").toBe(true);
    expect(isDenied(el), "a revoked account was shown the capability-denial copy").toBe(false);
  });

  it("the revocation surface names no reason, no capability, and no role", async () => {
    // Revoked, unmembered, ambiguous and unknown must render IDENTICALLY — naming which one is an
    // enumeration oracle, the same rule Denied and route-guard's 403 body already follow.
    const html = renderToStaticMarkup(
      (await renderOrDenied("Finance", async () => { throw new AccountRefused("disabled"); })) as ReactElement
    );
    expect(html, "a capability token reached the page").not.toMatch(CAPABILITY_TOKEN);
    expect(html, "the caller's role was attributed on the page").not.toMatch(/\brole\s+\w+/i);
    for (const reason of ["disabled", "no-membership", "ambiguous-membership", "no-such-user"]) {
      expect(html, `the surface named the reason: ${reason}`).not.toContain(reason);
    }
  });

  it("every refusal reason renders the SAME markup — the four are indistinguishable", async () => {
    const markup = await Promise.all(
      ["disabled", "no-membership", "ambiguous-membership", "no-such-user"].map(async (reason) =>
        renderToStaticMarkup(
          (await renderOrDenied("Finance", async () => { throw new AccountRefused(reason); })) as ReactElement
        )
      )
    );
    expect(new Set(markup).size, "two refusal reasons produced different pages").toBe(1);
  });

  it("it OFFERS sign-out and never performs one — a form, not a redirect", async () => {
    // A redirect from here could only fire for someone holding a VALID cookie, which is the login
    // loop renderOrDenied's own header refuses to build. And `Denied`'s onward link is wrong here:
    // a revoked account has no pipeline to go to.
    const html = renderToStaticMarkup(
      (await renderOrDenied("Finance", async () => { throw new AccountRefused("disabled"); })) as ReactElement
    );
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toContain('method="post"');
    expect(html, "the revocation surface offered a destination the account cannot reach")
      .not.toContain('href="/sales"');
  });

  it("the two convertible refusals are DISJOINT classes — the branch order cannot matter", async () => {
    // renderOrDenied checks AccountRefused first. That ordering is only safe while nothing can be
    // both; asserting it here means a future common ancestor fails a test rather than silently
    // changing which surface a caller sees.
    expect(new AccountRefused("disabled")).not.toBeInstanceOf(CapabilityDenied);
    expect(new CapabilityDenied("finance:*", "sales")).not.toBeInstanceOf(AccountRefused);
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

// DERIVED FROM THE CAPABILITY TABLE, never re-typed (2G.4.7). This was a hand-written set of five
// strings — a second copy of a security fact, living in the file whose job is to check that fact.
// It would not have failed silently (a stale copy makes the expected-denial set too LARGE, so the
// suite goes red) but it would have gone red for the wrong reason, and a reader would have needed
// three lists to learn one answer.
const SALES_HOLDS = new Set<string>(capabilitiesForRole("sales"));

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

// ─── THE INVENTORY COLLAPSED FROM 14 TO 3 AT 2G.4.7, BY DERIVATION ───────────────────────────
//
// `DENIES_SALES` is computed from `PAGE_AUTHORIZATION` and `capabilitiesForRole("sales")`. When the
// partner became `owner` minus `admin:*`, eleven pages stopped denying him and left this map on
// their own — the totality assertion below is what forced the map to follow rather than sit stale.
//
// **Coverage did not disappear with them.** Those eleven moved to `NOT_DENIED` below, where they are
// asserted to be NOT REFUSED for sales. A suite whose subject is "pages that can deny" would
// otherwise have quietly become a suite about three admin pages, and the eleven most important rows
// of this authorization change would have had no static-phase witness at all.
const PAGES: Record<string, () => Promise<Record<string, unknown>>> = {
  "admin": () => import("@/app/admin/page"),
  "admin/invitations": () => import("@/app/admin/invitations/page"),
  "admin/wipe": () => import("@/app/admin/wipe/page"),
};

/**
 * The pages a sales principal may now reach, derived the same way and from the same source.
 *
 * Non-empty declaration, every capability held. `[]`-declared pages are excluded deliberately —
 * they demand nothing, so "not refused" says nothing about them.
 */
const NOT_DENIED = Object.entries(PAGE_AUTHORIZATION)
  .filter(([, caps]) => caps.length > 0 && caps.every((c) => SALES_HOLDS.has(c)))
  .map(([page]) => page)
  .sort();

const REACHABLE: Record<string, () => Promise<Record<string, unknown>>> = {
  "/": () => import("@/app/page"),
  "automations": () => import("@/app/automations/page"),
  "clients/[slug]": () => import("@/app/clients/[slug]/page"),
  "clients/[slug]/portal": () => import("@/app/clients/[slug]/portal/page"),
  "clients/[slug]/project": () => import("@/app/clients/[slug]/project/page"),
  "console": () => import("@/app/console/page"),
  "crm": () => import("@/app/crm/page"),
  "documents": () => import("@/app/documents/page"),
  "documents/[id]": () => import("@/app/documents/[id]/page"),
  "finance": () => import("@/app/finance/page"),
  "maintenance": () => import("@/app/maintenance/page"),
  "partner": () => import("@/app/partner/page"),
  "production": () => import("@/app/production/page"),
  "production/[client]": () => import("@/app/production/[client]/page"),
  "sales": () => import("@/app/sales/page"),
  "sales/[prospect]": () => import("@/app/sales/[prospect]/page"),
  "sales/import": () => import("@/app/sales/import/page"),
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
    const mod = await (PAGES[key] ?? REACHABLE[key])();
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
    // 2G.4.7 collapsed this from 17 to 3. The partner became `owner` minus `admin:*`, so the only
    // pages that still deny him are the ones demanding the single capability he does not hold.
    // The number is an OUTPUT of the capability table, not a target — `DENIES_SALES` is derived, and
    // this assertion exists so the collapse cannot happen without a reader noticing it happened.
    expect(DENIES_SALES).toHaveLength(3);    // admin, admin/invitations, admin/wipe
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

  // ─── THE OTHER SIDE OF 2G.4.7, AND THE REASON THE COLLAPSE ABOVE IS NOT A LOSS ──────────────
  //
  // Eleven pages left the denial inventory. Asserting only that the remaining three still deny would
  // have made this suite pass for a reason nobody chose — a role granted NOTHING would satisfy it
  // just as well as a role granted everything. These rows are what distinguish the two.
  //
  // NOT REFUSED, never RENDERS DATA: the fixture vault here is deliberately near-empty, so several
  // of these legitimately reach `notFound()`. What none of them may do is fail for an authorization
  // reason — the same discipline `dal-boundary`'s `notRefused` uses, and for the same reason.
  describe("§22.5 · 2G.4.7 · every page the partner may now reach does NOT refuse him", () => {
    it("the reachable set is exactly what the contract says sales can render", () => {
      expect(Object.keys(REACHABLE).sort()).toEqual(NOT_DENIED);
      expect(NOT_DENIED.length, "no page is reachable by sales — the block below is vacuous")
        .toBeGreaterThan(10);
    });

    for (const key of Object.keys(REACHABLE).sort()) {
      it(`${key} · sales is not refused`, async () => {
        const { el, err } = await render(key, "sales");
        expect(isDenied(el), `${key} refused a partner who holds its capabilities`).toBe(false);
        if (err) {
          expect(err, `${key} refused sales with CapabilityDenied`).not.toBeInstanceOf(CapabilityDenied);
          expect(err, `${key} refused sales with NoAuthority`).not.toBeInstanceOf(NoAuthority);
        }
      });
    }
  });

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
