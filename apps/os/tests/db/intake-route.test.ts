// Layer A — 2F · THE REAL ROUTE, END TO END (§7.3(c), §1.2, §1.3).
//
// The route is invoked the way Next invokes it — a real Request, a real signed cookie, the real
// exported handler — against a REAL Postgres with the deployed prospect source selected. The
// property under test is that the WIRING is the intended one: the guard, the intake, the canonical
// writer and the event spine, with no business logic of the route's own.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addMembership, createOrganization, createUser, listProspects, asPrincipal } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { clearAuthorityResolver } from "@/core/auth/authority";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { SESSION_SECRET, bootDatabase, tokenFor } from "@/tests/support/provisioned-partner";
import type { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "@/core/db";
import { SESSION_COOKIE } from "@/lib/auth";
import type { OrganizationId, UserId } from "@/domain";

let pg: PGlite;
let db: SqlClient;
let org: OrganizationId;
let owner: UserId;
let token: string;
let savedSecret: string | undefined;
let savedSource: string | undefined;

const post = async (payload: unknown) => {
  const mod = await import("@/app/api/import/prospects/route");
  return mod.POST(new Request("https://os.test/api/import/prospects", {
    method: "POST",
    headers: { "content-type": "application/json",
               cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    body: JSON.stringify(payload),
  }));
};
const as = <T>(fn: (tx: Parameters<typeof listProspects>[0]) => Promise<T>) =>
  asPrincipal(db, __unsafePrincipalForTests("owner", org, owner), fn);

beforeAll(() => {
  savedSecret = process.env.ASCEND_OS_SESSION_SECRET;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  process.env.ASCEND_OS_SESSION_SECRET = SESSION_SECRET;
  // THE DEPLOYED STORE. Unset would mean `vault`, and this suite would silently prove the route
  // against a store production does not run — the reason F51 and page-denial both set it too.
  process.env.ASCEND_PROSPECT_SOURCE = "postgres";
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.ASCEND_OS_SESSION_SECRET;
  else process.env.ASCEND_OS_SESSION_SECRET = savedSecret;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE;
  else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

beforeEach(async () => {
  // THE FULL MIGRATION SET (001-007). `tests/db/pglite`'s harness omits 005/006, so `ascend_auth`
  // does not exist there and `resolvePrincipal` — which the route's guard reaches through
  // withRequestContext — cannot assume its role. A route test needs the schema the route runs on.
  ({ pg, db } = await bootDatabase());
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
  token = await tokenFor(owner);
  registerAppDb((fn) => fn(db));
  bindAuthorityResolver();
});
afterEach(async () => { clearAppDb(); clearAuthorityResolver(); await pg.close(); });

describe("the real route wires the intended pieces", () => {
  it("a real POST creates the prospect AND its evidence, in one call", async () => {
    const res = await post({ csv: 'Business,Site\n  Acme  ,https://acme.example\n',
                             column_map: { name: "Business", website: "Site" }, label: "Print Shop List" });
    expect(res.status).toBe(200);
    const body = await res.json() as { batch_id: string; file_sha256: string; outcomes: unknown[] };
    expect(body.batch_id, "the route did not mint a batch").toBeTruthy();
    expect(body.file_sha256).toMatch(/^[0-9a-f]{64}$/);

    // ASCEND FOUND — through the canonical writer, trimmed for the projection.
    const rows = await as((tx) => listProspects(tx));
    expect(rows).toHaveLength(1);
    expect(rows[0].name, "the projection did not normalise the padded name").toBe("Acme");

    // THE SHEET SAID — verbatim, correlated to the batch the route returned.
    const evidence = await as((tx) =>
      readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] }));
    expect(evidence).toHaveLength(2);
    expect(evidence.every((e) => e.correlation_id === body.batch_id),
      "the route's evidence is not correlated to the batch it reported").toBe(true);
    const cells = (evidence[1].data as { cells: Record<string, string> }).cells;
    expect(cells.Business, "the route lost the sheet's original bytes").toBe("  Acme  ");
  });

  it("DRY RUN mutates NOTHING — no prospect and no evidence", async () => {
    const res = await post({ csv: 'Business\nAcme\n', column_map: { name: "Business" }, dry_run: true });
    expect(res.status).toBe(200);
    expect(await as((tx) => listProspects(tx))).toHaveLength(0);
    // The half a preview could quietly break: appending evidence would change the thing previewed.
    const evidence = await as((tx) =>
      readEvents(tx, { types: ["prospect.batch_imported", "prospect.row_received"] }));
    expect(evidence, "a dry run recorded evidence").toHaveLength(0);
  });

  it("the guard still refuses an unauthenticated caller", async () => {
    const mod = await import("@/app/api/import/prospects/route");
    const res = await mod.POST(new Request("https://os.test/api/import/prospects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv: "Business\nAcme\n", column_map: { name: "Business" } }),
    }));
    expect(res.status, "the route served a caller with no session").toBe(401);
    expect(await as((tx) => listProspects(tx))).toHaveLength(0);
  });

  it("§2.1 reaches the route — a duplicate is refused there too", async () => {
    const payload = { csv: 'Business,Site\nAcme,https://acme.example\n',
                      column_map: { name: "Business", website: "Site" } };
    await post(payload);
    const res = await post(payload);
    const body = await res.json() as { outcomes: { kind: string; reason?: string }[] };
    expect(body.outcomes[0].kind).toBe("recorded");
    expect(body.outcomes[0].reason, "the route bypassed identity resolution").toBe("matched");
    expect(await as((tx) => listProspects(tx)), "the route created a duplicate").toHaveLength(1);
  });
});
