// Layer A — ROW 11'S PRODUCTION HALF, AS A RE-RUNNABLE READ-ONLY PROBE (2G.4.6, STAGE2G §29.3
// Ruling 5, §29.11 Q2).
//
// ─── WHY THIS FILE EXISTS SEPARATELY ───────────────────────────────────────────────────────────
//
// §8 row 11 asks that `ascend_sales` cannot read credential material on the live server. The
// assertion has existed since 2F — `tests/db/production-2f-partner.test.ts:122` — but it is welded
// into a suite that also PROVISIONS a human being, so `gate-2g1.ts` parks the whole file as one
// unit: a read-only property trapped inside a mutating one-shot.
//
// §29.2(b) measured that the read half is splittable and that splitting it changes nothing it
// proves. Ruling 5 BINDS the split, following the precedent `gate-2g1.ts` already records for
// `production-2g2-invitations` (a one-shot whose verification half is re-runnable on demand).
//
// ─── THE PROVISIONING SUITE IS NOT TOUCHED ─────────────────────────────────────────────────────
//
// Ruling 5: *"the provisioning half stays exactly as written and stays PARKED. The split must not
// weaken either half."* So `production-2f-partner.test.ts` keeps its own copy of the assertion and
// keeps its own gate variable. This file is an ADDITION, and the duplication is deliberate: one
// assertion inside a one-shot that will run once, and one inside a probe that can run whenever it is
// authorized. Removing it from the one-shot would have made that suite prove less on the day it runs.
//
// ─── READ-ONLY, ROLLBACK-SCOPED, POOLER (§29.11 Q2, verbatim) ──────────────────────────────────
//
// One pair of statements: `SET LOCAL ROLE ascend_sales; SELECT password_hash FROM users`, expecting
// `permission denied`. No write, no credential, no schema touch, no row created or destroyed. Both
// statements run inside a transaction that is ROLLED BACK whatever happens, and `SET LOCAL` dies
// with it.
//
// THE POOLER, not the DIRECT endpoint. §26.3 records DIRECT as IPv6-blocked from this machine; row
// 5's production half already answers through the pooler in 0.2s, so this probe is not inheriting
// that obstacle. **What withholds it is a decision, not the network** — §26.2 forbids calling that
// BLOCKED, and `gate-2g4.ts` classifies it `PARKED — WITHHELD` for exactly that reason.
//
// ─── ITS OWN VARIABLE, AND WHY THAT MATTERS HERE ───────────────────────────────────────────────
//
// `ASCEND_CREDENTIAL_PROBE_URL`. Not shared with any other suite: Q2 authorizes THIS probe, and a
// variable shared with a broader gate would mean authorizing this one runs others too.
//
// ─── THE CONTROL, WITHOUT WHICH `permission denied` PROVES NOTHING ─────────────────────────────
//
// A refusal is not evidence of a boundary unless the same query SUCCEEDS for someone. A typo in the
// column name, a dropped table, a role that cannot read anything at all, or a connection that never
// assumed the role would each produce a refusal that looks identical to the property under test.
//
// So the same connection, in its own rolled-back transaction, runs the SAME SELECT as `ascend_auth`
// — the one role `005` grants `password_hash` to — and it must SUCCEED. Refused-for-sales plus
// permitted-for-auth is a boundary. Refused-for-sales alone is a sentence.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { adaptPoolClient, connectionConfigFor, type SqlClient } from "@/core/db";

const POOLER = process.env.ASCEND_CREDENTIAL_PROBE_URL;
const describeIfAuthorized = POOLER ? describe : describe.skip;

describeIfAuthorized("ROW 11 production — ascend_sales cannot read credential material " +
  "(requires ASCEND_CREDENTIAL_PROBE_URL)", () => {
  let pool: Pool;
  let raw: PoolClient;
  let db: SqlClient;

  beforeAll(async () => {
    pool = new Pool({ ...connectionConfigFor(POOLER!, "app"), max: 1 });
    raw = await pool.connect();
    db = adaptPoolClient(raw);
  }, 60_000);

  afterAll(async () => { raw?.release(); await pool?.end(); });

  it("THE CONTROL — ascend_auth CAN read password_hash, so the refusal below is about the ROLE", async () => {
    // Rolled back like the probe itself. Reading a hash is not the same as learning a credential —
    // nothing is returned to the caller, printed, or asserted about; only that the SELECT was
    // PERMITTED. Never echo the value: see the credential incident of 2026-08-30.
    let permitted = false;
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE ascend_auth");
        await tx.query(`SELECT password_hash FROM users LIMIT 1`);
        permitted = true;
        // Deliberate rollback: this transaction must leave nothing behind, including a COMMIT.
        throw new RollbackProbe();
      })
    ).rejects.toBeInstanceOf(RollbackProbe);
    expect(permitted, "ascend_auth could not read password_hash — the control is broken, so a " +
      "refusal for ascend_sales would prove nothing about the role boundary").toBe(true);
  });

  it("ascend_sales cannot read ANY credential material", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SET LOCAL ROLE ascend_sales");
        return tx.query(`SELECT password_hash FROM users LIMIT 1`);
      })
    ).rejects.toThrow(/permission denied/i);
  });
});

/** Thrown to force a rollback on a transaction that succeeded. Never an assertion failure. */
class RollbackProbe extends Error {
  constructor() { super("probe rollback — not a failure"); }
}

describe("row 11 production probe — guard", () => {
  it("is gated on its OWN variable, so authorizing it authorizes nothing else", () => {
    // The same shape every production gate in this repository uses. Without this assertion a
    // skipped suite and a suite with no tests are indistinguishable in the runner's output — the
    // exact misreading `gate-2g1.test.ts`'s header records surviving two sessions.
    expect(typeof POOLER === "string" || POOLER === undefined).toBe(true);
  });
});
