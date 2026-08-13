// packages/markdown — pure markdown parsing (frontmatter + wikilinks) for the Knowledge layer.
//
// Framework-agnostic and side-effect-free: it takes STRINGS and returns structured data. It performs
// NO filesystem access and imports no Next / app / core / engine code (package purity). `core/vault`
// reads the bytes; this module parses them; the indexer (Phase 4.2) consumes the result. It consolidates
// the previously-scattered gray-matter usage into one owner and adds wikilink extraction (net-new).

import matter from "gray-matter";

export type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Distinct `[[wikilink]]` targets found in the body (alias / heading suffixes stripped). */
  wikilinks: string[];
};

// [[Target]] · [[Target|alias]] · [[Target#heading]]  → captures "Target"
const WIKILINK_RX = /\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g;

/** Extract distinct wikilink targets from text. Pure. */
export function extractWikilinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(WIKILINK_RX)) {
    const target = m[1]?.trim();
    if (target) out.add(target);
  }
  return [...out];
}

/** Parse raw markdown → frontmatter + body + wikilinks. Pure; no fs. */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const parsed = matter(raw);
  const body = parsed.content;
  return {
    frontmatter: parsed.data as Record<string, unknown>,
    body,
    wikilinks: extractWikilinks(body),
  };
}
