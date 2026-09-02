// Layer B — THE RAIL IS CAPABILITY-SHAPED (2G.3, STAGE2G §28.7/§28.12).
//
// §28.12 requires that the partner "sees a rail containing only what they may reach". Until this
// suite existed `lib/nav-visibility` had no test importing it — and the reason is worth recording,
// because it is a trap that will recur:
//
//   F57's header says it "does not read the rail, does not trust `visibleDestinations`". That was
//   the RIGHT call for F57 — a bug in the resolver must not be able to decide which destinations
//   F57 checks. The consequence was that both mentions of the resolver in that file are COMMENTS,
//   and nothing anywhere executed it. The suite that looked like it owned navigation visibility was
//   the one deliberately avoiding it.
//
// ─── AUTHORITY IS ESTABLISHED EXPLICITLY, NEVER INHERITED ──────────────────────────────────────
//
// `visibleDestinations` calls `pageAuthority()`, which reads a cookie through `next/headers` and
// returns `{ok:false, reason:"no-request"}` outside a request scope — so an unprepared suite would
// measure the EMPTY-LIST path and report green while testing nothing. Exactly the shape of the F51
// defect where the contract was measured against a store nothing deploys.
//
// So `pageAuthority` is mocked to a known principal, deliberately and visibly. What is under test is
// the FILTERING — the resolver's own trust chain is proven in `tests/auth/page-principal.test.ts`
// and is not re-proven here.
//
// ─── PRESENTATION, NOT AUTHORIZATION ───────────────────────────────────────────────────────────
//
// Nothing here establishes that a hidden destination is unreachable. That is F57's job, by direct
// request against the destination itself, and the two must never substitute for one another:
//
//     navigation filtering  =  presentation
//     PAGE_AUTHORIZATION    =  authorization

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesFor } from "@/core/auth/capabilities";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { NAV_DESTINATIONS } from "@/navigation/destinations";
import type { MembershipRole, OrganizationId, UserId } from "@/domain";
import { TEST_ORG_A, TEST_OWNER_ID, TEST_SALES_ID } from "@/tests/support/operator-session";

const principalFor = (role: MembershipRole, userId: string) =>
  __unsafePrincipalForTests(role, TEST_ORG_A as OrganizationId, userId as UserId);

const OWNER = principalFor("owner", TEST_OWNER_ID);
const SALES = principalFor("sales", TEST_SALES_ID);

/** The mocked authority for a given test. Set before importing the module under test. */
let authority: { ok: true; principal: ReturnType<typeof principalFor> } | { ok: false; reason: string };

vi.mock("@/lib/page-principal", () => ({
  pageAuthority: async () => authority,
}));

/** Fresh import per test, so the mock is applied to the module instance under test. */
async function visible(): Promise<string[]> {
  const { visibleDestinations } = await import("@/lib/nav-visibility");
  return visibleDestinations();
}

beforeEach(() => {
  vi.resetModules();
  authority = { ok: false, reason: "unset" };
});

afterEach(() => vi.restoreAllMocks());

describe("visibleDestinations · the rail a partner actually sees", () => {
  it("a SALES principal is shown ONLY destinations whose requirements it holds", async () => {
    authority = { ok: true, principal: SALES };
    const shown = await visible();
    const held = new Set<string>(capabilitiesFor(SALES));

    const unreachable = shown
      .map((href) => NAV_DESTINATIONS.find((d) => d.href === href)!)
      .filter((d) => d.requires.some((c) => !held.has(c)));
    expect(unreachable.map((d) => d.href),
      "the rail offered the partner a destination they cannot render").toEqual([]);
  });

  it("…and the OMISSIONS are the ones §28 names", async () => {
    // Named explicitly rather than derived, so the test states an expectation about the product and
    // not merely a restatement of the filter. `/finance` is the §28.7 example verbatim.
    authority = { ok: true, principal: SALES };
    const shown = new Set(await visible());
    for (const href of ["/", "/finance", "/crm", "/production", "/tasks", "/signals",
                        "/maintenance", "/documents", "/admin/invitations"]) {
      expect(shown.has(href), `${href} was offered to the partner`).toBe(false);
    }
  });

  it("…and the partner still SEES the work that is theirs", async () => {
    // The other half. A rail that hid everything would satisfy the assertion above completely.
    authority = { ok: true, principal: SALES };
    const shown = new Set(await visible());
    for (const href of ["/partner", "/sales", "/console", "/automations"]) {
      expect(shown.has(href), `${href} is missing from the partner's rail`).toBe(true);
    }
  });

  it("an OWNER sees every declared destination", async () => {
    authority = { ok: true, principal: OWNER };
    expect(await visible()).toEqual(NAV_DESTINATIONS.map((d) => d.href));
  });

  it("`/admin` is hidden from the partner BECAUSE THE PAGE REFUSES — not by concealment", async () => {
    // The inverse of what this test asserted until 2G.4.4, and the reason for the flip is the whole
    // property. §28.2 ruling 5 kept `/admin` VISIBLE while it declared `[]`, because hiding the link
    // would have made the rail look correct while the route stayed exactly as reachable. The page now
    // demands `admin:*` through `core/admin/tools`, so the rail hides it for the only admissible
    // reason: the destination refuses.
    //
    // This assertion is deliberately NOT the whole proof — on its own it cannot tell concealment from
    // a guard. `tests/auth/nav-boundary` (F57) is the half that can: it renders every destination
    // hidden from sales and requires it to produce the denial surface, and `/admin` is now in that
    // set. If someone ever hides a link without guarding its page, F57 fails, not this.
    authority = { ok: true, principal: SALES };
    expect((await visible()).includes("/admin")).toBe(false);
  });

  it("preserves declared order, and invents nothing", async () => {
    authority = { ok: true, principal: SALES };
    const shown = await visible();
    const all = NAV_DESTINATIONS.map((d) => d.href);
    expect(shown.every((h) => all.includes(h)), "the rail invented a destination").toBe(true);
    expect(shown).toEqual(all.filter((h) => shown.includes(h)));
  });
});

describe("visibleDestinations · it fails to EMPTY, which is the safe direction for a rail", () => {
  it("no authority yields no links", async () => {
    // Tested as its own case rather than reached by accident — an unprepared suite measures this
    // path for every assertion and reports green while proving nothing.
    authority = { ok: false, reason: "unauthenticated" };
    expect(await visible()).toEqual([]);
  });

  it("a database outage yields no links, not every link", async () => {
    authority = { ok: false, reason: "unavailable" };
    expect(await visible()).toEqual([]);
  });

  it("THE CONTROL · the empty result above is not what a real principal produces", async () => {
    // Without this, every assertion in this file could be passing because the mock never took
    // effect — the F51 failure mode, where a green contract described a configuration nobody runs.
    authority = { ok: true, principal: SALES };
    expect((await visible()).length).toBeGreaterThan(0);
  });
});
