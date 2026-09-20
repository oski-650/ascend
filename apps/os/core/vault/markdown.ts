// core/vault/markdown.ts — markdown + md-listing + write primitives.
// Approved Phase-2 sibling; core/vault/io.ts remains FROZEN. Reads (2.1), markdown/json
// writes (2.2), and byte-faithful raw text read/write (2.3) — each added only when a real
// consumer required it (second-consumer rule).

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type MarkdownFile = {
  frontmatter: Record<string, unknown>;
  body: string;
  missing: boolean;
};

/** Tolerant markdown+frontmatter read: a missing/unreadable file returns `missing: true`. */
export async function readMarkdownFile(absPath: string): Promise<MarkdownFile> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const parsed = matter(raw);
    return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content.trim(), missing: false };
  } catch {
    return { frontmatter: {}, body: "", missing: true };
  }
}

/**
 * Parse a markdown STRING the same way `readMarkdownFile` parses a file.
 *
 * Exists so a writer can inspect the frontmatter of markdown it is about to persist without first
 * writing it, using the identical parser — a second, hand-rolled frontmatter reader would be a
 * second source of truth about what a file says.
 */
export function readMarkdownString(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const parsed = matter(raw);
  return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
}

/** List markdown files in a dir, skipping `_`/hidden/README (the vault convention). */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".md") &&
          !e.name.startsWith("_") &&
          !e.name.startsWith(".") &&
          e.name !== "README.md"
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Atomic markdown+frontmatter write (write-then-rename); creates parent dirs. */
export async function writeMarkdownFileAtomic(
  absPath: string,
  frontmatter: Record<string, unknown>,
  body: string
): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = absPath + ".tmp";
  await fs.writeFile(tmp, matter.stringify(body, frontmatter), "utf8");
  await fs.rename(tmp, absPath);
}

/** Atomic JSON write (write-then-rename); creates parent dirs. */
export async function writeJsonFileAtomic(absPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = absPath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, absPath);
}

// ─── Byte-faithful raw text (Phase 2.3 — consumers: createProject, toggleChecklistItem,
//     and the time-log whole-file rewrite). Preserves exact bytes; no re-serialization. ───

/** Raw text read: returns the file's exact contents, or `null` if missing/unreadable. */
export async function readTextFile(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Atomic raw-string write (write-then-rename); creates parent dirs. Byte-for-byte. */
export async function writeFileAtomic(absPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = absPath + ".tmp";
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, absPath);
}

/**
 * Read a markdown file, distinguishing ABSENT from UNREADABLE (D1a).
 *
 * `readMarkdownFile` maps every failure to `{ missing: true }`, which is right for a reader — a page
 * that cannot read a file has nothing to show either way. It is dangerous for a WRITER. Promotion
 * used it and then wrote the file back: an iCloud file that had not downloaded, or any transient
 * EACCES/EIO, read as "missing", and the write replaced a real prospect with a two-line stub,
 * destroying its `prospect_id`, name and body. Measured in the D1 pre-flight probe (P6).
 *
 * So a writer asks this instead: ENOENT is absence, and anything else is an error it must not paper
 * over.
 */
export async function readMarkdownFileStrict(absPath: string): Promise<MarkdownFile> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const parsed = matter(raw);
    return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content.trim(), missing: false };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { frontmatter: {}, body: "", missing: true };
    }
    throw e;
  }
}
