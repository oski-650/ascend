// app/search — RETIRED.
//
// It owned no capability. It was a strict subset of the Console's object face: the same
// `core/knowledge.buildKnowledgeIndex()` → `packages/search.query()` → `navigation/routing`
// composition, rendered a second time. Nothing linked to it — not the NavRail, not any page — so it
// was reachable only by typing the URL, while search itself lives in ⌘K (which calls the identical
// chain through /api/console/search).
//
// Three surfaces over one composition is two too many. Search is a system-wide capability reachable
// from anywhere via ⌘K; the Console remains its full-page form because it also owns command
// invocation and the mutation confirm gate, which a palette deliberately does not.
//
// The route is kept as a permanent redirect so any bookmark still resolves. `?q=` is forwarded, so
// an existing search URL lands on the same results rather than an empty Console.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  redirect(term ? `/console?q=${encodeURIComponent(term)}` : "/console");
}