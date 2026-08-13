// Layer A — Commands (Phase 5 / 5.x) contract tests.
//
// NOTE ON PLACEMENT: "Commands" is a frozen responsibility but NOT an engine — it lives at
// core/command-runtime. It is tested here alongside the engines because it is one of the frozen
// responsibilities in scope, not because it has been reclassified.
//
// Frozen contract: assemble the ONE CommandCatalog from capability-owned definitions, validate
// explicit arguments, dispatch execution, and shape a typed CommandResult. It owns NO command logic
// and NO matching. Registration is a single EXPLICIT, statically-auditable, deterministically-ordered
// list — no dynamic contributors, no filesystem/environment scanning, no auto-discovery.
//
// ─── D4 RULING: NO TEST-ONLY RUNTIME SEAM ───────────────────────────────────────────────────────
// core/command-runtime is NOT modified to become injectable. Every assertion below uses the runtime
// exactly as production does. The confirm-gate itself (unconfirmed ⇒ preview, confirmed ⇒ execute)
// cannot be distinguished without a vault, because both handlers begin by reading invoices. It is
// therefore documented as an integration-test gap in the skip block at the end rather than faked.
//
// VAULT SAFETY: these tests deliberately run with ASCEND_VAULT_PATH UNSET, which makes any handler
// that reaches for the vault throw at the path resolver. That is not a mock — it is the real failure
// path, and it is exactly what proves the runtime's error-normalisation contract. It also guarantees
// no test here can read or write the live vault.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCommands, runCommand } from "@/core/command-runtime";

let savedVaultPath: string | undefined;

beforeAll(() => {
  savedVaultPath = process.env.ASCEND_VAULT_PATH;
  delete process.env.ASCEND_VAULT_PATH;
});

afterAll(() => {
  if (savedVaultPath === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = savedVaultPath;
});

describe("command-runtime · catalog + registration", () => {
  it("exposes a non-empty catalog of metadata only — handlers never reach the surface", () => {
    const catalog = listCommands();
    expect(catalog.length).toBeGreaterThan(0);
    for (const command of catalog) {
      expect(command).not.toHaveProperty("execute");
      expect(command).not.toHaveProperty("preview");
      expect(typeof command.id).toBe("string");
      expect(typeof command.kind).toBe("string");
    }
  });

  it("enforces one owner per command id (the load-time duplicate guard held)", () => {
    // A duplicate id throws during module initialisation; reaching this point proves it did not.
    const ids = listCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns a deterministic, stable registration order", () => {
    expect(listCommands().map((c) => c.id)).toEqual(listCommands().map((c) => c.id));
  });

  it("declares only the known command kinds", () => {
    for (const command of listCommands()) {
      expect(["navigation", "read", "mutation"]).toContain(command.kind);
    }
  });
});

describe("command-runtime · typed errors, never throws", () => {
  it("returns a typed error for an unknown command id", async () => {
    const result = await runCommand("no-such-command");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unknown command");
  });

  it("refuses navigation commands — they are resolved by the presentation layer", async () => {
    const navigation = listCommands().find((c) => c.kind === "navigation");
    expect(navigation).toBeDefined();
    const result = await runCommand(navigation!.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("navigation-only");
  });

  it("returns a typed error when a required argument is missing", async () => {
    const needsArg = listCommands().find((c) => c.kind !== "navigation" && c.args.some((a) => a.required));
    expect(needsArg).toBeDefined();
    const result = await runCommand(needsArg!.id, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Missing required argument");
  });

  it("rejects a blank string for a required argument", async () => {
    const needsArg = listCommands().find((c) => c.kind !== "navigation" && c.args.some((a) => a.required));
    const argName = needsArg!.args.find((a) => a.required)!.name;
    const result = await runCommand(needsArg!.id, { [argName]: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Missing required argument");
  });

  it("normalises a handler failure into a typed result instead of propagating the throw", async () => {
    // With ASCEND_VAULT_PATH unset the capability handler throws at the path resolver. The runtime
    // must catch it and shape a CommandResult — nothing may escape to the caller.
    const needsArg = listCommands().find((c) => c.kind !== "navigation" && c.args.some((a) => a.required));
    const argName = needsArg!.args.find((a) => a.required)!.name;

    const result = await runCommand(needsArg!.id, { [argName]: "some-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.error).toBe("string");
  });

  it("never rejects — every failure mode resolves to a CommandResult", async () => {
    const attempts = [
      runCommand("unknown"),
      runCommand(""),
      runCommand(listCommands()[0].id, {}),
    ];
    const settled = await Promise.allSettled(attempts);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
  });
});

describe("command-runtime · confirm gate is structural", () => {
  it("declares both preview and execute intent through metadata for every mutation", () => {
    // The gate itself is enforced inside runCommand by selecting preview vs execute. What is
    // observable without a vault is that mutations are declared as such and carry required args.
    for (const command of listCommands().filter((c) => c.kind === "mutation")) {
      expect(command.args.length).toBeGreaterThan(0);
      expect(command.args.some((a) => a.required)).toBe(true);
    }
  });

  it("treats an unconfirmed mutation as a non-throwing typed result", async () => {
    const mutation = listCommands().find((c) => c.kind === "mutation");
    if (!mutation) return;
    const argName = mutation.args.find((a) => a.required)!.name;
    const result = await runCommand(mutation.id, { [argName]: "x" }, { confirm: false });
    expect(result).toHaveProperty("ok");
  });
});

// ─── Explicitly uncovered: requires an integration harness, not a production seam (D4) ──────────
describe.skip("command-runtime · confirm-gate dispatch [GAP — needs vault-backed integration test]", () => {
  it.skip("dispatches to preview when unconfirmed, performing no write", () => {});
  it.skip("dispatches to execute only when confirm is true", () => {});
  it.skip("reports changed:false when the confirmed mutation is already satisfied", () => {});
});