// Layer A — EVENT-SPINE VISIBILITY (UI Part Zero §0.3; the F61 gap, closed).
//
// ─── WHY A SYNTHETIC PRINCIPAL, AND WHY THE OBVIOUS TEST WOULD PROVE NOTHING ───────────────────
//
// Since 2G.4.7 `owner \ sales === ["admin:*"]`, and `admin:*` governs NO event prefix. So a test
// that read the spine as owner, read it as sales and compared them would pass on a reader that had
// never filtered anything — the vacuity that stopped `index-scoping`'s E5 control and
// `dal-mutation-gate`'s crossover detector measuring in 2G.4.7, arriving a third time.
//
// The difference is therefore BUILT. `registerAuthorityResolver` is the production seam; what is
// narrowed is the ANSWER it gives, not the capability table. No role gains or loses anything, no
// grant moves, and the narrowing dies with the test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitEvent, readEvents, visibleTo } from "@/core/events";
import {
  NoAuthority, clearAuthorityResolver, registerAuthorityResolver,
} from "@/core/auth/authority";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import type { Capability } from "@/core/auth/capabilities";
import type { OrganizationId, ResolvedPrincipal, UserId } from "@/domain";

let vaultDir: string;
let savedVault: string | undefined;

const ORG = "11111111-1111-4111-8111-111111111111" as OrganizationId;
const USER = "0198f3a1-2b4c-7d8e-9f01-00000000aaaa" as UserId;

/**
 * THE SYNTHETIC NARROWING, and the only place one exists.
 *
 * `can()` is intercepted for the duration of a test — the same hoisted-mock technique F51's demand
 * recorder uses, and for the same reason: it observes the real seam rather than reimplementing it.
 * The capability TABLE is untouched, `ROLE_CAPABILITIES` is never edited, and the principal is a
 * real branded one, so nothing here fabricates authority. What is narrowed is the ANSWER, for one
 * test, and it dies with the test.
 */
const HELD = vi.hoisted(() => ({ set: null as Set<string> | null }));

vi.mock("@/core/auth/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/auth/capabilities")>();
  return {
    ...actual,
    // `null` means "not narrowed" — delegate to the real table, so any test that forgets to narrow
    // measures production behaviour rather than an empty capability set.
    can: (principal: ResolvedPrincipal, capability: Capability) =>
      HELD.set === null ? actual.can(principal, capability) : HELD.set.has(capability),
  };
});

function principalHolding(...held: Capability[]): ResolvedPrincipal {
  HELD.set = new Set<string>(held);
  return __unsafePrincipalForTests("owner", ORG, USER);
}

const asPrincipalWith = (principal: ResolvedPrincipal) =>
  registerAuthorityResolver(async () => ({ ok: true, principal }));

beforeEach(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-event-vis-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  HELD.set = null;
  clearAuthorityResolver();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
});

/** The corpus: one prospect event, one finance event, one unrelated. Written as the owner. */
async function seedCorpus() {
  asPrincipalWith(__unsafePrincipalForTests("owner", ORG, USER));
  await emitEvent({ type: "prospect.created", actor: "system",
    subject: { entity: "prospect", entity_id: "p-1" } });
  await emitEvent({ type: "invoice.paid", actor: "system",
    subject: { entity: "invoice", entity_id: "i-1" } });
  await emitEvent({ type: "document.created", actor: "system",
    subject: { entity: "document", entity_id: "d-1" } });
  clearAuthorityResolver();
}

const typesFor = async () => (await readEvents()).map((e) => e.type).sort();

describe("§0.3 · the spine returns only what the principal may see", () => {
  it("THE CORPUS IS REAL — the broader principal sees all three", async () => {
    // NON-VACUITY FIRST. Every assertion below is about something being ABSENT; if the corpus were
    // empty they would all pass while measuring nothing.
    await seedCorpus();
    asPrincipalWith(principalHolding("prospects:read", "finance:*", "documents:*"));
    expect(await typesFor()).toEqual(["document.created", "invoice.paid", "prospect.created"]);
  });

  it("the NARROWER principal sees the prospect event and NOT the finance event", async () => {
    await seedCorpus();
    asPrincipalWith(principalHolding("prospects:read"));
    const seen = await typesFor();
    expect(seen, "the narrower principal lost the event it IS entitled to").toContain("prospect.created");
    expect(seen, "an invoice event reached a principal without finance:*").not.toContain("invoice.paid");
    expect(seen, "a document event reached a principal without documents:*").not.toContain("document.created");
  });

  it("the narrower result is a PROPER SUBSET — smaller, and fully contained", async () => {
    await seedCorpus();
    asPrincipalWith(principalHolding("prospects:read", "finance:*", "documents:*"));
    const broad = await typesFor();
    asPrincipalWith(principalHolding("prospects:read"));
    const narrow = await typesFor();

    expect(narrow.length, "the two results are the same size — nothing was filtered")
      .toBeLessThan(broad.length);
    expect(narrow.every((t) => broad.includes(t)), "the narrow result contains something the broad one does not")
      .toBe(true);
    expect(narrow.length, "the narrow result is empty — it must see less, not nothing")
      .toBeGreaterThan(0);
  });
});

describe("the caller's requested filter is a REQUEST, never a claim of entitlement", () => {
  it("asking for the finance domain does not grant it", async () => {
    // The negative control the model turns on: visibility is decided by what the principal HOLDS,
    // never by what the call asked for. A reader that honoured the request would hand the whole
    // finance log to anyone who typed `domains: ["finance"]`.
    await seedCorpus();
    asPrincipalWith(principalHolding("prospects:read"));
    const asked = await readEvents({ domains: ["finance"] });
    expect(asked, "requesting a domain granted access to it").toEqual([]);
  });

  it("asking for a type by name does not grant it either", async () => {
    await seedCorpus();
    asPrincipalWith(principalHolding("prospects:read"));
    expect(await readEvents({ types: ["invoice.paid"] })).toEqual([]);
    // …and the same call for an entitled type still works, so the emptiness above is the filter
    // rather than a broken query.
    expect((await readEvents({ types: ["prospect.created"] })).map((e) => e.type))
      .toEqual(["prospect.created"]);
  });
});

describe("fail closed", () => {
  it("an unidentified caller obtains nothing at all", async () => {
    await seedCorpus();
    clearAuthorityResolver();
    await expect(readEvents(), "the spine served a caller with no principal").rejects.toThrow(NoAuthority);
  });
});

describe("the map itself", () => {
  it("an UNMAPPED prefix stays visible — notifications are deferred, not decided", async () => {
    // Assigning notifications a capability merely to complete the table would decide their
    // authorization contract in a lookup. An unmapped prefix keeps today's behaviour.
    const narrow = principalHolding("prospects:read");
    expect(visibleTo(narrow, "notification.raised"), "a deferred domain was silently restricted").toBe(true);
  });

  it("visibility is keyed on the TYPE prefix, not the log — one log carries two governed kinds", async () => {
    // The `crm` log holds prospect.* and client.*, governed differently. Filtering by log would
    // hand client history to a prospect-only caller.
    const narrow = principalHolding("prospects:read");
    expect(visibleTo(narrow, "prospect.created")).toBe(true);
    expect(visibleTo(narrow, "client.created"), "a client event rode in on the prospect capability").toBe(false);
  });
});
