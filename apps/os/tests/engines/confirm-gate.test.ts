// Layer A — the CONFIRM GATE, proven against a real vault.
//
// This file closes the gap that tests/engines/command-runtime.test.ts declared and skipped:
//
//   describe.skip("command-runtime · confirm-gate dispatch [GAP — needs vault-backed integration
//                 test]")
//
// The gate (unconfirmed ⇒ preview · confirmed ⇒ execute) is the single most important safety
// property in the product, and it could not be observed without a vault because BOTH handlers begin
// by reading invoices — so with no vault both fail identically.
//
// ─── WHY THIS NEEDS NO PRODUCTION SEAM (D4 holds) ───────────────────────────────────────────────
// `core/vault/paths.vaultPath()` reads `process.env.ASCEND_VAULT_PATH` AT CALL TIME, not at module
// load. Pointing the env var at a temp directory therefore exercises the real path resolver, the
// real reader, the real writer and the real event emitter. Nothing is mocked, injected, or
// re-exported for testing: `runCommand` is called exactly as app/console/actions.ts calls it.
//
// ─── LIVE VAULT SAFETY ──────────────────────────────────────────────────────────────────────────
// Each test builds a fresh vault under os.tmpdir(), sets the env var in `beforeEach`, and restores
// the caller's original value in `afterEach`. The fixture is removed afterwards. At no point does a
// path here resolve inside the operator's real vault.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "@/core/command-runtime";

// The confirm gate drives finance mutation commands, which touch owner-only storage and therefore
// require a capability since 2G.1 slice 2. The gate under test is confirmation, not authority.
beforeEach(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

const INVOICE_ID = "inv-fixture-0001";

/** The record the fixture ledger starts from: a real, unpaid invoice. */
const UNPAID_INVOICE = {
  id: INVOICE_ID,
  client: "fixture-client",
  amount_usd: 2497,
  label: "Website build · fixture",
  issued_at: "2026-01-05T00:00:00.000Z",
  due_at: "2026-02-05T00:00:00.000Z",
  paid_at: null as string | null,
  note: "",
};

let vaultDir: string;
let savedVaultPath: string | undefined;

/** Absolute paths inside the fixture, mirroring core/vault/paths' own layout. */
const sidecar = () => path.join(vaultDir, ".ascend-os");
const invoicesFile = () => path.join(sidecar(), "invoices.jsonl");
const financeEvents = () => path.join(sidecar(), "finance.events.jsonl");

/** sha256 of a file, or a sentinel when it does not exist. Absence is itself a state worth asserting. */
async function hash(file: string): Promise<string> {
  try {
    return createHash("sha256").update(await fs.readFile(file)).digest("hex");
  } catch {
    return "<absent>";
  }
}

async function readEventLines(): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(financeEvents(), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function seedVault(paidAt: string | null): Promise<void> {
  await fs.mkdir(sidecar(), { recursive: true });
  await fs.writeFile(invoicesFile(), JSON.stringify({ ...UNPAID_INVOICE, paid_at: paidAt }) + "\n");
}

beforeEach(async () => {
  savedVaultPath = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-confirm-gate-"));
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (savedVaultPath === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVaultPath;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

describe("confirm gate · unconfirmed ⇒ preview, and the vault is untouched", () => {
  it("previews the change and leaves the vault byte-for-byte identical", async () => {
    await seedVault(null);
    const beforeInvoices = await hash(invoicesFile());
    const beforeEvents = await hash(financeEvents());

    const result = await runCommand(
      "mark-invoice-paid",
      { invoice: INVOICE_ID },
      { confirm: false }
    );

    // The preview describes the intended change and flags that confirming would change something.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain(INVOICE_ID);
      expect((result.data as { changes?: boolean }).changes).toBe(true);
    }

    // THE INVARIANT: nothing was written, and no event log was created.
    expect(await hash(invoicesFile())).toBe(beforeInvoices);
    expect(await hash(financeEvents())).toBe(beforeEvents);
    expect(beforeEvents).toBe("<absent>"); // the preview did not even create the log
    expect(await readEventLines()).toEqual([]);
  });

  it("previews a missing invoice as a typed error without touching the vault", async () => {
    await seedVault(null);
    const beforeInvoices = await hash(invoicesFile());

    const result = await runCommand("mark-invoice-paid", { invoice: "no-such-invoice" }, { confirm: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no-such-invoice");
    expect(await hash(invoicesFile())).toBe(beforeInvoices);
    expect(await readEventLines()).toEqual([]);
  });
});

describe("confirm gate · confirmed ⇒ execute, mutation and event both occur", () => {
  it("writes the invoice, emits exactly one event, and reports changed:true", async () => {
    await seedVault(null);
    const beforeInvoices = await hash(invoicesFile());

    const result = await runCommand("mark-invoice-paid", { invoice: INVOICE_ID }, { confirm: true });

    // 4 — the mutation happened.
    expect(await hash(invoicesFile())).not.toBe(beforeInvoices);
    const ledger = JSON.parse((await fs.readFile(invoicesFile(), "utf8")).trim());
    expect(ledger.paid_at).toEqual(expect.any(String));
    // The immutable commercial fields are untouched by the state change.
    expect(ledger.id).toBe(UNPAID_INVOICE.id);
    expect(ledger.client).toBe(UNPAID_INVOICE.client);
    expect(ledger.amount_usd).toBe(UNPAID_INVOICE.amount_usd);

    // 5 — the event was emitted, exactly once, by the frozen writer.
    const events = await readEventLines();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("invoice.paid");

    // 6 — the command result is the typed shape the Console consumes.
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { changed?: boolean }).changed).toBe(true);

    // 7 — the affected entity is resolvable FROM THE EVENT, which is what app/console/actions.ts
    // relies on. CommandResult carries no entity; the event's subject is the authority.
    const subject = events[0].subject as { entity: string; entity_id: string };
    expect(subject.entity).toBe("invoice");
    expect(subject.entity_id).toBe(INVOICE_ID);

    // The client destination Console also offers comes from the envelope's existing data field.
    expect((events[0].data as { client?: string }).client).toBe(UNPAID_INVOICE.client);
  });

  it("resolves the event subject to canonical destinations", async () => {
    // 8 — the navigation destination is the canonical one, from the single routing owner, and the
    // graph identity comes from the contract that owns it (F19). Imported lazily so this assertion
    // reads as what the surface does with the event, not as extra setup for the write above.
    const { routeForEntity } = await import("@/navigation/routing");
    const { focusHrefFor, graphNodeIdFor } = await import("@/graph-view/contract");

    await seedVault(null);
    await runCommand("mark-invoice-paid", { invoice: INVOICE_ID }, { confirm: true });
    const [event] = await readEventLines();
    const subject = event.subject as { entity: "invoice"; entity_id: string };

    expect(routeForEntity(subject.entity, subject.entity_id)).toBe("/finance");
    expect(routeForEntity("client", (event.data as { client: string }).client)).toBe(
      "/clients/fixture-client"
    );
    expect(graphNodeIdFor(subject.entity, subject.entity_id)).toBe(`invoice:${INVOICE_ID}`);
    expect(focusHrefFor(subject.entity, subject.entity_id)).toBe(
      `/?focus=invoice%3A${INVOICE_ID}`
    );
  });
});

describe("confirm gate · idempotent execution is a true no-op", () => {
  it("reports changed:false and emits NO event when already satisfied", async () => {
    await seedVault("2026-02-01T00:00:00.000Z"); // already paid
    const beforeInvoices = await hash(invoicesFile());

    const result = await runCommand("mark-invoice-paid", { invoice: INVOICE_ID }, { confirm: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { changed?: boolean }).changed).toBe(false);

    // The frozen writer short-circuits: no rewrite, and critically NO event. This is precisely why
    // Console offers no entity destination for a no-op — there is no authoritative subject to use.
    expect(await hash(invoicesFile())).toBe(beforeInvoices);
    expect(await readEventLines()).toEqual([]);
  });

  it("mark-unpaid inverts the change and emits its own event", async () => {
    await seedVault("2026-02-01T00:00:00.000Z");

    const result = await runCommand("mark-invoice-unpaid", { invoice: INVOICE_ID }, { confirm: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { changed?: boolean }).changed).toBe(true);

    const ledger = JSON.parse((await fs.readFile(invoicesFile(), "utf8")).trim());
    expect(ledger.paid_at).toBeNull();

    const events = await readEventLines();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("invoice.unpaid");
  });
});