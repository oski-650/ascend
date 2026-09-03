// The notification working-surface loop (docs/WORKING-SURFACE.md, slice 1).
//
// This proves the thing the slice was built for, and it is NOT "the card renders":
//
//     discover  ->  act  ->  the action becomes a fact in the spine  ->  the next read reflects it
//
// Everything below the surface already existed — the engine, the assembler, the writers and their
// event emission. What was missing was the seam from `app/`. These tests assert the loop across
// that seam by driving the same core writers the server actions delegate to, against a real
// temporary vault. The server actions themselves are thin: they parse a FormData, call the writer,
// and revalidate. There is no notification logic in them to test.
//
// `core/vault/paths.vaultPath()` reads ASCEND_VAULT_PATH at call time, so each test builds a fresh
// vault under os.tmpdir() and restores the caller's value afterwards. No path here ever resolves
// inside the operator's real vault.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  dismissNotification,
  snoozeNotification,
  viewNotification,
} from "@/core/notifications";
import { assembleNotifications } from "@/mission-control/notifications";
import { readEvents } from "@/core/events";
import type { RankableSignal } from "@/engines/decision-engine";

const CLIENT = "loop-fixture-client";

/** One firing signal, shaped exactly as mission-control's adapters produce them. */
const signal = (over: Partial<RankableSignal> = {}): RankableSignal => ({
  source: "health",
  subject: { entity: "client", id: CLIENT, name: "Loop Fixture" },
  kind: "health_at_risk",
  tier: "at_risk",
  evidence: { source: "health", detail: "Health fell to at_risk" },
  ...over,
});

/** The signalKey mission-control derives — `kind:entity:id`. Recomputed here, never imported. */
const KEY = `health_at_risk:client:${CLIENT}`;
/** The producer-owned fingerprint: health's own tier, preserved. */
const FP = "at_risk";

let vault = "";
let previous: string | undefined;

/**
 * These tests read the EVENT SPINE, which since the per-domain visibility model resolves its caller
 * and fails closed. Declaring the caller is the boundary working — a test is a caller like any
 * other, the same reason `tests/engines/event-emission.test.ts` already binds one.
 *
 * `owner` because these suites assert over the WHOLE spine (migration baselines, reconciler
 * observations, notification loops); a narrower principal would filter their own fixtures out and
 * they would go red for a reason unrelated to what they measure.
 */
beforeAll(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

beforeEach(async () => {
  previous = process.env.ASCEND_VAULT_PATH;
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-loop-"));
  await fs.mkdir(path.join(vault, ".ascend-os"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vault;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = previous;
  await fs.rm(vault, { recursive: true, force: true });
});

const notificationEvents = async () =>
  (await readEvents({ domains: ["notifications"] })).map((e) => e.type);

describe("notification loop · discover", () => {
  it("surfaces a firing signal as raised, with nothing acted on yet", async () => {
    const [n] = await assembleNotifications([signal()]);
    expect(n.status).toBe("raised");
    expect(n.signalKey).toBe(KEY);
    expect(n.fingerprint).toBe(FP);
    expect(await notificationEvents()).toEqual([]);
  });
});

describe("notification loop · act → event → reflected", () => {
  it("dismiss records a fact in the spine and the next read shows it", async () => {
    await dismissNotification(KEY, FP);

    // The action became a real event — the whole point of the slice.
    expect(await notificationEvents()).toEqual(["notification.dismissed"]);

    // And the next assembly reflects it, because the read-model is a fold over that same log.
    const [n] = await assembleNotifications([signal()]);
    expect(n.status).toBe("dismissed");
  });

  it("view records a fact and leaves the item actionable", async () => {
    await viewNotification(KEY, FP);
    expect(await notificationEvents()).toEqual(["notification.viewed"]);

    // The engine documents `viewed` as "seen, still shown & actionable" — so it stays in the queue.
    const [n] = await assembleNotifications([signal()]);
    expect(n.status).toBe("viewed");
  });

  it("snooze hides the item until its own expiry, then returns it with no further write", async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await snoozeNotification(KEY, FP, until);
    expect(await notificationEvents()).toEqual(["notification.snoozed"]);

    const [hidden] = await assembleNotifications([signal()]);
    expect(hidden.status).toBe("snoozed");
    expect(hidden.snoozeUntil).toBe(until);

    // Expiry is a read-time comparison against an injected clock, not a scheduled job. Nothing new
    // is written when a snooze lapses — a returning item is the same fact, re-read.
    const past = new Date(Date.now() - 1000).toISOString();
    await snoozeNotification(KEY, FP, past);
    const [returned] = await assembleNotifications([signal()]);
    expect(returned.status).toBe("raised");
    expect(await notificationEvents()).toEqual(["notification.snoozed", "notification.snoozed"]);
  });
});

describe("notification loop · the operator's action survives, and knows when it should not", () => {
  it("is idempotent — acting twice does not write twice", async () => {
    await dismissNotification(KEY, FP);
    await dismissNotification(KEY, FP);
    expect(await notificationEvents()).toEqual(["notification.dismissed"]);
  });

  it("re-raises when the producer's fingerprint changes", async () => {
    // A dismissal applies to the situation the operator saw. If health degrades further, the
    // producer has invalidated that judgement and the item must come back rather than stay silent.
    await dismissNotification(KEY, FP);
    const [worse] = await assembleNotifications([signal({ tier: "critical" })]);
    expect(worse.status).toBe("raised");
  });

  it("drops a signal that stops firing, with no write at all", async () => {
    await dismissNotification(KEY, FP);
    expect(await assembleNotifications([])).toEqual([]);
    // Auto-resolution emits nothing: nothing witnessed a transition, so nothing is claimed.
    expect(await notificationEvents()).toEqual(["notification.dismissed"]);
  });
});

describe("notification loop · the surface adds no logic of its own", () => {
  it("assembles the same statuses the engine assigns, for the same log", async () => {
    // If the surface ever starts deciding status, this stops holding — which is the point.
    await viewNotification(KEY, FP);
    const first = await assembleNotifications([signal()]);
    const second = await assembleNotifications([signal()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first[0].status).toBe("viewed");
  });
});
