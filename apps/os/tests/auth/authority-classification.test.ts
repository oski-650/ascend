// tests/auth/authority-classification — THE ANSWERED/UNANSWERED SPLIT (2G.4.5, STAGE2G §29.3
// Ruling 3).
//
// ─── WHAT THIS PROVES THAT `page-denial.test.ts` CANNOT ────────────────────────────────────────
//
// `page-denial` proves the HANDLER converts an `AccountRefused` it is handed and rethrows a
// `NoAuthority` it is handed. It says nothing about which failures become which class, because it
// constructs the errors itself. That mapping lives in `lib/authority`'s `failureKind` switch, and a
// mapping nothing measures is a mapping that can be inverted without a test noticing — the whole
// split would then be a rename.
//
// This file measures the seam end to end: a `PageDenial` goes in through the resolver
// `bindAuthorityResolver` registers, and a CLASS comes out of `requireCapability`.
//
// ─── TOTALITY IS ENFORCED BY THE COMPILER, NOT BY THIS FILE REMEMBERING ────────────────────────
//
// `EXPECTED` is typed `Record<PageDenial, AuthorityFailure>`, so a reason added to `PageDenial`
// fails to COMPILE here as well as in `lib/authority`. Two independent compile-time failures for one
// omission — the switch cannot classify it, and this suite cannot ignore it.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountRefused, NoAuthority, clearAuthorityResolver, requireCapability,
  type AuthorityFailure,
} from "@/core/auth/authority";
import type { PageAuthority, PageDenial } from "@/lib/page-principal";

/** What the mocked page carrier answers for the test currently running. */
let answer: PageAuthority = { ok: false, reason: "unauthenticated" };

vi.mock("@/lib/page-principal", () => ({
  pageAuthority: async () => answer,
}));

/**
 * The mapping, stated independently of the implementation.
 *
 * Deliberately NOT imported from `lib/authority` — `failureKind` is not exported, and exporting it
 * so a test could compare it to itself would prove only that a function equals itself.
 */
const EXPECTED: Record<PageDenial, AuthorityFailure> = {
  // ANSWERED — the database was reachable, was asked, and its answer denies this person.
  "disabled": "refused",
  "no-membership": "refused",
  "ambiguous-membership": "refused",
  "no-such-user": "refused",
  // UNANSWERED — nobody could be identified, or nothing could answer.
  "unauthenticated": "unidentified",
  "no-request": "unidentified",
  "unavailable": "unidentified",
};

async function thrownFor(reason: PageDenial): Promise<unknown> {
  answer = { ok: false, reason };
  const { bindAuthorityResolver } = await import("@/lib/authority");
  bindAuthorityResolver();
  try {
    await requireCapability("finance:*");
  } catch (e) {
    return e;
  } finally {
    clearAuthorityResolver();
  }
  throw new Error(`requireCapability RETURNED for reason "${reason}" — it must never resolve on a failure`);
}

afterEach(() => clearAuthorityResolver());

describe("§29.3 Ruling 3 · every PageDenial is classified, and the class is the one contracted", () => {
  it("the mapping is TOTAL — this list is typed by PageDenial itself", () => {
    // Not a count of today's members: the compiler rejects this file if the union grows. The runtime
    // assertion below only guards against someone loosening the type annotation to `Record<string,…>`.
    expect(Object.keys(EXPECTED).sort()).toEqual([
      "ambiguous-membership", "disabled", "no-membership", "no-request", "no-such-user",
      "unauthenticated", "unavailable",
    ]);
  });

  for (const [reason, kind] of Object.entries(EXPECTED) as [PageDenial, AuthorityFailure][]) {
    it(`${reason} → ${kind}`, async () => {
      const err = await thrownFor(reason);
      expect(err, `${reason} did not produce an authority failure at all`).toBeInstanceOf(NoAuthority);
      // BOTH directions on every row. Asserting only `toBeInstanceOf(AccountRefused)` for the
      // refused half would pass on a resolver that classified EVERYTHING as refused.
      expect(err instanceof AccountRefused, `${reason} classified as the wrong half`)
        .toBe(kind === "refused");
      expect((err as NoAuthority).reason, `${reason} lost its reason on the way out`).toBe(reason);
    });
  }
});

describe("§29.3 Ruling 3 · the properties the subclass exists for", () => {
  it("AccountRefused IS a NoAuthority — the nine existing call sites keep their exact meaning", () => {
    // dal-boundary, portal-token-boundary and page-denial assert `rejects.toThrow(NoAuthority)` over
    // calls that reach BOTH arms. A sibling class would have silently narrowed four of them from
    // "obtains nothing without authority" to "obtains nothing for the reasons I enumerated".
    const refused = new AccountRefused("disabled");
    expect(refused).toBeInstanceOf(NoAuthority);
    expect(refused).toBeInstanceOf(Error);
    expect(new NoAuthority("unavailable")).not.toBeInstanceOf(AccountRefused);
  });

  it("no-resolver is UNANSWERED — it is thrown before any resolver is asked", async () => {
    // Not routed through `failureKind` at all: `requireCapability` throws it when the slot is empty,
    // so there is no answer to classify. It must stay on the rethrown side, or a page rendered
    // before the runtime bound its resolver would tell the visitor their account is inactive.
    clearAuthorityResolver();
    let err: unknown;
    try {
      await requireCapability("finance:*");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NoAuthority);
    expect(err).not.toBeInstanceOf(AccountRefused);
    expect((err as NoAuthority).reason).toBe("no-resolver");
  });
});
