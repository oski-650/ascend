// core/vault/io.ts — shared filesystem primitives for vault + sidecar data.
// Conventions inherited from the existing lib modules:
//   - reads are TOLERANT (skip malformed lines / missing files — never crash on bad input)
// Integrity is enforced on write, reconciled on read (Part IV §IV.6).
//
// SCOPE: only the primitives with a current Phase-1 consumer live here (second-consumer
// rule). Markdown read/write, atomic file writes, and md listing are introduced in Phase 2
// when core/crm / core/production actually need them.

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function readJsonFile<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Tolerant JSONL read: skips blank/malformed lines; missing file ⇒ empty list. */
export async function readJsonlFile<T>(absPath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch {
    return [];
  }
  if (!raw.trim()) return [];
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      /* skip malformed — reconciled, not fatal */
    }
  }
  return out;
}

/** Append one JSONL line, creating the directory/file as needed. */
export async function appendJsonlLine(absPath: string, entry: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.appendFile(absPath, JSON.stringify(entry) + "\n", "utf8");
}

/** List subdirectories, skipping `_template`/hidden dirs (the vault convention). */
export async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
