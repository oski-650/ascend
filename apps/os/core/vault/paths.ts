// core/vault/paths.ts — the single owner of vault + sidecar path resolution.
// (Absorbed from lib/paths.ts — lib/paths.ts now re-exports this module.)
// Fitness function (Part I §9): no fs/vault-path access outside core/.

import path from "node:path";
import type { EventLogDomain } from "@/domain";

export function vaultPath(): string {
  const p = process.env.ASCEND_VAULT_PATH;
  if (!p) {
    throw new Error(
      "ASCEND_VAULT_PATH is not set. Add it to apps/os/.env.local (absolute path to your Obsidian vault root)."
    );
  }
  return p;
}

export function crmDir(): string {
  return path.join(vaultPath(), "01 - CRM & Clients");
}

export function hitListDir(): string {
  return path.join(vaultPath(), "02 - Sales & Hit List");
}

export function sopDir(): string {
  return path.join(vaultPath(), "03 - SOP Library");
}

/** Hidden sidecar dir for app-managed data (records + event logs) — bundled with the vault. */
export function appDataDir(): string {
  return path.join(vaultPath(), ".ascend-os");
}

export function timeLogPath(): string {
  return path.join(appDataDir(), "time_log.jsonl");
}

export function invoiceLogPath(): string {
  return path.join(appDataDir(), "invoices.jsonl");
}

export function configPath(): string {
  return path.join(appDataDir(), "config.json");
}

export function automationsDir(): string {
  return path.join(sopDir(), "automations");
}

export function automationsFiredPath(): string {
  return path.join(appDataDir(), "automations_fired.jsonl");
}

export function auditsLogPath(): string {
  return path.join(appDataDir(), "audits.jsonl");
}

export function documentsDir(): string {
  return path.join(vaultPath(), "04 - Documents");
}

export function clientUploadsDir(): string {
  return path.join(vaultPath(), "05 - Client Uploads");
}

export function portalInvitesPath(): string {
  return path.join(appDataDir(), "portal_invites.jsonl");
}

export function portalSubmissionsPath(): string {
  return path.join(appDataDir(), "portal_submissions.jsonl");
}

export function approvalRequestsPath(): string {
  return path.join(appDataDir(), "approval_requests.jsonl");
}

/** Per-domain append-only event log (Part IV §IV.7 #5): `.ascend-os/<domain>.events.jsonl`. */
export function eventsLogPath(domain: EventLogDomain): string {
  return path.join(appDataDir(), `${domain}.events.jsonl`);
}
