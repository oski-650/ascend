// Layer B — F57 · A HIDDEN DESTINATION STILL REFUSES (2G.3, STAGE2G §28.7).
//
// ─── THE REGRESSION THIS EXISTS TO CATCH ───────────────────────────────────────────────────────
//
//     BEFORE                              AFTER, IF DONE BADLY
//     sales sees /finance                 sales does not see /finance
//       → clicks it                         → requests /finance directly
//       → receives Denied                   → gets the page
//
// The second state has a cleaner UI and a weaker system. Capability-shaped navigation is only an
// improvement while every destination it omits refuses the same principal on a direct request — so
// this suite does not read the rail, does not trust `visibleDestinations`, and does not consult any
// declaration. It RENDERS each hidden page as a sales principal and looks at what comes back.
//
//   > Every destination removed from a role's navigation because of authorization must
//   > independently reject that role when directly requested.
//
// ─── WHY IT ASSERTS THE DENIAL SURFACE RATHER THAN AN EXCEPTION ────────────────────────────────
//
// Slice 3 wrapped these pages in `renderOrDenied`, which converts `CapabilityDenied` into the
// `Denied` component. A page that refuses therefore RETURNS rather than throws, and the honest
// assertion is on what it returned. Comparing against the component itself — not a string of its
// copy — means rewording the denial cannot silently turn this rule green.
//
// ─── WHO OWNS WHAT, BECAUSE TWO SUITES ASK ABOUT THE SAME PAGES ────────────────────────────────
//
// Recorded after the §28 evidence review, where the relationship was first stated WRONGLY as a
// coverage split. It is not a split — it is two different questions over overlapping sets:
//
//   tests/auth/page-denial.test.ts   THE DENIAL INVENTORY. Every page whose declared capabilities a
//                                    sales principal does not hold — all of them — renders `Denied`.
//                                    Derived from the contract, so a page that starts denying later
//                                    cannot go unwrapped.
//
//   THIS SUITE (F57)                 A NARROWER, DIFFERENT CLAIM over the subset that is also a
//                                    NAVIGATION DESTINATION: what the rail HIDES still refuses.
//                                    It exists because navigation filtering is presentation, and a
//                                    hidden destination that served its content would be a
//                                    regression the inventory alone would not describe.
//
// Neither suite is the other's superset in meaning, and the assertion below keeps the sets honest:
// every destination this suite hides must appear in the inventory. If one ever does not, a page is
// being hidden that nothing proves refuses — which is precisely §28.7's failure mode.
//
// ─── THE CONTROL IS THE OTHER HALF ─────────────────────────────────────────────────────────────
//
// A harness that reported "denied" for everything would pass this suite while proving nothing. So a
// VISIBLE destination is rendered by the same code path and asserted NOT to be the denial surface,
// and the hidden set is asserted non-empty. Both halves, or neither means anything.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Denied } from "@/components/auth/Denied";
import { capabilitiesFor } from "@/core/auth/capabilities";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { NAV_DESTINATIONS, pageKeyFor } from "@/navigation/destinations";
import { PAGE_AUTHORIZATION } from "@/tests/architecture/page-authorization";
import type { OrganizationId, UserId } from "@/domain";
import {
  TEST_ORG_A, TEST_SALES_ID, installStubDb, removeStubDb, resetMemberships, unbindTestAuthority,
} from "@/tests/support/operator-session";
import { registerAuthorityResolver } from "@/core/auth/authority";

/** Page importers for every destination, written out — a bundler cannot analyse `import(variable)`. */
const PAGES: Record<string, () => Promise<Record<string, unknown>>> = {
  "/": () => import("@/app/page"),
  "/partner": () => import("@/app/partner/page"),
  "/crm": () => import("@/app/crm/page"),
  "/production": () => import("@/app/production/page"),
  "/sales": () => import("@/app/sales/page"),
  "/tasks": () => import("@/app/tasks/page"),
  "/signals": () => import("@/app/signals/page"),
  "/automations": () => import("@/app/automations/page"),
  "/maintenance": () => import("@/app/maintenance/page"),
  "/documents": () => import("@/app/documents/page"),
  "/console": () => import("@/app/console/page"),
  "/finance": () => import("@/app/finance/page"),
  "/admin": () => import("@/app/admin/page"),
  "/admin/invitations": () => import("@/app/admin/invitations/page"),
};

const SALES = __unsafePrincipalForTests("sales", TEST_ORG_A as OrganizationId, TEST_SALES_ID as UserId);
const SALES_CAPABILITIES = new Set<string>(capabilitiesFor(SALES));

/** Exactly the rule the rail applies — recomputed here rather than imported, so a bug in
 *  `visibleDestinations` cannot decide which destinations this suite checks. */
const hidden = NAV_DESTINATIONS.filter((d) => !d.requires.every((c) => SALES_CAPABILITIES.has(c)));
const visible = NAV_DESTINATIONS.filter((d) => d.requires.every((c) => SALES_CAPABILITIES.has(c)));

let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;

/**
 * The same FOUND, NON-EMPTY vault F51 seeds, and for the same reason in reverse.
 *
 * F51 needs it so a page reaches its guarded call instead of stopping at `notFound()`. This suite
 * needs it so a page that WOULD refuse is not instead failing for a missing fixture — a refusal and
 * a crash both stop the render, and only one of them is the property under test.
 */
async function seed(dir: string) {
  const mk = (p: string) => fs.mkdir(path.join(dir, p), { recursive: true });
  await Promise.all([
    mk(".ascend-os"), mk("01 - CRM & Clients/acme-co"), mk("02 - Sales & Hit List"),
    mk("03 - SOP Library"), mk("04 - Documents/acme-co/proposal"), mk("05 - Client Uploads"),
  ]);
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/business_context.md"),
    "---\nname: Acme Co\nstatus: active\n---\n\nContext.\n");
  await fs.writeFile(path.join(dir, "02 - Sales & Hit List/lead-one.md"),
    "---\nname: Lead One\nstatus: lead\n---\n\nNotes.\n");
  await fs.writeFile(path.join(dir, "04 - Documents/acme-co/proposal/proposal-v1.md"),
    "---\ndoc_id: doc-fixture-1\ntype: proposal\nclient: acme-co\ntitle: Acme Proposal\n" +
    "version: 1\nstatus: draft\ncreated_at: 2026-01-01T00:00:00.000Z\namount_usd: 1000\n---\n\nScope.\n");
  await fs.writeFile(path.join(dir, "01 - CRM & Clients/acme-co/production_state.md"),
    "---\nlaunch_target: 2026-06-01\nphases:\n  discovery:\n    status: complete\n" +
    "  build:\n    status: in_progress\n---\n\n## Build\n- [ ] Wire the homepage\n- [x] Kickoff\n");
}

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-f57-"));
  await seed(vaultDir);
  process.env.ASCEND_VAULT_PATH = vaultDir;
  // The DEPLOYED store, for the reason F51 records: measured against `vault`, prospect readers need
  // no capability and half this suite would silently stop testing anything.
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
  installStubDb();
  resetMemberships();
  registerAuthorityResolver(async () => ({ ok: true, principal: SALES }));
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

/** Render a destination as the sales principal and report whether it produced the denial surface. */
async function rendersDenied(href: string): Promise<boolean> {
  const mod = await PAGES[href]();
  const page = mod.default as (props: unknown) => Promise<unknown>;
  const out = (await page({
    params: Promise.resolve({ slug: "acme-co", client: "acme-co", prospect: "lead-one",
                              id: "doc-fixture-1", token: "no-such-token", reqId: "no-such-request" }),
    searchParams: Promise.resolve({ q: "acme" }),
  })) as { type?: unknown };
  return out?.type === Denied;
}

describe("F57 · every destination hidden from sales refuses sales directly", () => {
  it("every navigation destination has an importer — totality, not a maintained subset", () => {
    expect(Object.keys(PAGES).sort()).toEqual(NAV_DESTINATIONS.map((d) => d.href).sort());
  });

  it("the hidden set is NON-EMPTY, so the assertions below are not vacuous", () => {
    // If capability-shaped navigation ever hides nothing, this suite proves nothing, and a green
    // run would be indistinguishable from a rail that filters no longer.
    expect(hidden.length, "nothing is hidden from sales — F57 would be vacuous").toBeGreaterThan(0);
  });

  for (const d of hidden) {
    it(`${d.href} is hidden from sales AND refuses sales on a direct request`, async () => {
      expect(
        await rendersDenied(d.href),
        `${d.href} is hidden from the sales rail but did NOT refuse a direct sales request — ` +
          `hiding a link is not authorization (${pageKeyFor(d.href)})`
      ).toBe(true);
    });
  }
});

describe("F57 · the relationship to the denial inventory is stated, not assumed", () => {
  it("every destination hidden from sales is in the contract's denial set", () => {
    // Derived from the same source `page-denial` derives its inventory from, so the two cannot drift
    // apart silently. A hidden destination missing from this set would be one the rail conceals and
    // nothing proves refuses.
    const denies = new Set(
      Object.entries(PAGE_AUTHORIZATION)
        .filter(([, caps]) => caps.length > 0 && caps.some((c) => !SALES_CAPABILITIES.has(c)))
        .map(([page]) => page)
    );
    const unproven = hidden.map((d) => pageKeyFor(d.href)).filter((p) => !denies.has(p));
    expect(unproven, "hidden from the rail but not in the denial inventory").toEqual([]);
  });

  it("the inventory is WIDER than this suite, and that is the intended shape", () => {
    // F57's subject is the navigation subset. The inventory covers denying pages that are not
    // destinations at all — clients/[slug]/project, documents/[id], production/[client] today.
    // Asserting the inequality stops someone reading either suite as the complete picture.
    const denies = Object.entries(PAGE_AUTHORIZATION)
      .filter(([, caps]) => caps.length > 0 && caps.some((c) => !SALES_CAPABILITIES.has(c)))
      .map(([page]) => page);
    const navKeys = new Set(NAV_DESTINATIONS.map((d) => pageKeyFor(d.href)));
    expect(denies.filter((p) => !navKeys.has(p)).length,
      "every denying page is now a navigation destination — re-read the ownership note above")
      .toBeGreaterThan(0);
  });
});

describe("F57 · the control — the instrument can tell the two apart", () => {
  it("a VISIBLE destination does not render the denial surface for sales", async () => {
    // Without this, an instrument that reported "denied" unconditionally would pass every assertion
    // above while measuring nothing at all.
    const probe = visible.find((d) => d.href === "/partner") ?? visible[0];
    expect(probe, "sales can see nothing — the control has no subject").toBeTruthy();
    expect(
      await rendersDenied(probe.href),
      `${probe.href} is visible to sales but rendered the denial surface`
    ).toBe(false);
  });
});
