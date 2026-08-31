// Layer A — RENDER ISOLATION (2G.1 slice 1). The 7.3 proof, on the Server Component surface.
//
// ─── WHY A REAL SERVER ─────────────────────────────────────────────────────────────────────────
//
// The property is about `React.cache`'s render pass, and a stub cannot demonstrate it. §9's spike 2
// measured the primitive; this proves the RESOLVER built on it, and — the part a spike cannot do —
// that the suite would notice if the mechanism were removed.
//
// Three properties, in the order that makes them mean anything:
//
//   1. REAL OVERLAP        — two renders held at a barrier, so neither completes until both have
//                            entered. Overlap is a precondition of passing, not an assertion.
//   2. MUTATION SENSITIVITY— the same request path with the memoized resolver replaced by one
//                            module-level slot leaks, observably.
//   3. CORRECT BEHAVIOUR   — the real resolver, same overlap, zero crossover, repeated.
//
// ─── GATED, AND LOUD ABOUT IT ──────────────────────────────────────────────────────────────────
//
// Booting a dev server is slow, so this runs only under ASCEND_RENDER_TEST=1. It must never appear
// to pass by not running: a security property is not proven by a silent skip.
//
// PRODUCTION IS NOT TOUCHED. The server is started with the database environment removed and the
// probe registers its own two-user stub, because the property needs two roles and production holds
// one user by design until 2G.2.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { acquireDevServer, releaseDevServer } from "./dev-server-lock";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  BARRIER_TS, MUTANT_PAGE_TSX, PROBE_DIR, REAL_PAGE_TSX, STUB_TS,
} from "./probe-fixtures";
import { createSessionToken } from "@/lib/auth";

const ENABLED = process.env.ASCEND_RENDER_TEST === "1";
const describeIfRender = ENABLED ? describe : describe.skip;

const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "render-isolation-secret-do-not-use";
const OWNER = "0198f3a1-2b4c-7d8e-9f01-00000000aaaa";
const SALES = "0198f3a1-2b4c-7d8e-9f01-00000000bbbb";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

type Shape = { role: string | null; org: string | null; user: string | null; reason?: string };
type Probe = { overlapped: boolean; before: Shape; after: Shape };

describeIfRender("RENDER ISOLATION under genuine concurrency (requires ASCEND_RENDER_TEST=1)", () => {
  let server: ChildProcess;
  let ownerCookie: string;
  let salesCookie: string;
  const abs = path.join(process.cwd(), PROBE_DIR);

  /**
   * `next dev` REWRITES tsconfig.json — measured: it appends `.next/dev/dev/types/**` to `include`.
   * `next build` does not. Left alone, every run of this gate would dirty version control, which is
   * exactly the property step 7.1 was committed to establish. So the file is snapshotted and
   * restored, and the restoration is ASSERTED rather than assumed.
   */
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  let tsconfigBefore = "";

  beforeAll(async () => {
    // Serialize against the other real-server suite — they share `.next/dev`.
    await acquireDevServer("page-isolation");
    tsconfigBefore = readFileSync(tsconfigPath, "utf8");
    // Probe surfaces, written for the duration of this suite only.
    mkdirSync(path.join(abs, "real"), { recursive: true });
    mkdirSync(path.join(abs, "mutant"), { recursive: true });
    writeFileSync(path.join(abs, "barrier.ts"), BARRIER_TS);
    writeFileSync(path.join(abs, "stub.ts"), STUB_TS);
    writeFileSync(path.join(abs, "real", "page.tsx"), REAL_PAGE_TSX);
    writeFileSync(path.join(abs, "mutant", "page.tsx"), MUTANT_PAGE_TSX);

    // The production database is deliberately absent: the probe supplies its own membership stub,
    // because this property needs two roles and production holds one user until 2G.2 provisions one.
    const env: NodeJS.ProcessEnv = { ...process.env, ASCEND_OS_SESSION_SECRET: SECRET };
    for (const k of ["ASCEND_DATABASE_URL", "ASCEND_DATABASE_URL_DIRECT",
                     "ASCEND_DATABASE_URL_ADMIN_POOLED", "ASCEND_PROSPECT_SOURCE"]) {
      delete env[k];
    }

    server = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], {
      cwd: process.cwd(), env, stdio: "ignore", detached: false,
    });

    const config = { configured: true as const, secret: SECRET };
    ownerCookie = `ascend_os_session=${(await createSessionToken(config, OWNER))!}`;
    salesCookie = `ascend_os_session=${(await createSessionToken(config, SALES))!}`;

    // Readiness: compile the probe route itself, so the first measured request is not paying for it.
    for (let i = 0; i < 90; i++) {
      try {
        const r = await fetch(`${BASE}/2g-probe/real`, { headers: { cookie: ownerCookie } });
        if (r.status === 200 && (await r.text()).includes("result")) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, 180_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    server?.kill("SIGKILL");
    rmSync(abs, { recursive: true, force: true });
    // The probe must not survive the suite that created it.
    expect(existsSync(abs), "the probe surface was left behind in app/").toBe(false);

    // GENERATED TYPES TOO. `next dev` writes route types under `.next/dev/types/` for every page it
    // sees, including the probe. Deleting the probe leaves those types pointing at files that no
    // longer exist, and `tsc` then reports errors against a workspace `git status` calls clean —
    // the trap recorded in STAGE2G §14. The gate cleans up after itself in BOTH worlds.
    rmSync(path.join(process.cwd(), ".next", "dev"), { recursive: true, force: true });

    // Nor may the dev server's edit to tsconfig.json.
    if (readFileSync(tsconfigPath, "utf8") !== tsconfigBefore) {
      writeFileSync(tsconfigPath, tsconfigBefore);
    }
    expect(readFileSync(tsconfigPath, "utf8"), "tsconfig.json was left modified by next dev")
      .toBe(tsconfigBefore);
    releaseDevServer();
  }, 30_000);

  /** Two renders, fired together, each held at the barrier inside its own page. */
  async function pair(route: "real" | "mutant"): Promise<{ owner: Probe; sales: Probe }> {
    const get = async (cookie: string): Promise<Probe> => {
      const res = await fetch(`${BASE}/2g-probe/${route}`, { headers: { cookie } });
      const html = await res.text();
      const m = /<pre id="result">(.*?)<\/pre>/s.exec(html);
      if (!m) throw new Error(`no probe result from /${route} (status ${res.status})`);
      return JSON.parse(m[1].replace(/&quot;/g, '"')) as Probe;
    };
    const [owner, sales] = await Promise.all([get(ownerCookie), get(salesCookie)]);
    return { owner, sales };
  }

  const crossover = (p: { owner: Probe; sales: Probe }): string[] => {
    const out: string[] = [];
    if (p.owner.after.role !== "owner") out.push(`owner render saw role=${p.owner.after.role}`);
    if (p.owner.after.org !== ORG_A) out.push(`owner render saw org=${p.owner.after.org}`);
    if (p.owner.after.user !== OWNER) out.push("owner render saw another user");
    if (p.sales.after.role !== "sales") out.push(`sales render saw role=${p.sales.after.role}`);
    if (p.sales.after.org !== ORG_B) out.push(`sales render saw org=${p.sales.after.org}`);
    if (p.sales.after.user !== SALES) out.push("sales render saw another user");
    return out;
  };

  // ─── PART 1 — the renders genuinely overlap ──────────────────────────────────────────────────

  it("PART 1 · two renders are in flight SIMULTANEOUSLY — proven by a barrier", async () => {
    const p = await pair("real");
    expect(p.owner.overlapped, "the renders did not overlap — this suite proves nothing").toBe(true);
    expect(p.sales.overlapped).toBe(true);
  }, 120_000);

  // ─── PART 2 — mutation sensitivity ───────────────────────────────────────────────────────────

  it("PART 2 · MUTATION — a module-level principal LEAKS across overlapping renders", async () => {
    const p = await pair("mutant");
    expect(p.owner.overlapped && p.sales.overlapped, "the mutant round did not overlap").toBe(true);

    const leaks = crossover(p);
    // THE GATE. If the mutant does not leak, the renders are not really concurrent or nothing here
    // reads the resolver, and part 3 proves nothing. Do not weaken this — fix the test.
    expect(leaks.length,
      "THE MUTATION SURVIVED. A module-level principal produced no observable crossover, so this " +
      "suite is not measuring render isolation."
    ).toBeGreaterThan(0);
    console.info(`\n      MUTATION DETECTED — ${leaks.length} crossings:\n        ${leaks.join("\n        ")}\n`);
  }, 120_000);

  // ─── PART 3 — the real resolver ──────────────────────────────────────────────────────────────

  it("PART 3 · the real resolver produces ZERO crossover, repeatedly", async () => {
    const found: string[] = [];
    for (let round = 0; round < 3; round++) {
      const p = await pair("real");
      expect(p.owner.overlapped && p.sales.overlapped, `round ${round} did not overlap`).toBe(true);
      found.push(...crossover(p));
      // And the memo is stable WITHIN a pass: the value seen before and after the barrier is one value.
      expect(p.owner.before).toEqual(p.owner.after);
      expect(p.sales.before).toEqual(p.sales.after);
    }
    expect(found, "authority crossed between concurrent renders").toEqual([]);
  }, 180_000);
});

describe("render isolation — guard", () => {
  it("announces loudly when the render gate has NOT run", () => {
    if (!ENABLED) {
      console.warn(
        "\n  ⚠️  RENDER ISOLATION NOT VERIFIED — ASCEND_RENDER_TEST is not 1.\n" +
        "      Nothing else proves that concurrent Server Component renders keep separate authority.\n"
      );
    }
    expect(true).toBe(true);
  });
});
