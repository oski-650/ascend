// tests/render/dev-server-lock — ONE DEV SERVER AT A TIME, whatever order Vitest chooses.
//
// ─── THE DEFECT THIS FIXES, MEASURED ───────────────────────────────────────────────────────────
//
// Two suites boot a real `next dev` against THIS project: `page-isolation` (2G.1 slice 1) and
// `startup-binding` (slice 5). They use different ports, so that was never the problem — they share
// `.next/dev`, which each server writes and each suite deletes on teardown.
//
// Vitest runs test FILES in parallel workers. Run alone, `page-isolation` passes 4/4 with its
// mutation detecting three crossings. Run in the same suite as `startup-binding`, three of its four
// tests fail — one server's teardown removes the build output the other is still serving from.
//
// This was invisible until the final gate ran BOTH real-server proofs in one execution for the first
// time. Two properties that cannot both be demonstrated in a single run are not two proofs.
//
// ─── WHY A LOCKFILE AND NOT `--no-file-parallelism` ────────────────────────────────────────────
//
// A flag on the command line is a fact about how someone remembered to invoke the suite. A lock is a
// fact about the suites. The gate must not depend on an invocation detail that a future run can
// silently omit — the same reasoning that made the route→capability map a test rather than a note.

import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const LOCK = path.join(process.cwd(), ".next", "ascend-dev-server.lock");
/** A holder that died without releasing must not block the suite forever. */
const STALE_MS = 5 * 60_000;

export async function acquireDevServer(label: string, timeoutMs = 300_000): Promise<void> {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // `wx` fails if the path exists — an atomic create, which is what makes this a lock.
      writeFileSync(LOCK, `${label} ${process.pid} ${Date.now()}`, { flag: "wx" });
      return;
    } catch {
      let age = 0;
      try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { continue; }
      if (age > STALE_MS) { rmSync(LOCK, { force: true }); continue; }
      if (Date.now() > deadline) {
        throw new Error(`${label}: timed out waiting for the dev-server lock (held ${Math.round(age / 1000)}s)`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export function releaseDevServer(): void {
  rmSync(LOCK, { force: true });
}
