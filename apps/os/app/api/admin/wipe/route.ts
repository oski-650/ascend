// app/api/admin/wipe — DESTRUCTIVE vault operations (truncate app-data logs, delete seeded trees).
//
// HARDENING (this pass). Previously this route recursively deleted CRM client folders behind a
// constant string in the request body, with no authentication. Layers now in force:
//   1. AUTHENTICATION — /api/admin/* is not in the middleware allowlist, so an unauthenticated
//      request never reaches this handler (401 at the perimeter).
//   2. CONFIRMATION — the literal phrase is still required, now as a deliberateness check for an
//      already-authenticated operator rather than as the only barrier.
//   3. STRICT INPUT VALIDATION — `targets` must be an array of known target ids; unknown ids are
//      rejected outright (400) rather than silently skipped.
//   4. PATH CONTAINMENT — every destructive filesystem call re-verifies that its resolved path lies
//      inside the vault root before touching it, and refuses to operate on the vault root itself.
// No path in this route is user-controlled; the containment checks are defence-in-depth against a
// future edit introducing one, and against a misconfigured ASCEND_VAULT_PATH.
//
// This route creates no read-model, emits no events, and participates in no frozen contract.

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  approvalRequestsPath,
  auditsLogPath,
  automationsFiredPath,
  clientUploadsDir,
  crmDir,
  documentsDir,
  invoiceLogPath,
  portalInvitesPath,
  portalSubmissionsPath,
  timeLogPath,
  vaultPath,
} from "@/lib/paths";
import { isWithin } from "@/lib/safePath";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "WIPE";

/** The complete set of permitted targets. Anything outside this list is refused. */
const WIPE_TARGETS = [
  "invoices",
  "time_log",
  "audits",
  "automations_fired",
  "portal_invites",
  "portal_submissions",
  "approval_requests",
  "sample_documents",
  "client_uploads",
  "delete_client_pilar",
  "delete_client_tapia",
] as const;

type WipeTarget = (typeof WIPE_TARGETS)[number];

function isWipeTarget(value: unknown): value is WipeTarget {
  return typeof value === "string" && (WIPE_TARGETS as readonly string[]).includes(value);
}

/**
 * Refuse any destructive path that is not strictly inside the vault, and never allow the vault root
 * itself to be the target. Throws so the caller records a per-target error rather than proceeding.
 */
function assertDestructivePathAllowed(target: string): string {
  const root = vaultPath();
  const resolved = path.resolve(target);
  if (resolved === path.resolve(root)) {
    throw new Error("refused: path is the vault root");
  }
  if (!isWithin(root, resolved)) {
    throw new Error("refused: path resolves outside the vault root");
  }
  return resolved;
}

/** Empty a file in place. The file must already be inside the vault. */
async function truncateFile(p: string): Promise<void> {
  await fs.writeFile(assertDestructivePathAllowed(p), "", "utf8");
}

/** Recursively remove a directory that is inside the vault. Missing directory is not an error. */
async function removeDir(p: string): Promise<void> {
  await fs.rm(assertDestructivePathAllowed(p), { recursive: true, force: true });
}

/** Seeded demo client slugs the sample-data targets are allowed to remove. */
const SEEDED_CLIENT_SLUGS = { pilar: "decoraciones-pilar", tapia: "tapia-tile-marble" } as const;

async function runTarget(t: WipeTarget): Promise<string> {
  switch (t) {
    case "invoices":
      await truncateFile(invoiceLogPath());
      return "emptied";
    case "time_log":
      await truncateFile(timeLogPath());
      return "emptied";
    case "audits":
      await truncateFile(auditsLogPath());
      return "emptied";
    case "automations_fired":
      await truncateFile(automationsFiredPath());
      return "emptied";
    case "portal_invites":
      await truncateFile(portalInvitesPath());
      return "emptied (all invite tokens revoked)";
    case "portal_submissions":
      await truncateFile(portalSubmissionsPath());
      return "emptied";
    case "approval_requests":
      await truncateFile(approvalRequestsPath());
      return "emptied";
    case "sample_documents":
      // Only the seeded client doc trees — never the whole documents root.
      await removeDir(path.join(documentsDir(), SEEDED_CLIENT_SLUGS.pilar));
      await removeDir(path.join(documentsDir(), SEEDED_CLIENT_SLUGS.tapia));
      return "deleted seeded doc trees (Pilar + Tapia)";
    case "client_uploads":
      await removeDir(path.join(clientUploadsDir(), SEEDED_CLIENT_SLUGS.pilar));
      await removeDir(path.join(clientUploadsDir(), SEEDED_CLIENT_SLUGS.tapia));
      return "deleted seeded upload dirs";
    case "delete_client_pilar":
      await removeDir(path.join(crmDir(), SEEDED_CLIENT_SLUGS.pilar));
      return "CRM folder deleted";
    case "delete_client_tapia":
      await removeDir(path.join(crmDir(), SEEDED_CLIENT_SLUGS.tapia));
      return "CRM folder deleted";
  }
}

export async function POST(req: Request) {
  return authorize(req, "admin:*", async () => {
    try {
      const body = (await req.json().catch(() => null)) as { confirm?: unknown; targets?: unknown } | null;
      if (body === null) {
        return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
      }

      if (body.confirm !== CONFIRM_PHRASE) {
        return NextResponse.json({ error: `Type "${CONFIRM_PHRASE}" exactly to confirm` }, { status: 400 });
      }

      if (!Array.isArray(body.targets) || body.targets.length === 0) {
        return NextResponse.json({ error: "no targets selected" }, { status: 400 });
      }

      // Reject the whole request if ANY target is unknown — a typo must not silently wipe the subset
      // that happened to parse.
      const unknown = body.targets.filter((t) => !isWipeTarget(t));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `unknown target(s): ${unknown.map((t) => String(t)).join(", ")}` },
          { status: 400 }
        );
      }
      const targets = body.targets as WipeTarget[];

      const results: { target: string; result: string }[] = [];
      for (const t of targets) {
        try {
          results.push({ target: t, result: await runTarget(t) });
        } catch (e) {
          // Per-target failure is recorded and the remaining targets still run; the message is the
          // containment refusal or fs error, which contains no user-supplied content.
          console.error(`[admin/wipe] target "${t}" failed:`, e);
          results.push({ target: t, result: `ERROR: ${e instanceof Error ? e.message : "failed"}` });
        }
      }

      console.warn(`[admin/wipe] executed targets: ${targets.join(", ")}`);
      return NextResponse.json({ ok: true, results });
    } catch (e) {
      console.error("[admin/wipe] request failed:", e);
      return NextResponse.json({ error: "wipe request failed" }, { status: 500 });
    }
  });
}