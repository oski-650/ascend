import Link from "next/link";
import { buildKnowledgeIndex } from "@/core/knowledge";
import { query, type SearchResult } from "@/packages/search";
import { objectHref, routeForEntity } from "@/navigation/routing";
import { matchCommands, type CommandMetadata, type CommandResult } from "@/packages/commands";
import { listCommands, runCommand } from "@/core/command-runtime";
import { confirmMutation } from "./actions";
import type { EntityKind } from "@/domain";

export const dynamic = "force-dynamic";

// Console — a COMPOSITION SURFACE, not a capability owner (CON-1). It composes independent capability
// owners into one keyboard-oriented interface and owns none of their logic:
//   • Face 1 (navigate objects): core/knowledge index → packages/search.query() → shared routing.
//   • Face 2 (typed commands):   core/command-runtime catalog → packages/commands.matchCommands()
//                                → explicit invocation via core/command-runtime.runCommand()
//                                → navigation commands resolved via the shared presentation router.
// The surface computes NO relevance, NO command matching, and NO command logic; it discovers and
// invokes only. Discovery never executes anything; execution is always explicit.

// ─── Face 1 (objects) ──────────────────────────────────────────────────────────────────────────────
type ConsoleResult = { href: string | null; label: string; entity: EntityKind; result: SearchResult };
function toConsoleResults(results: readonly SearchResult[]): ConsoleResult[] {
  return results.map((r) => ({ href: objectHref(r), label: r.title, entity: r.entity, result: r }));
}

// ─── Face 2 (commands) ───────────────────────────────────────────────────────────────────────────
/** Map the single explicit `arg` param onto the command's first declared argument (V1 supports ≤1 arg). */
function buildArgs(meta: CommandMetadata | undefined, arg: string): Record<string, string> {
  const spec = meta?.args[0];
  return spec && arg ? { [spec.name]: arg } : {};
}

type NavResolution =
  | { state: "needs-arg"; meta: CommandMetadata }
  | { state: "resolved"; meta: CommandMetadata; href: string; arg: string }
  | { state: "non-navigable"; meta: CommandMetadata; arg: string };

type SearchParams = { q?: string; run?: string; nav?: string; arg?: string; prev?: string; outcome?: string };

export default async function ConsolePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const arg = (sp.arg ?? "").trim();
  const runId = typeof sp.run === "string" ? sp.run : undefined;
  const navId = typeof sp.nav === "string" ? sp.nav : undefined;
  const prevId = typeof sp.prev === "string" ? sp.prev : undefined; // mutation preview (GET, read-only)
  const outcome = typeof sp.outcome === "string" ? sp.outcome : undefined; // post-confirm PRG banner

  const catalog = listCommands();
  const commandMatches = term ? matchCommands(catalog, term) : [];
  const items = term ? toConsoleResults(query((await buildKnowledgeIndex()).search, term)) : [];

  // Explicit invocation — read commands via the runtime; navigation commands surface-resolved.
  let runResult: CommandResult | null = null;
  if (runId) {
    runResult = await runCommand(runId, buildArgs(catalog.find((m) => m.id === runId), arg));
  }

  let navResolution: NavResolution | null = null;
  if (navId) {
    const meta = catalog.find((m) => m.id === navId);
    if (meta && meta.nav) {
      if (!arg) navResolution = { state: "needs-arg", meta };
      else {
        const href = routeForEntity(meta.nav.entity, arg); // presentation layer owns route resolution
        navResolution = href ? { state: "resolved", meta, href, arg } : { state: "non-navigable", meta, arg };
      }
    }
  }

  // Mutation PREVIEW (read-only, GET): describes the intended change; performs NO write and NO event.
  // The write happens solely via the POST confirm Server Action below (DC-5x.2 / DC-5x.4).
  const previewMeta = prevId ? catalog.find((m) => m.id === prevId && m.kind === "mutation") : undefined;
  const previewResult: CommandResult | null = previewMeta
    ? await runCommand(previewMeta.id, buildArgs(previewMeta, arg), { confirm: false })
    : null;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">console · navigate + commands</h1>

      <form method="get" className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 focus-within:border-[var(--color-accent)]/50">
        <span aria-hidden className="font-mono text-sm text-[var(--color-accent)]">›</span>
        <input
          name="q"
          defaultValue={term}
          placeholder="Search objects or type a command…"
          autoFocus
          autoComplete="off"
          className="flex-1 bg-transparent py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <button type="submit" className="font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-[var(--color-accent)]">↵</button>
      </form>

      {/* Typed command result (read) or resolved navigation (nav) */}
      {(runResult || navResolution) && (
        <section className="mt-4">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">command result</p>
          {runResult && (
            <div
              className={`rounded-md border p-3 text-sm ${
                runResult.ok
                  ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200"
                  : "border-rose-800/50 bg-rose-950/20 text-rose-200"
              }`}
            >
              {runResult.ok ? runResult.message : runResult.error}
            </div>
          )}
          {navResolution?.state === "needs-arg" && (
            <div className="rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3 text-sm text-zinc-400">
              Enter a slug to resolve <span className="text-zinc-200">{navResolution.meta.label}</span>.
            </div>
          )}
          {navResolution?.state === "resolved" && (
            <Link
              href={navResolution.href}
              autoFocus
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-accent)]/40 bg-zinc-950/40 p-3 text-sm text-zinc-100 hover:bg-zinc-900/40"
            >
              <span>Go to {navResolution.meta.label.toLowerCase()} “{navResolution.arg}”</span>
              <span aria-hidden className="font-mono text-[var(--color-accent)]">→</span>
            </Link>
          )}
          {navResolution?.state === "non-navigable" && (
            <div className="rounded-md border border-rose-800/50 bg-rose-950/20 p-3 text-sm text-rose-200">
              “{navResolution.arg}” has no route for {navResolution.meta.nav?.entity} (non-navigable).
            </div>
          )}
        </section>
      )}

      {/* Mutation — read-only preview + POST confirm (write). GET never writes. */}
      {previewMeta && (
        <section className="mt-4">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            confirm mutation · {previewMeta.label.toLowerCase()}
          </p>
          {outcome && (
            <div
              className={`mb-2 rounded-md border p-2.5 text-xs ${
                outcome === "applied"
                  ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-200"
                  : outcome === "noop"
                    ? "border-zinc-700/60 bg-zinc-900/40 text-zinc-300"
                    : "border-rose-800/50 bg-rose-950/20 text-rose-200"
              }`}
            >
              {outcome === "applied" ? "✓ Applied." : outcome === "noop" ? "• No change (already in that state)." : "✗ Command failed."}
            </div>
          )}
          {previewResult && !previewResult.ok && (
            <div className="rounded-md border border-rose-800/50 bg-rose-950/20 p-3 text-sm text-rose-200">{previewResult.error}</div>
          )}
          {previewResult && previewResult.ok && (
            <div className="rounded-md border border-amber-800/50 bg-amber-950/10 p-3">
              <p className="text-sm text-zinc-200">{previewResult.message}</p>
              {/* POST-only confirm — the sole write trigger (DC-5x.4). */}
              <form action={confirmMutation} className="mt-2.5 flex items-center gap-2">
                <input type="hidden" name="q" value={term} />
                <input type="hidden" name="id" value={previewMeta.id} />
                <input type="hidden" name="argName" value={previewMeta.args[0]?.name ?? ""} />
                <input type="hidden" name="arg" value={arg} />
                <button
                  type="submit"
                  className="rounded border border-amber-700/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-200 hover:border-amber-500 hover:text-amber-100"
                >
                  confirm
                </button>
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">POST · writes state</span>
              </form>
            </div>
          )}
        </section>
      )}

      {/* Face 2 — commands */}
      {term && commandMatches.length > 0 && (
        <section className="mt-5">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            commands · {commandMatches.length}
          </p>
          <ul className="flex flex-col gap-1.5">
            {commandMatches.map(({ metadata: m }) => {
              const spec = m.args[0];
              // navigation → resolve (nav) · read → run · mutation → preview (prev, read-only GET).
              const invoke = m.kind === "navigation" ? "nav" : m.kind === "mutation" ? "prev" : "run";
              const actionLabel = m.kind === "navigation" ? "resolve" : m.kind === "mutation" ? "preview" : "run";
              return (
                <li key={m.id} className="rounded-md border border-zinc-800/50 bg-zinc-950/40 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-zinc-100">{m.label}</span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-600">{m.kind}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{m.description}</p>
                  <form method="get" className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="q" value={term} />
                    <input type="hidden" name={invoke} value={m.id} />
                    {spec && (
                      <input
                        name="arg"
                        placeholder={spec.description ?? spec.name}
                        defaultValue={(invoke === "nav" && navId === m.id) || (invoke === "prev" && prevId === m.id) ? arg : ""}
                        className="flex-1 rounded border border-zinc-800/60 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-[var(--color-accent)]/50 focus:outline-none"
                      />
                    )}
                    <button
                      type="submit"
                      className="rounded border border-zinc-800/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
                    >
                      {actionLabel}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Face 1 — objects */}
      {term && (
        <section className="mt-5">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            objects · {items.length}
          </p>
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => {
              const row = (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{item.label}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-600">{item.entity}</span>
                </>
              );
              return (
                <li key={`${item.entity}:${item.result.id}`}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 rounded-md border border-transparent bg-zinc-950/40 px-3 py-2 transition-colors hover:border-[var(--color-accent)]/40 hover:bg-zinc-900/40"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-transparent bg-zinc-950/40 px-3 py-2 opacity-70">
                      {row}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}