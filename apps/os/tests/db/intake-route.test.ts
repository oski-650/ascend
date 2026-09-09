// Layer A — 2F · THE REAL ROUTE, END TO END (§7.3(c), §1.2, §1.3).
//
// The route is invoked the way Next invokes it — a real Request, a real signed cookie, the real
// exported handler — against a REAL Postgres with the deployed prospect source selected. The
// property under test is that the WIRING is the intended one: the guard, the intake, the canonical
// writer and the event spine, with no business logic of the route's own.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addMembership, createOrganization, createUser } from "@/core/db";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { bindAuthorityResolver } from "@/lib/authority";
import { clearAuthorityResolver } from "@/core/auth/authority";
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
// ─── READ BACK WITH RAW SQL, NOT THROUGH A FABRICATED PRINCIPAL ─────────────────────────────────
//
// F59 forbids `__unsafePrincipalForTests` in any file that imports the provisioned-partner support
// module, and this one does — it needs `bootDatabase` and `tokenFor`. That constraint is a good one
// here rather than an obstacle: this suite's subject is WHAT THE ROUTE DID, and reading the result
// as the connecting role measures the database's state directly instead of re-entering the
// authority machinery the route already exercised.
const prospects = async () =>
  (await db.query<{ name: string; status: string | null }>(
    `SELECT name, status FROM prospects ORDER BY name`)).rows;
const intakeEvents = async () =>
  (await db.query<{ type: string; correlation_id: string; data: Record<string, unknown> }>(
    `SELECT type, correlation_id, data FROM events
      WHERE type IN ('prospect.batch_imported','prospect.row_received') ORDER BY seq`)).rows;

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
    const rows = await prospects();
    expect(rows).toHaveLength(1);
    expect(rows[0].name, "the projection did not normalise the padded name").toBe("Acme");

    // THE SHEET SAID — verbatim, correlated to the batch the route returned.
    const evidence = await intakeEvents();
    expect(evidence).toHaveLength(2);
    expect(evidence.every((e) => e.correlation_id === body.batch_id),
      "the route's evidence is not correlated to the batch it reported").toBe(true);
    const cells = (evidence[1].data as { cells: Record<string, string> }).cells;
    expect(cells.Business, "the route lost the sheet's original bytes").toBe("  Acme  ");
  });

  it("DRY RUN mutates NOTHING — no prospect and no evidence", async () => {
    const res = await post({ csv: 'Business\nAcme\n', column_map: { name: "Business" }, dry_run: true });
    expect(res.status).toBe(200);
    expect(await prospects()).toHaveLength(0);
    // The half a preview could quietly break: appending evidence would change the thing previewed.
    expect(await intakeEvents(), "a dry run recorded evidence").toHaveLength(0);
  });

  it("the guard still refuses an unauthenticated caller", async () => {
    const mod = await import("@/app/api/import/prospects/route");
    const res = await mod.POST(new Request("https://os.test/api/import/prospects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv: "Business\nAcme\n", column_map: { name: "Business" } }),
    }));
    expect(res.status, "the route served a caller with no session").toBe(401);
    expect(await prospects()).toHaveLength(0);
  });

  // ─── THE AUTOMATIC PATH (2026-09-04) ─────────────────────────────────────────────────────────
  //
  // The regression these three cover, stated once: a TAB-separated 3,000-row lead list was pasted
  // in, both parsers split on "," only, every line became one column, and 3,193 prospects were
  // created carrying the whole line in every mapped field — reported as a success throughout.
  // `column_map` is now optional and inferred from the headers THIS route's parser found.

  it("a tab-separated sheet with NO column_map imports correctly", async () => {
    const res = await post({ csv: "Company\tIndustry\tWebsite\nAcme Roofing\tRoofing\thttps://acme.example\n" });
    expect(res.status).toBe(200);
    const body = await res.json() as
      { delimiter: string; column_map: Record<string, string>; unmapped: string[] };

    expect(body.delimiter, "the route read the sheet as comma-separated").toBe("\t");
    expect(body.column_map).toEqual({ name: "Company", business_type: "Industry", website: "Website" });

    const rows = await prospects();
    expect(rows).toHaveLength(1);
    // THE DISCRIMINATING ASSERTION. Under the old parser this name was the entire line —
    // "Acme Roofing\tRoofing\thttps://acme.example" — and so was every other mapped field.
    expect(rows[0].name, "the row collapsed into a single column again").toBe("Acme Roofing");

    // The evidence split the same sheet into the same columns. Compared as a SET: jsonb does not
    // preserve key order, so asserting the order would be testing Postgres, not the parsers.
    const cells = (await intakeEvents())[1].data as { cells: Record<string, string> };
    expect(Object.keys(cells.cells).sort(),
      "the evidence disagreed with the projection about the columns")
      .toEqual(["Company", "Industry", "Website"]);
    expect(cells.cells.Company, "the evidence collapsed the row into one column").toBe("Acme Roofing");
  });

  it("REFUSES a sheet with no recognisable business-name column", async () => {
    // The old surface defaulted to headers[0], which is how a numeric record id became the name of
    // every prospect in the batch. Refusing is the only honest answer.
    const res = await post({ csv: "3624150\tref\txyz\n1\t2\t3\n" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; headers: string[] };
    expect(body.error).toMatch(/no business-name column/);
    // The refusal still reports what was read, so the operator can fix the file.
    expect(body.headers).toEqual(["3624150", "ref", "xyz"]);
    expect(await prospects(), "a refused import wrote a prospect").toHaveLength(0);
    expect(await intakeEvents(), "a refused import wrote evidence").toHaveLength(0);
  });

  it("an explicit column_map still overrides the inference", async () => {
    // The inference is a default, not a policy. `Industry` would be inferred as business_type;
    // naming it as the business name must win.
    const res = await post({ csv: "Company\tIndustry\nAcme Roofing\tRoofing\n",
                             column_map: { name: "Industry" } });
    expect(res.status).toBe(200);
    const rows = await prospects();
    expect(rows[0].name, "the inference overrode the caller's explicit map").toBe("Roofing");
  });

  it("§2.1 reaches the route — a duplicate is refused there too", async () => {
    const payload = { csv: 'Business,Site\nAcme,https://acme.example\n',
                      column_map: { name: "Business", website: "Site" } };
    await post(payload);
    const res = await post(payload);
    const body = await res.json() as { outcomes: { kind: string; reason?: string }[] };
    expect(body.outcomes[0].kind).toBe("recorded");
    expect(body.outcomes[0].reason, "the route bypassed identity resolution").toBe("matched");
    expect(await prospects(), "the route created a duplicate").toHaveLength(1);
  });
});
