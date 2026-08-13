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
} from "@/lib/paths";

export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "WIPE";

type WipeTarget =
  | "invoices"
  | "time_log"
  | "audits"
  | "automations_fired"
  | "portal_invites"
  | "portal_submissions"
  | "approval_requests"
  | "sample_documents"
  | "client_uploads"
  | "delete_client_pilar"
  | "delete_client_tapia";

async function truncateFile(p: string): Promise<{ ok: true; target: string }> {
  await fs.writeFile(p, "", "utf8");
  return { ok: true, target: p };
}

async function removeDir(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { confirm?: string; targets?: WipeTarget[] };
    if (body.confirm !== CONFIRM_PHRASE) {
      return NextResponse.json(
        { error: `Type "${CONFIRM_PHRASE}" exactly to confirm` },
        { status: 400 }
      );
    }
    const targets = body.targets ?? [];
    if (targets.length === 0) {
      return NextResponse.json({ error: "no targets selected" }, { status: 400 });
    }

    const results: { target: string; result: string }[] = [];

    for (const t of targets) {
      try {
        switch (t) {
          case "invoices":
            await truncateFile(invoiceLogPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "time_log":
            await truncateFile(timeLogPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "audits":
            await truncateFile(auditsLogPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "automations_fired":
            await truncateFile(automationsFiredPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "portal_invites":
            await truncateFile(portalInvitesPath());
            results.push({ target: t, result: "emptied (all invite tokens revoked)" });
            break;
          case "portal_submissions":
            await truncateFile(portalSubmissionsPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "approval_requests":
            await truncateFile(approvalRequestsPath());
            results.push({ target: t, result: "emptied" });
            break;
          case "sample_documents":
            // Delete only the seeded client doc trees (Pilar + Tapia) — keep README + any new clients
            await removeDir(path.join(documentsDir(), "decoraciones-pilar"));
            await removeDir(path.join(documentsDir(), "tapia-tile-marble"));
            results.push({ target: t, result: "deleted seeded doc trees (Pilar + Tapia)" });
            break;
          case "client_uploads":
            // Delete only the seeded client upload dirs
            await removeDir(path.join(clientUploadsDir(), "decoraciones-pilar"));
            await removeDir(path.join(clientUploadsDir(), "tapia-tile-marble"));
            results.push({ target: t, result: "deleted seeded upload dirs" });
            break;
          case "delete_client_pilar":
            await removeDir(path.join(crmDir(), "decoraciones-pilar"));
            results.push({ target: t, result: "CRM folder deleted" });
            break;
          case "delete_client_tapia":
            await removeDir(path.join(crmDir(), "tapia-tile-marble"));
            results.push({ target: t, result: "CRM folder deleted" });
            break;
          default:
            results.push({ target: t, result: "unknown target — skipped" });
        }
      } catch (e) {
        results.push({ target: t, result: `ERROR: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
