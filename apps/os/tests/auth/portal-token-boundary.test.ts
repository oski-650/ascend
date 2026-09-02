// Layer A — THE CLIENT-TOKEN BOUNDARY (2G.1, ruling D).
//
// The defect: `app/portal/[token]` — a PUBLIC, client-facing page — called `listClients()` to turn
// its invite's slug into a display name. Once `listClients()` was correctly guarded with `clients:*`
// in slice 2b, every real portal visitor would have been refused access to their own portal. Same
// class as `findInviteByToken` internally calling the guarded `listInvites()`, one level out.
//
// The fix is NOT to grant the portal an operator capability, and NOT to weaken `listClients()`.
// An authorized operator snapshots the display name when ISSUING the invite, so the portal reads
// only the record its own token identifies.
//
// The invariant is stronger than "the portal lacks clients:*":
//
//   > A client-token caller cannot cause another client's data to enter its data-access boundary.
//
// Here that holds STRUCTURALLY rather than by check: the token selects one record, and there is no
// query to widen.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// `CapabilityDenied` left this file at 2G.4.7: no operator role is denied `portal:admin` or
// `clients:*` any more, so there is no role-based refusal here to catch. `NoAuthority` remains —
// the portal's own caller is unidentified, which is this suite's subject.
import { NoAuthority } from "@/core/auth/authority";
import { capabilitiesForRole } from "@/core/auth/capabilities";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";

let vaultDir: string;
let savedVault: string | undefined;

const CRM = "01 - CRM & Clients";
const client = async (slug: string, name: string) => {
  const dir = path.join(vaultDir, CRM, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "business_context.md"), `---\nname: ${name}\n---\n\nContext.\n`);
};

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-portal-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
  await client("acme-co", "Acme Co");
  await client("northwind", "Northwind Trading");
});

afterAll(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVault;
});

afterEach(() => unbindTestAuthority());

/** Issue an invite as the owner — the only party who may. */
async function issue(slug: string) {
  bindTestAuthority("owner");
  const { createInvite } = await import("@/lib/portal");
  const inv = await createInvite(slug);
  unbindTestAuthority();
  return inv;
}

describe("the operator snapshots the name at issuance", () => {
  it("createInvite records the client's display name", async () => {
    const inv = await issue("acme-co");
    expect(inv.client_slug).toBe("acme-co");
    expect(inv.client_name).toBe("Acme Co");
  });

  it("issuing still requires portal:admin — and NO operator role is denied it since 2G.4.7", async () => {
    // ─── THIS ASSERTED A SALES DENIAL, AND NO LONGER CAN ────────────────────────────────────
    //
    // It read: bind `sales`, expect `CapabilityDenied`. The partner now holds `portal:admin` —
    // granted deliberately, because it is the operator half of the CLIENT portal (issuing client
    // invite tokens, reading approval requests) and not system administration, despite its name.
    //
    // So no operator role is denied it, and the honest thing is to say so rather than pick a
    // different capability and let the row look like the boundary is still role-discriminating here.
    // **The boundary itself is unchanged and still proven**, twice: by the unidentified-caller row
    // below, which is the caller this suite is actually about, and by `dal-boundary`'s GUARDED list,
    // which asserts every storage boundary refuses a caller with no authority.
    const both = ["owner", "sales"] as const;
    for (const role of both) {
      expect(capabilitiesForRole(role), `${role} lost portal:admin`).toContain("portal:admin");
    }
    // And it stayed a BUSINESS capability rather than being folded into the admin boundary — which
    // is the decision 2G.4.7 made explicitly, so it is asserted rather than remembered.
    expect(capabilitiesForRole("sales"), "portal:admin was quietly reclassified as administrative")
      .not.toContain("admin:*");
  });

  it("and an unidentified caller cannot mint one at all", async () => {
    unbindTestAuthority();
    const { createInvite } = await import("@/lib/portal");
    await expect(createInvite("acme-co")).rejects.toThrow(NoAuthority);
  });
});

describe("PROOF · the portal obtains its name with NO operator capability", () => {
  it("a valid token resolves its own invite, carrying the name, with no authority bound", async () => {
    const inv = await issue("acme-co");
    unbindTestAuthority();                       // ← no operator session, as a real visitor has none
    const { findInviteByToken } = await import("@/lib/portal");
    const found = await findInviteByToken(inv.token);
    expect(found?.client_slug).toBe("acme-co");
    expect(found?.client_name ?? found?.client_slug).toBe("Acme Co");
  });

  it("PROOF · token A cannot obtain client B", async () => {
    const a = await issue("acme-co");
    const b = await issue("northwind");
    unbindTestAuthority();
    const { findInviteByToken } = await import("@/lib/portal");
    const viaA = await findInviteByToken(a.token);
    // The token selects ONE record. There is no parameter here through which another client could
    // be named, which is why the property is structural rather than checked.
    expect(viaA?.client_slug).toBe("acme-co");
    expect(viaA?.client_name).toBe("Acme Co");
    expect(JSON.stringify(viaA)).not.toContain("Northwind");
    expect(viaA?.token).not.toBe(b.token);
  });

  it("PROOF · an absent, unknown or revoked token is refused", async () => {
    const inv = await issue("acme-co");
    bindTestAuthority("owner");
    const { revokeInvite } = await import("@/lib/portal");
    await revokeInvite(String(inv.id));
    unbindTestAuthority();

    const { findInviteByToken } = await import("@/lib/portal");
    expect(await findInviteByToken(inv.token), "a revoked token still resolved").toBeNull();
    expect(await findInviteByToken("not-a-real-token")).toBeNull();
    expect(await findInviteByToken("")).toBeNull();
  });

  it("PROOF · listClients() remains clients:* and refuses the portal's caller", async () => {
    // THE PORTAL'S CALLER IS UNIDENTIFIED — a client holding a token and no operator session — so
    // this arm is the one that speaks to this suite's subject, and it is unchanged.
    unbindTestAuthority();
    const { listClients } = await import("@/core/crm/client");
    await expect(listClients()).rejects.toThrow(NoAuthority);
    // The second arm asserted a SALES `CapabilityDenied` until 2G.4.7. The partner now holds
    // `clients:*` — that is the whole point of the change — so a role-based denial is no longer
    // expressible here. Role-based denial is still measured, on the one capability that still
    // differs, in `dal-boundary`'s OWNER_ONLY block.
    bindTestAuthority("sales");
    await expect(listClients(), "the partner was denied the clients he was granted").resolves.toBeDefined();
  });

  it("LEGACY · an invite issued before the snapshot still works, falling back to the slug", async () => {
    // Written straight to the log, exactly as an older release would have left it: no client_name.
    const legacy = {
      id: "legacy-1", client_slug: "northwind", token: "legacy-token",
      created_at: new Date().toISOString(), revoked_at: null,
    };
    await fs.appendFile(
      path.join(vaultDir, ".ascend-os", "portal_invites.jsonl"), JSON.stringify(legacy) + "\n");

    unbindTestAuthority();
    const { findInviteByToken } = await import("@/lib/portal");
    const found = await findInviteByToken("legacy-token");
    expect(found?.client_name).toBeUndefined();
    // What the page renders: the slug, which is what it always showed when no name was available.
    expect(found?.client_name ?? found?.client_slug).toBe("northwind");
  });
});

describe("the page itself queries no client store", () => {
  it("app/portal/[token] no longer references listClients", async () => {
    const src = await fs.readFile("app/portal/[token]/page.tsx", "utf8");
    expect(src).not.toMatch(/listClients/);
    expect(src).toMatch(/invite\.client_name \?\? invite\.client_slug/);
  });
});
