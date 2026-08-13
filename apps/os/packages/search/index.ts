// packages/search — pure navigation-relevance query over KnowledgeIndex.search (Phase 4.3).
//
// Framework-agnostic, fs-free, deterministic. It answers "how well does this object match the typed
// text?" (NAVIGATION relevance) — never "what is most important?" (that is Decision's PRIORITY ranking,
// KI-3). It imports NO fs / Next / core / engines / app; it lives BELOW engines, so a dependency on
// engines/decision is structurally impossible. Same (docs, query) → identical results — no clock, no
// randomness, no hidden state.

import type { SearchDocument } from "@/packages/indexer";
import type { EntityKind } from "@/domain";

export type SearchResult = {
  id: string;
  entity: EntityKind;
  title: string;
  score: number;
};

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

/** Lowercase alphanumeric tokens. Pure. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Deterministic navigation-relevance query over the index's search documents.
 * Score = Σ over distinct query terms of (TITLE_WEIGHT if the term is a title token) +
 *         (BODY_WEIGHT if the term is a document-text token). Positive-scoring docs only.
 * Stable sort: score descending, then title ascending, then id ascending.
 */
export function query(docs: readonly SearchDocument[], q: string): SearchResult[] {
  const terms = [...new Set(tokenize(q))];
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];
  for (const doc of docs) {
    const titleTokens = new Set(tokenize(doc.title));
    const textTokens = new Set(tokenize(doc.text));
    let score = 0;
    for (const term of terms) {
      if (titleTokens.has(term)) score += TITLE_WEIGHT;
      if (textTokens.has(term)) score += BODY_WEIGHT;
    }
    if (score > 0) results.push({ id: doc.id, entity: doc.entity, title: doc.title, score });
  }

  results.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  );
  return results;
}
