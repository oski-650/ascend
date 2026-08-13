import Link from "next/link";
import { buildKnowledgeIndex } from "@/core/knowledge";
import { query } from "@/packages/search";
import { objectHref } from "@/navigation/routing";

export const dynamic = "force-dynamic";

// Approved composition path (D-4.3.1): the surface requests the index (core/knowledge) and invokes
// packages/search.query(); it computes NO relevance itself and renders/navigates only.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const results = term ? query((await buildKnowledgeIndex()).search, term) : [];

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">knowledge · search</h1>

      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={term}
          placeholder="Search clients, prospects, SOPs…"
          autoFocus
          className="flex-1 rounded-md border border-zinc-800/60 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[var(--color-accent)]/50 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-800/60 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
        >
          search
        </button>
      </form>

      {term && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {results.length} result{results.length === 1 ? "" : "s"} for “{term}”
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {results.map((r) => {
          const href = objectHref(r);
          const row = (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{r.title}</span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                {r.entity} · {r.score}
              </span>
            </>
          );
          return (
            <li key={`${r.entity}:${r.id}`}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-3 transition-colors hover:border-[var(--color-accent)]/40"
                >
                  {row}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-3">
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
