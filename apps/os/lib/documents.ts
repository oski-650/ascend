import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { documentsDir } from "./paths";
import { resolveWithin } from "./safePath";
import type {
  DocumentFrontmatter,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
} from "./documentTypes";

// Re-export shared types/constants so existing import paths keep working.
export {
  DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  TYPE_LABEL,
  STATUS_LABEL,
} from "./documentTypes";
export type { DocumentType, DocumentStatus, DocumentFrontmatter, DocumentRecord } from "./documentTypes";

// ─── Filesystem layout ──────────────────────────────────────────────────────

function typeDirName(t: DocumentType): string {
  return { proposal: "proposals", contract: "contracts", sow: "sows", change_order: "change-orders" }[t];
}

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function buildFilename(meta: DocumentFrontmatter): string {
  const stem = safeSlug(meta.title) || meta.type;
  return `${stem}-v${meta.version}.md`;
}

/**
 * Resolve (and create) the `<documents>/<client>/<type>` directory.
 *
 * `client` originates from an API request body and is therefore untrusted: it is joined into a
 * filesystem path and then written to. resolveWithin() rejects traversal, separators, absolute
 * paths and dotfiles, and verifies the resolved result stays under documentsDir(). Without this,
 * a client of "../../.." escaped the documents tree entirely (arbitrary directory creation + write).
 * The filename was already slugified; the DIRECTORY was not.
 */
async function clientTypeDir(client: string, type: DocumentType): Promise<string> {
  const dir = resolveWithin(documentsDir(), client, typeDirName(type));
  if (dir === null) {
    throw new Error(`invalid client identifier: ${JSON.stringify(client)}`);
  }
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ─── Read helpers ───────────────────────────────────────────────────────────

async function* walkDocs(): AsyncGenerator<string> {
  const root = documentsDir();
  let clientEntries: import("node:fs").Dirent[];
  try {
    clientEntries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const c of clientEntries) {
    if (!c.isDirectory() || c.name.startsWith(".")) continue;
    let typeEntries: import("node:fs").Dirent[];
    try {
      typeEntries = await fs.readdir(path.join(root, c.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const t of typeEntries) {
      if (!t.isDirectory()) continue;
      let files: import("node:fs").Dirent[];
      try {
        files = await fs.readdir(path.join(root, c.name, t.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".md") || f.name.startsWith(".") || f.name.startsWith("_")) continue;
        yield path.join(root, c.name, t.name, f.name);
      }
    }
  }
}

function parseDocFile(raw: string, filePath: string): DocumentRecord | null {
  try {
    const parsed = matter(raw);
    const fm = parsed.data as Partial<DocumentFrontmatter>;
    if (!fm.doc_id || !fm.type || !fm.client || !fm.title || !fm.status) return null;
    const meta: DocumentFrontmatter = {
      doc_id: String(fm.doc_id),
      type: fm.type as DocumentType,
      client: String(fm.client),
      version: typeof fm.version === "number" ? fm.version : 1,
      status: fm.status as DocumentStatus,
      title: String(fm.title),
      summary: fm.summary ? String(fm.summary) : undefined,
      amount_usd: typeof fm.amount_usd === "number" ? fm.amount_usd : undefined,
      created_at: String(fm.created_at ?? new Date().toISOString()),
      sent_at: fm.sent_at ? String(fm.sent_at) : undefined,
      accepted_at: fm.accepted_at ? String(fm.accepted_at) : undefined,
      supersedes: fm.supersedes ? String(fm.supersedes) : undefined,
    };
    return { meta, body: parsed.content.trim(), filePath };
  } catch {
    return null;
  }
}

export type ListFilters = {
  client?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  search?: string;
  includeSuperseded?: boolean;
};

export async function listDocuments(filters: ListFilters = {}): Promise<DocumentRecord[]> {
  const out: DocumentRecord[] = [];
  for await (const filePath of walkDocs()) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const rec = parseDocFile(raw, filePath);
    if (!rec) continue;
    if (filters.client && rec.meta.client !== filters.client) continue;
    if (filters.type && rec.meta.type !== filters.type) continue;
    if (filters.status && rec.meta.status !== filters.status) continue;
    if (!filters.includeSuperseded && rec.meta.status === "superseded" && !filters.status) continue;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${rec.meta.title} ${rec.meta.summary ?? ""} ${rec.body}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(rec);
  }
  return out.sort((a, b) => b.meta.created_at.localeCompare(a.meta.created_at));
}

export async function getDocument(docId: string): Promise<DocumentRecord | null> {
  for await (const filePath of walkDocs()) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const rec = parseDocFile(raw, filePath);
    if (rec && rec.meta.doc_id === docId) return rec;
  }
  return null;
}

/** Find any document(s) that supersede the given doc_id (newer versions). */
export async function findSuccessors(docId: string): Promise<DocumentRecord[]> {
  const all = await listDocuments({ includeSuperseded: true });
  return all.filter((d) => d.meta.supersedes === docId);
}

// ─── Mutations ──────────────────────────────────────────────────────────────

function serialize(rec: DocumentRecord): string {
  // Strip undefined keys for clean frontmatter
  const fm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec.meta)) {
    if (v !== undefined && v !== null && v !== "") fm[k] = v;
  }
  return matter.stringify(rec.body, fm);
}

async function writeRecord(rec: DocumentRecord): Promise<void> {
  await fs.mkdir(path.dirname(rec.filePath), { recursive: true });
  const tmp = rec.filePath + ".tmp";
  await fs.writeFile(tmp, serialize(rec), "utf8");
  await fs.rename(tmp, rec.filePath);
}

export async function createDocument(args: {
  type: DocumentType;
  client: string;
  title: string;
  summary?: string;
  amount_usd?: number;
  body?: string;
}): Promise<DocumentRecord> {
  const meta: DocumentFrontmatter = {
    doc_id: randomUUID(),
    type: args.type,
    client: args.client,
    version: 1,
    status: "draft",
    title: args.title,
    summary: args.summary,
    amount_usd: args.amount_usd,
    created_at: new Date().toISOString(),
  };
  const dir = await clientTypeDir(args.client, args.type);
  const filePath = path.join(dir, buildFilename(meta));
  const rec: DocumentRecord = { meta, body: args.body ?? defaultBody(args.type, args.title), filePath };
  await writeRecord(rec);
  return rec;
}

function defaultBody(type: DocumentType, title: string): string {
  switch (type) {
    case "proposal":
      return `# ${title}\n\n## Overview\n\nWhat we're proposing, in one paragraph.\n\n## Scope\n\n- Deliverable A\n- Deliverable B\n\n## Investment\n\n$ amount, broken down.\n\n## Timeline\n\nMilestones and dates.\n`;
    case "contract":
      return `# ${title}\n\n## Parties\n\nClient and provider.\n\n## Scope\n\nWhat we will deliver, and what is excluded.\n\n## Payment Terms\n\nDeposit, milestones, final payment.\n\n## Termination\n\nHow either party can exit.\n`;
    case "sow":
      return `# ${title}\n\n## Scope of Work\n\nSpecific tasks and deliverables.\n\n## Assumptions\n\nWhat must be true for this SOW to be accurate.\n\n## Out of Scope\n\nWhat we are explicitly NOT doing.\n`;
    case "change_order":
      return `# ${title}\n\n## Original Scope Reference\n\nLink to the original SOW or proposal.\n\n## Change Summary\n\nWhat is changing.\n\n## Adjusted Cost\n\nAdditional investment.\n\n## Adjusted Timeline\n\nNew dates.\n`;
  }
}

export async function updateStatus(
  docId: string,
  status: DocumentStatus,
  whenISO?: string
): Promise<DocumentRecord | null> {
  const rec = await getDocument(docId);
  if (!rec) return null;
  const stamp = whenISO ?? new Date().toISOString();
  rec.meta.status = status;
  if (status === "sent" && !rec.meta.sent_at) rec.meta.sent_at = stamp;
  if (status === "accepted") {
    if (!rec.meta.accepted_at) rec.meta.accepted_at = stamp;
    if (!rec.meta.sent_at) rec.meta.sent_at = stamp;
  }
  await writeRecord(rec);
  return rec;
}

export async function createNewVersion(docId: string): Promise<DocumentRecord | null> {
  const prev = await getDocument(docId);
  if (!prev) return null;
  // Mark previous as superseded
  prev.meta.status = "superseded";
  await writeRecord(prev);

  const meta: DocumentFrontmatter = {
    doc_id: randomUUID(),
    type: prev.meta.type,
    client: prev.meta.client,
    version: prev.meta.version + 1,
    status: "draft",
    title: prev.meta.title,
    summary: prev.meta.summary,
    amount_usd: prev.meta.amount_usd,
    created_at: new Date().toISOString(),
    supersedes: prev.meta.doc_id,
  };
  const dir = await clientTypeDir(prev.meta.client, prev.meta.type);
  const filePath = path.join(dir, buildFilename(meta));
  const next: DocumentRecord = { meta, body: prev.body, filePath };
  await writeRecord(next);
  return next;
}
