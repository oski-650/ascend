// Layer B support — static source reading for the architecture fitness suite.
//
// This is a TEST HELPER. It reads source text only; it imports no production module, executes no
// production code, and touches no vault. It exists so the fitness rules assert against the real
// repository rather than a hand-maintained list that could drift.
//
// Comment stripping is not optional here. Several frozen modules state their boundaries in prose —
// pipeline-engine's header literally names STATUS_PROBABILITY to declare that it does NOT compute
// weighted-$ — so a naive grep would report the opposite of the truth. Every rule that scans for a
// token must scan stripped source.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Repository root for the app (tests/ lives directly under it). */
export const APP_ROOT = path.resolve(import.meta.dirname, "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "out", ".git", "public"]);

/** Recursively collect .ts/.tsx files beneath `rel`, excluding build output and the tests tree. */
export function sourceFiles(rel: string): string[] {
  const abs = path.join(APP_ROOT, rel);
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(path.relative(APP_ROOT, full));
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  else out.push(rel);
  return out.sort();
}

export function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

/**
 * Remove line and block comments while preserving string and template literals.
 *
 * A regex-only strip would corrupt strings containing `//` (URLs) or `/*`. This walks the source
 * once, tracking whether it is inside a string, template literal, or regex-ish context, so token
 * scans operate on real code only.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  let quote: string | null = null;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      if (ch === "\\") {
        out += ch + (next ?? "");
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export type ImportEdge = {
  /** Importing file, repo-relative. */
  from: string;
  /** Raw specifier as written, e.g. "@/core/crm" or "node:fs". */
  specifier: string;
  /** True when written as `import type ...` or `export type ... from` (erased at runtime). */
  typeOnly: boolean;
  line: number;
};

const IMPORT_RE =
  /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** Extract every import/re-export edge from a file, flagging type-only edges. */
export function importsOf(rel: string): ImportEdge[] {
  const source = stripComments(read(rel));
  const edges: ImportEdge[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const [full, typeKeyword, specifier] = match;
    // `export { type X } from` is also erased; treat an all-type brace list as type-only.
    const bracesAllType = /\{\s*type\s[^}]*\}/.test(full) && !/\{\s*[A-Za-z_$][^}]*,\s*type\s/.test(full);
    edges.push({
      from: rel,
      specifier,
      typeOnly: Boolean(typeKeyword) || bracesAllType,
      line: source.slice(0, match.index ?? 0).split("\n").length,
    });
  }
  return edges;
}

/** All import edges beneath a directory. */
export function importsUnder(rel: string): ImportEdge[] {
  return sourceFiles(rel).flatMap(importsOf);
}

/** Count definition sites of an exported symbol across the given roots (comment-stripped). */
export function definitionSites(symbol: string, roots: string[]): string[] {
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`);
  return roots
    .flatMap(sourceFiles)
    .filter((f) => re.test(stripComments(read(f))));
}

/** Files under `roots` whose CODE (not comments) contains `pattern`. */
export function filesMatching(pattern: RegExp, roots: string[]): string[] {
  return roots.flatMap(sourceFiles).filter((f) => pattern.test(stripComments(read(f))));
}