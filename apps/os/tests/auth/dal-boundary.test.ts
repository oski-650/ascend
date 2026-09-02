// Layer A — THE DATA-ACCESS BOUNDARY (2G.1 slice 2).
//
// The property, stated once:
//
//   > A page does not become secure because the page remembered to authorize. It becomes secure
//   > because the data it can request has an authorization boundary.
//
// So these tests do not go through a page or a route. They call the data functions DIRECTLY — which
// is exactly what a future consumer, a background job, or a component nobody has written yet would
// do. If the boundary only held for the callers we happened to enumerate, it would not be a
// boundary.
//
// Three classes, and the tests below assert all three, because getting class 2 or 3 wrong is as much
// a defect as getting class 1 wrong:
//
//   1  storage        → guarded, one capability per boundary
//   2  pure derivation→ MUST NOT be guarded (F2). Sensitivity is not authority.
//   3  client-token   → MUST NOT be guarded, or the client portal breaks silently

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CapabilityDenied, NoAuthority } from "@/core/auth/authority";
import { capabilitiesForRole } from "@/core/auth/capabilities";
import {
  bindTestAuthority, unbindTestAuthority,
} from "@/tests/support/operator-session";

type Call = { what: string; run: () => Promise<unknown> };

/**
 * Every guarded storage boundary, with the capability it demands. One row per storage module.
 *
 * RENAMED at 2G.4.7, and the rename is the finding. This was `OWNER_ONLY`, which was true of the
 * narrow sales role and is no longer: the partner became `owner` minus `admin:*`, so he now passes
 * every boundary below. **The boundaries did not weaken — the ROLE moved across them**, and a list
 * whose name asserts who fails it would have made that indistinguishable from a boundary going away.
 *
 * What these rows still prove, unchanged: each one refuses a caller with NO authority, and each one
 * refuses by THROWING rather than by returning empty.
 */
const GUARDED: { capability: string; calls: Call[] }[] = [
  { capability: "finance:*", calls: [
    { what: "listInvoices", run: async () => (await import("@/core/finance")).listInvoices() },
    { what: "listCareClients", run: async () => (await import("@/core/finance")).listCareClients() },
    { what: "getClientRevenue", run: async () => (await import("@/core/finance")).getClientRevenue("x") },
  ]},
  { capability: "clients:*", calls: [
    { what: "listClients", run: async () => (await import("@/core/crm/client")).listClients() },
    { what: "getClient", run: async () => (await import("@/core/crm/client")).getClient("x") },
  ]},
  { capability: "documents:*", calls: [
    { what: "listDocuments", run: async () => (await import("@/lib/documents")).listDocuments() },
    { what: "getDocument", run: async () => (await import("@/lib/documents")).getDocument("x") },
  ]},
  { capability: "audits:*", calls: [
    { what: "listAudits", run: async () => (await import("@/lib/audits")).listAudits() },
  ]},
  { capability: "time:*", calls: [
    { what: "getActiveEntry", run: async () => (await import("@/core/production")).getActiveEntry() },
    { what: "summarizeByClient", run: async () => (await import("@/core/production")).summarizeByClient() },
  ]},
  { capability: "production:read", calls: [
    { what: "listProductionStates", run: async () => (await import("@/core/production")).listProductionStates() },
  ]},
  { capability: "portal:admin", calls: [
    { what: "listInvites", run: async () => (await import("@/lib/portal")).listInvites() },
    { what: "listApprovalRequests", run: async () => (await import("@/lib/portal")).listApprovalRequests() },
  ]},
];

/**
 * The `admin:*` boundaries — the ONLY ones a sales principal is still refused (2G.4.7).
 *
 * This is what `OWNER_ONLY` now means, and it is one capability wide. If a future capability is
 * withheld from sales, its boundary belongs here and the `WRONG AUTHORITY` block below will demand
 * a reason for it.
 */
const OWNER_ONLY: { capability: string; calls: Call[] }[] = [
  { capability: "admin:*", calls: [
    { what: "listOrganizationMembers", run: async () => (await import("@/core/auth/directory")).listOrganizationMembers() },
    { what: "listAdminTools", run: async () => (await import("@/core/admin/tools")).listAdminTools() },
    { what: "listWipeTargets", run: async () => (await import("@/core/admin/tools")).listWipeTargets() },
  ]},
];

/** Sales legitimately holds these. Same boundary, different answer. */
const SALES_PERMITTED: Call[] = [
  { what: "loadRules", run: async () => (await import("@/lib/automations")).loadRules() },
  { what: "getFiredEntries", run: async () => (await import("@/lib/automations")).getFiredEntries() },
  // 2G.4.7: every guarded STORAGE boundary is now sales-permitted too. Spread rather than retyped,
  // so the two lists cannot drift — a boundary added to GUARDED is automatically asserted passable
  // by sales, and if it should not be, it belongs in OWNER_ONLY and this fails.
  ...GUARDED.flatMap((g) => g.calls),
];

// An EMPTY vault, deliberately. These tests are about who may obtain data, not about what the data
// says — and an empty vault makes the distinction sharp: an authorized caller gets `[]`, an
// unauthorized one gets an exception. If refusal were expressed as an empty result, the two would be
// indistinguishable, which is the authorization-by-absence F49 forbids.
let vaultDir: string;
let savedVault: string | undefined;

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-dal-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterAll(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
});

afterEach(() => unbindTestAuthority());

describe("NO AUTHORITY · a caller who established none obtains nothing", () => {
  for (const { capability, calls } of [...GUARDED, ...OWNER_ONLY]) {
    for (const call of calls) {
      it(`${call.what} (${capability}) refuses`, async () => {
        unbindTestAuthority();
        await expect(call.run(), `${call.what} returned data to nobody`).rejects.toThrow(NoAuthority);
      });
    }
  }

  it("even the sales-permitted boundaries refuse an unidentified caller", async () => {
    unbindTestAuthority();
    for (const call of SALES_PERMITTED) {
      await expect(call.run(), call.what).rejects.toThrow(NoAuthority);
    }
  });

  it("REFUSAL IS NOT AN EMPTY RESULT — it throws, so absence cannot be mistaken for authorization", async () => {
    unbindTestAuthority();
    // The F49 lesson on a new surface: a function that returned [] here would look identical to a
    // vault with no invoices, and the difference is the entire security property.
    const { listInvoices } = await import("@/core/finance");
    await expect(listInvoices()).rejects.toThrow(NoAuthority);
  });
});

describe("WRONG AUTHORITY · sales is identified, and still refused administrative data", () => {
  // NARROWED at 2G.4.7 from seven capabilities to one. The seven did not stop being boundaries —
  // they are asserted below, in CORRECT AUTHORITY, as boundaries sales now PASSES. What changed is
  // which side of them the partner stands on.
  for (const { capability, calls } of OWNER_ONLY) {
    it(`sales cannot obtain ${capability}`, async () => {
      bindTestAuthority("sales");
      for (const call of calls) {
        await expect(call.run(), `sales obtained ${call.what}`).rejects.toThrow(CapabilityDenied);
      }
    });
  }

  it("the denial names the capability for the LOG, and the caller learns only that it failed", async () => {
    bindTestAuthority("sales");
    const { listOrganizationMembers } = await import("@/core/auth/directory");
    await expect(listOrganizationMembers()).rejects.toMatchObject({ capability: "admin:*", role: "sales" });
  });

  it("THE BOUNDARY IS ONE CAPABILITY WIDE, and that is asserted rather than described", () => {
    // Derived from the capability table, so it cannot drift from `ROLE_CAPABILITIES`. If a second
    // capability is ever withheld from sales, this fails and names it — which is the point: a
    // widening this broad should make any FUTURE narrowing loud.
    const owner = new Set(capabilitiesForRole("owner"));
    const sales = new Set(capabilitiesForRole("sales"));
    expect([...owner].filter((c) => !sales.has(c))).toEqual(["admin:*"]);
    expect([...sales].filter((c) => !owner.has(c)), "sales holds something the owner does not").toEqual([]);
  });
});

describe("CORRECT AUTHORITY · the boundary narrows access, it does not replace behaviour", () => {
  /**
   * Assert that a call is not refused FOR AN AUTHORIZATION REASON.
   *
   * Written as an explicit try/catch rather than `.resolves.not.toThrow`, which is a property
   * access and asserts nothing — the first version of this file used it and the block proved
   * exactly nothing while appearing green. No vault fixture is mounted here, so a read may
   * legitimately fail for an I/O reason; what it must never do is fail for a permission one.
   */
  const notRefused = async (call: Call) => {
    try {
      await call.run();
    } catch (e) {
      expect(e, `${call.what} was refused authorization`).not.toBeInstanceOf(NoAuthority);
      expect(e, `${call.what} was refused authorization`).not.toBeInstanceOf(CapabilityDenied);
    }
  };

  it("an owner passes every guarded boundary", async () => {
    bindTestAuthority("owner");
    for (const { calls } of [...GUARDED, ...OWNER_ONLY]) for (const call of calls) await notRefused(call);
  });

  it("sales passes the boundaries sales holds", async () => {
    bindTestAuthority("sales");
    for (const call of SALES_PERMITTED) await notRefused(call);
  });

  it("THE CONTROL: the same helper CATCHES a refusal, so the two tests above are not vacuous", async () => {
    unbindTestAuthority();
    // If `notRefused` could not detect a refusal, neither assertion above would mean anything.
    await expect(notRefused(GUARDED[0].calls[0])).rejects.toThrow(/refused authorization/);
  });
});

describe("CLASS 2 · pure derivation is NOT guarded — sensitivity is not authority", () => {
  it("forecast and opportunity derivation run with NO authority at all", async () => {
    unbindTestAuthority();
    // `lib/forecast` handles the most sensitive numbers in the system and obtains nothing. Guarding
    // it would put identity into a module whose architectural purpose (F2) is not knowing about I/O.
    const forecast = await import("@/lib/forecast");
    expect(typeof forecast).toBe("object");
    const opportunities = await import("@/lib/opportunities");
    expect(typeof opportunities).toBe("object");
  });

  it("the pure helpers on a GUARDED module stay pure", async () => {
    unbindTestAuthority();
    const { statusLabel } = await import("@/core/finance");
    const { formatDuration } = await import("@/core/production");
    // Formatting a value somebody already obtained is not obtaining it.
    expect(typeof statusLabel("paid")).toBe("string");
    expect(typeof formatDuration(90)).toBe("string");
  });
});

describe("CLASS 3 · the client portal keeps its own token authority", () => {
  it("client-token paths do NOT require an operator capability", async () => {
    unbindTestAuthority();
    // `app/portal/[token]` is public in middleware.ts and its visitors hold no operator session.
    // Guarding these would break the client portal — silently, since nothing else covers them.
    const { findInviteByToken, getApprovalRequest } = await import("@/lib/portal");
    await expect(findInviteByToken("no-such-token")).resolves.toBeNull();
    await expect(getApprovalRequest("no-such-id")).resolves.toBeNull();
  });

  it("but the OPERATOR half of the same module is guarded", async () => {
    unbindTestAuthority();
    const { listInvites, createInvite } = await import("@/lib/portal");
    await expect(listInvites()).rejects.toThrow(NoAuthority);
    await expect(createInvite("acme")).rejects.toThrow(NoAuthority);
  });
});
