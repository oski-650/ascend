// Layer B — F56 · THE NAVIGATION TABLE IS HELD TO THE AUTHORIZATION CONTRACT (2G.3, §28.7/§28.10).
//
// ─── THE DUPLICATION THIS RULE EXISTS TO MAKE SAFE ─────────────────────────────────────────────
//
// `navigation/destinations` declares what each link REQUIRES, and `PAGE_AUTHORIZATION` declares what
// each page DEMANDS. Two declarations of the same fact, and they must be two because production code
// cannot import from `tests/` — the authorization contract is a test artifact by design, since a
// page's authority comes from the DAL it reaches and never from a table.
//
// Unchecked, that duplication becomes a second and more permissive opinion about who may reach what.
// So it is checked, in both directions and exactly:
//
//     every nav href          ⟷   names a declared page
//     every `requires`        ⟷   EQUALS that page's declared capabilities
//
// A subset would be worse than useless. If a link required FEWER capabilities than its page demands,
// the rail would advertise a destination that denies — the visible-denial state 2G.3 exists to end.
// If it required MORE, the link would vanish for someone who could use the page, and nothing would
// ever say so.
//
// ─── WHAT THIS RULE IS NOT ─────────────────────────────────────────────────────────────────────
//
// It is not an authorization control and must never be described as one. It compares two
// DECLARATIONS. F57 is the rule that goes and asks the destinations themselves.

import { describe, expect, it } from "vitest";
import { PAGE_AUTHORIZATION } from "./page-authorization";
import { read } from "./source-graph";
import {
  LANDING_ORDER,
  NAV_DESTINATIONS,
  NAV_GROUP_ORDER,
  pageKeyFor,
} from "@/navigation/destinations";

describe("F56 · every navigation destination is a classified page", () => {
  it("every href names a page in the authorization contract", () => {
    const unclassified = NAV_DESTINATIONS
      .map((d) => d.href)
      .filter((href) => !(pageKeyFor(href) in PAGE_AUTHORIZATION));
    // A link to a page nobody classified is the failure mode this rule was written for: it ships,
    // it works, and its authorization was never stated anywhere.
    expect(unclassified, "nav destinations with no PAGE_AUTHORIZATION entry").toEqual([]);
  });

  it("every `requires` equals that page's declared capabilities EXACTLY", () => {
    const drift: string[] = [];
    for (const d of NAV_DESTINATIONS) {
      const declared = PAGE_AUTHORIZATION[pageKeyFor(d.href)];
      if (!declared) continue; // reported by the test above; not double-counted here
      const nav = [...d.requires].sort();
      const page = [...declared].sort();
      if (nav.join("|") !== page.join("|")) {
        drift.push(`${d.href}: nav requires [${nav}] but the page declares [${page}]`);
      }
    }
    expect(drift, "navigation and authorization disagree about a destination").toEqual([]);
  });

  it("every landing destination is a real destination", () => {
    const hrefs = new Set(NAV_DESTINATIONS.map((d) => d.href));
    expect(LANDING_ORDER.filter((h) => !hrefs.has(h)), "landing order names an unknown destination")
      .toEqual([]);
  });

  it("every destination's group is in the declared group order", () => {
    const groups = new Set(NAV_GROUP_ORDER);
    expect(
      NAV_DESTINATIONS.filter((d) => !groups.has(d.group)).map((d) => d.href),
      "a destination would never render — its group is not in NAV_GROUP_ORDER"
    ).toEqual([]);
  });
});

describe("F56 · the rail draws the table, and does not keep its own copy", () => {
  it("NavRail declares no hrefs of its own", () => {
    // Before 2G.3 the rail held twelve hardcoded links. If any come back, this table stops being
    // the single description of the navigation surface and the rule above stops covering it.
    const code = read("components/shell/NavRail.tsx");
    const literals = [...code.matchAll(/href:\s*"\/[^"]*"/g)].map((m) => m[0]);
    expect(literals, "NavRail hardcodes destinations again — they belong in navigation/destinations")
      .toEqual([]);
  });

  it("the table is non-empty and the rule is therefore not vacuous", () => {
    expect(NAV_DESTINATIONS.length).toBeGreaterThan(0);
    expect(LANDING_ORDER.length).toBeGreaterThan(0);
  });
});
