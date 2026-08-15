import "server-only";
import { emitEvent } from "@/core/events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  appDataDir,
  approvalRequestsPath,
  clientUploadsDir,
  portalInvitesPath,
  portalSubmissionsPath,
} from "./paths";
import type {
  ApprovalKind,
  ApprovalRequest,
  PortalInvite,
  PortalSubmission,
  UploadedFileRef,
} from "./portalTypes";

// ─── Token generation ───────────────────────────────────────────────────────

/** URL-safe random token, 32 chars (~190 bits). */
export function generateToken(): string {
  return randomBytes(24).toString("base64url"); // 32 chars
}

// ─── JSONL helpers ──────────────────────────────────────────────────────────

async function ensureFile(filePath: string): Promise<void> {
  await fs.mkdir(appDataDir(), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", "utf8");
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  await ensureFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) return [];
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

async function appendJsonl<T>(filePath: string, entry: T): Promise<void> {
  await ensureFile(filePath);
  await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
}

async function rewriteJsonl<T>(filePath: string, entries: T[]): Promise<void> {
  await ensureFile(filePath);
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, filePath);
}

// ─── Invites ────────────────────────────────────────────────────────────────

export async function listInvites(): Promise<PortalInvite[]> {
  return readJsonl<PortalInvite>(portalInvitesPath());
}

export async function activeInviteFor(clientSlug: string): Promise<PortalInvite | null> {
  const all = await listInvites();
  return (
    all.find((i) => i.client_slug === clientSlug && !i.revoked_at) ?? null
  );
}

export async function findInviteByToken(token: string): Promise<PortalInvite | null> {
  const all = await listInvites();
  const found = all.find((i) => i.token === token && !i.revoked_at);
  return found ?? null;
}

/** Create new invite for client. If one exists, revoke it first (one-active-at-a-time). */
export async function createInvite(clientSlug: string, label?: string): Promise<PortalInvite> {
  const all = await listInvites();
  const now = new Date().toISOString();
  const revoked: PortalInvite[] = [];
  for (const inv of all) {
    if (inv.client_slug === clientSlug && !inv.revoked_at) {
      inv.revoked_at = now;
      revoked.push(inv);
    }
  }
  const changed = revoked.length > 0;
  const fresh: PortalInvite = {
    id: randomUUID(),
    client_slug: clientSlug,
    token: generateToken(),
    created_at: now,
    revoked_at: null,
    label,
  };
  all.push(fresh);
  if (changed) {
    await rewriteJsonl(portalInvitesPath(), all);
  } else {
    await appendJsonl(portalInvitesPath(), fresh);
  }

  // Rotation is TWO transitions: any live invite is revoked, and a new one is issued. Each gets its
  // own event, because "the old link stopped working" and "a new link exists" are different facts an
  // operator may need to explain later. Emitted only after the write commits.
  for (const inv of revoked) {
    await emitEvent({
      type: "portal.invite_revoked",
      subject: { entity: "portal_invite", entity_id: inv.id },
      data: { client: clientSlug, reason: "rotated" },
    });
  }
  await emitEvent({
    type: "portal.invited",
    subject: { entity: "portal_invite", entity_id: fresh.id },
    data: { client: clientSlug, ...(label ? { label } : {}) },
  });
  return fresh;
}

export async function revokeInvite(id: string): Promise<PortalInvite | null> {
  const all = await listInvites();
  const inv = all.find((i) => i.id === id);
  // Already revoked ⇒ no state change ⇒ no write and no event.
  if (!inv || inv.revoked_at) return inv ?? null;
  inv.revoked_at = new Date().toISOString();
  await rewriteJsonl(portalInvitesPath(), all);
  await emitEvent({
    type: "portal.invite_revoked",
    subject: { entity: "portal_invite", entity_id: inv.id },
    data: { client: inv.client_slug, reason: "revoked" },
  });
  return inv;
}

// ─── Submissions + uploads ──────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  // Strip path components, weird chars, normalize whitespace
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "file";
}

export async function saveUploadedFile(
  clientSlug: string,
  file: File
): Promise<UploadedFileRef> {
  const dir = path.join(clientUploadsDir(), clientSlug);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = sanitizeFilename(file.name);
  const savedName = `${stamp}-${safe}`;
  const fullPath = path.join(dir, savedName);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return {
    saved_path: fullPath,
    saved_name: savedName,
    original_name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };
}

export async function createSubmission(args: {
  clientSlug: string;
  inviteId: string;
  fields: Record<string, string>;
  files: UploadedFileRef[];
}): Promise<PortalSubmission> {
  const entry: PortalSubmission = {
    id: randomUUID(),
    client_slug: args.clientSlug,
    invite_id: args.inviteId,
    submitted_at: new Date().toISOString(),
    fields: args.fields,
    files: args.files,
  };
  await appendJsonl(portalSubmissionsPath(), entry);
  await emitEvent({
    type: "portal.submitted",
    subject: { entity: "portal_submission", entity_id: entry.id },
    data: {
      client: args.clientSlug,
      invite_id: args.inviteId,
      field_count: Object.keys(args.fields).length,
      file_count: args.files.length,
    },
  });
  return entry;
}

export async function listSubmissions(clientSlug?: string): Promise<PortalSubmission[]> {
  const all = await readJsonl<PortalSubmission>(portalSubmissionsPath());
  const filtered = clientSlug ? all.filter((s) => s.client_slug === clientSlug) : all;
  // Defensive: `submitted_at` is cast from JSONL without runtime validation and may be missing on a
  // malformed line. See the note on listApprovalRequests — same crash class.
  return filtered.sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
}

// ─── Approval requests ──────────────────────────────────────────────────────

export async function listApprovalRequests(clientSlug?: string): Promise<ApprovalRequest[]> {
  const all = await readJsonl<ApprovalRequest>(approvalRequestsPath());
  const filtered = clientSlug ? all.filter((a) => a.client_slug === clientSlug) : all;
  // JSONL records are cast to ApprovalRequest with no runtime validation, so `created_at` may be
  // absent or null. Reading `.localeCompare` off that threw from inside the reader — intermittently,
  // depending on where V8's sort placed the bad record — and propagated through assembleApprovals to
  // the boundary-less dashboard. Coercing to "" sorts undated records last without inventing a date.
  return filtered.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
  const all = await readJsonl<ApprovalRequest>(approvalRequestsPath());
  return all.find((a) => a.id === id) ?? null;
}

export async function createApprovalRequest(args: {
  clientSlug: string;
  kind: ApprovalKind;
  title: string;
  description: string;
  due_at?: string;
}): Promise<ApprovalRequest> {
  const entry: ApprovalRequest = {
    id: randomUUID(),
    client_slug: args.clientSlug,
    kind: args.kind,
    title: args.title,
    description: args.description,
    created_at: new Date().toISOString(),
    due_at: args.due_at,
    approved_at: null,
    approved_by_name: null,
    signature_text: null,
  };
  await appendJsonl(approvalRequestsPath(), entry);
  await emitEvent({
    type: "approval.requested",
    subject: { entity: "approval", entity_id: entry.id },
    data: {
      client: args.clientSlug,
      kind: args.kind,
      title: args.title,
      ...(args.due_at ? { due_at: args.due_at } : {}),
    },
  });
  return entry;
}

/**
 * Sign an approval — immutable. Once signed, subsequent attempts no-op.
 */
export async function signApproval(args: {
  id: string;
  by_name: string;
  signature_text: string;
}): Promise<ApprovalRequest | null> {
  const all = await readJsonl<ApprovalRequest>(approvalRequestsPath());
  const req = all.find((a) => a.id === args.id);
  if (!req) return null;
  if (req.approved_at) return req; // already signed, immutable ⇒ no write, no event
  req.approved_at = new Date().toISOString();
  req.approved_by_name = args.by_name.trim().slice(0, 120);
  req.signature_text = args.signature_text.trim().slice(0, 200);
  await rewriteJsonl(approvalRequestsPath(), all);
  await emitEvent({
    type: "approval.approved",
    subject: { entity: "approval", entity_id: req.id },
    // `actor` is deliberately left at its default: the signer is the CLIENT, not the operator, and
    // the Actor vocabulary has no term for that. The signer's name is carried in data instead of
    // being laundered into an actor value the contract does not define.
    data: { client: req.client_slug, kind: req.kind, title: req.title, signed_by: req.approved_by_name },
  });
  return req;
}
