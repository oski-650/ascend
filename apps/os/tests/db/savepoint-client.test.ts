// The savepoint adapter, proven LOCALLY before anything built on it touches production.
//
// If this wrapper were wrong, a rollback-scoped production test could pass while having actually
// committed — the worst possible failure mode for a test whose entire safety argument is "nothing
// persists". So it is verified on its own, against a real Postgres, first.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SqlClient, SqlValue } from "@/core/db";
import { savepointClient } from "./savepoint-client";

let pg: PGlite;
let base: SqlClient;

const adapt = (i: PGlite): SqlClient => ({
  async query(sql, params) {
    const r = await i.query(sql, params ? [...(params as SqlValue[])] : undefined);
    return { rows: (r.rows ?? []) as never[], affected: r.affectedRows ?? 0 };
  },
  async exec(sql) { await i.exec(sql); },
  async transaction(fn) { await i.exec("BEGIN"); try { const o = await fn(base); await i.exec("COMMIT"); return o; }
                          catch (e) { await i.exec("ROLLBACK"); throw e; } },
});

beforeAll(async () => {
  pg = new PGlite();
  base = adapt(pg);
  await pg.exec("CREATE TABLE t (id int primary key)");
}, 60_000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec("TRUNCATE t"); });

const rows = async () => (await pg.query<{ id: number }>("SELECT id FROM t ORDER BY id")).rows.map((r) => r.id);

describe("savepointClient — the outer transaction stays in control", () => {
  it("committed inner work is visible, and the OUTER rollback still discards it", async () => {
    // The safety argument in one test: the inner 'transaction' succeeds, and nothing survives.
    await pg.exec("BEGIN");
    const sp = savepointClient(base);
    await sp.transaction(async (tx) => { await tx.query("INSERT INTO t VALUES (1)"); });
    expect(await rows(), "the released savepoint's work should be visible inside the outer tx").toEqual([1]);
    await pg.exec("ROLLBACK");
    expect(await rows(), "OUTER ROLLBACK DID NOT DISCARD THE WORK").toEqual([]);
  });

  it("a throwing inner transaction discards only its own work, and the outer survives", async () => {
    await pg.exec("BEGIN");
    const sp = savepointClient(base);
    await sp.transaction(async (tx) => { await tx.query("INSERT INTO t VALUES (1)"); });
    await expect(sp.transaction(async (tx) => {
      await tx.query("INSERT INTO t VALUES (2)");
      throw new Error("boom");
    })).rejects.toThrow("boom");
    // 2 is gone; 1 remains; the outer transaction is still usable rather than aborted.
    expect(await rows()).toEqual([1]);
    await sp.transaction(async (tx) => { await tx.query("INSERT INTO t VALUES (3)"); });
    expect(await rows()).toEqual([1, 3]);
    await pg.exec("ROLLBACK");
    expect(await rows()).toEqual([]);
  });

  it("nests — an inner transaction inside an inner transaction", async () => {
    // `asPrincipal` opens one and the code it wraps may open another, so nesting is not hypothetical.
    await pg.exec("BEGIN");
    const sp = savepointClient(base);
    await sp.transaction(async (tx) => {
      await tx.query("INSERT INTO t VALUES (1)");
      await tx.transaction(async (inner) => { await inner.query("INSERT INTO t VALUES (2)"); });
      await expect(tx.transaction(async (inner) => {
        await inner.query("INSERT INTO t VALUES (3)");
        throw new Error("inner boom");
      })).rejects.toThrow("inner boom");
    });
    expect(await rows(), "the failed innermost savepoint took its siblings with it").toEqual([1, 2]);
    await pg.exec("ROLLBACK");
    expect(await rows()).toEqual([]);
  });

  it("CONTROL · the adapter cannot commit — it issues no COMMIT of its own", () => {
    // The safety argument stated structurally as well as behaviourally: if this file ever gains a
    // COMMIT, a "rollback-scoped" production test stops being rollback-scoped.
    const src = readFileSync(new URL("./savepoint-client.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bCOMMIT\b/);
    expect(src).not.toMatch(/\bBEGIN\b/);
    expect(src).toMatch(/SAVEPOINT/);
  });
});
