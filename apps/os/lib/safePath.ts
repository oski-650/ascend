// lib/safePath.ts — PURE path-containment algebra (hardening pass).
//
// SCOPE: string/path validation only. It performs NO filesystem access, holds NO vault knowledge
// (the root is always passed in by the caller), owns NO read-model, and participates in NO frozen
// contract. It exists so that call sites which join user-controlled input into a path can assert
// one invariant:
//
//   User-controlled input must never resolve outside the intended root.
//
// Two independent layers, because either alone is insufficient:
//   • isSafeSegment() rejects a segment before it is ever joined (traversal, separators, absolute
//     paths, NUL, Windows drive letters, dotfiles).
//   • resolveWithin() re-checks the RESOLVED result against the RESOLVED root, which catches
//     anything the segment check missed and is the check that actually enforces the invariant.

import path from "node:path";

/**
 * Is `segment` safe to use as a single path component?
 *
 * Rejects: empty/whitespace, `.` and `..`, anything containing a path separator, absolute paths,
 * NUL bytes, Windows drive prefixes, and leading dots (hidden files / the `.ascend-os` sidecar).
 * Deliberately strict — a legitimate client slug or document type never needs any of these.
 */
export function isSafeSegment(segment: unknown): segment is string {
  if (typeof segment !== "string") return false;
  const s = segment.trim();
  if (s.length === 0 || s.length > 255) return false;
  if (s === "." || s === "..") return false;
  if (s.startsWith(".")) return false; // no dotfiles, no `.ascend-os` sidecar access
  if (s.includes("\0")) return false;
  if (s.includes("/") || s.includes("\\")) return false;
  if (path.isAbsolute(s)) return false;
  if (/^[a-zA-Z]:/.test(s)) return false; // Windows drive prefix
  return true;
}

/**
 * Join `segments` under `root` and return the absolute result ONLY if it stays inside `root`.
 * Returns null on any violation — callers treat null as "reject the request", never as "use root".
 *
 * The containment test compares resolved paths with a trailing separator so that a sibling
 * directory sharing a name prefix (`/vault-evil` vs `/vault`) cannot pass as contained.
 */
export function resolveWithin(root: string, ...segments: string[]): string | null {
  for (const segment of segments) {
    if (!isSafeSegment(segment)) return null;
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);

  if (candidate === resolvedRoot) return candidate;
  if (candidate.startsWith(resolvedRoot + path.sep)) return candidate;
  return null;
}

/**
 * Assert that an ALREADY-BUILT absolute path lies within `root`. For call sites whose path was
 * assembled elsewhere (e.g. by a frozen path resolver) and which want a containment guarantee
 * without re-deriving the path themselves.
 */
export function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}