// app/console — THE ACTION SURFACE.
//
// Console answers ONE question: "how do I safely execute the thing I have decided to do?" It never
// answers "what should I do" — that is Decision's job, and nothing here ranks, recommends, or
// interprets. It is the control surface of the Neural Core, not a terminal: no prompt caret as
// decoration, no monospace wall, no shell metaphor.
//
// It remains a COMPOSITION SURFACE and a capability owner of nothing (CON-1):
//   • Face 1 (objects)  : core/knowledge index → packages/search.query() → shared routing.
//   • Face 2 (commands) : core/command-runtime catalog → packages/commands.matchCommands()
//                         → explicit invocation via core/command-runtime.runCommand()
//                         → navigation commands resolved via the shared presentation router.
// It computes NO relevance, NO command matching, and NO command logic; it discovers and invokes
// only. Discovery never executes anything; execution is always explicit.
//
// THE CONFIRM GATE IS THE INVARIANT. GET performs preview (read-only, no write, no event). The
// single POST Server Action performs the confirmed write. That asymmetry is the whole safety model
// and this file adds nothing that competes with it.
//
// THREE OUTCOMES, KEPT DISTINCT: applied · no change · failed. Only an OBSERVED event produces the
// "event emitted" line and the entity destinations — see actions.ts for why that is authoritative
// and why a no-op honestly offers nothing.

import Link from "next/link";
import type { Metadata } from "next";
import { buildKnowledgeIndex, UNSCOPED_INTERNAL_INDEX } from "@/core/knowledge";
import { query, type SearchResult } from "@/packages/search";
import { objectHref, routeForEntity } from "@/navigation/routing";
import { matchCommands, type CommandMetadata, type CommandResult } from "@/packages/commands";
import { listCommands, runCommand } from "@/core/command-runtime";
import { focusHrefFor } from "@/graph-view/contract";
import { NODE_VISUAL, displayLabel } from "@/graph-view/taxonomy";
import { confirmMutation } from "./actions";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import { INPUT_CLASS } from "@/components/primitives/form";
import {
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";
import type { EntityKind } from "@/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Console · Ascend OS" };

/** Command kind → tone. A lookup on the catalog's own word; it classifies nothing. */
const KIND_TONE: Record<string, Tone> = {
  mutation: "risk",
  read: "neutral",
  navigation: "neutral",
};

/** What each kind's invocation does, stated in the operator's language rather than the system's. */
const KIND_NOTE: Record<string, string> = {
  mutation: "writes to the vault · requires confirmation",
  read: "reads only",
  navigation: "resolves to a route",
};

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

type SearchParams = {
  q?: string;
  run?: string;
  nav?: string;
  arg?: string;
  prev?: string;
  outcome?: string;
  error?: string;
  eventType?: string;
  subjectEntity?: string;
  subjectId?: string;
  subjectClient?: string;
};

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
  const items = term ? toConsoleResults(query((await buildKnowledgeIndex(UNSCOPED_INTERNAL_INDEX)).search, term)) : [];

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

  // Does the preview say confirming would actually change anything? The producer's own flag.
  const previewChanges =
    previewResult?.ok === true &&
    (previewResult.data as { changes?: boolean } | undefined)?.changes === true;

  // ── The affected entity, resolved ONLY from an observed event (see actions.ts) ────────────────
  const subjectEntity = sp.subjectEntity as EntityKind | undefined;
  const subjectId = sp.subjectId;
  const subjectHref = subjectEntity && subjectId ? routeForEntity(subjectEntity, subjectId) : null;
  const subjectFocusHref = subjectEntity && subjectId ? focusHrefFor(subjectEntity, subjectId) : null;
  const clientHref = sp.subjectClient ? routeForEntity("client", sp.subjectClient) : null;

  return (
    // The Neural Core's own teal: Console is its control surface, not a separate application.
    <PageShell hue="var(--color-neural)">
      <SurfaceHeader
        eyebrow="Command"
        title="Console"
        lede="Find an object, or run a command against one. Anything that writes to the vault shows you what it will do first."
      />

      {/* ── INPUT ────────────────────────────────────────────────────────────────────────────
          One quiet line. Not a prompt, not a terminal — the field is the plainest thing here,
          because the consequences below are what deserve the operator's attention. */}
      <section className="mb-12">
        <form method="get" className="flex items-center gap-3">
          <input
            name="q"
            defaultValue={term}
            placeholder="Search objects, or type a command…"
            aria-label="Search objects or commands"
            // Auto-focus ONLY when the operator arrived to start something. After a preview or a
            // completed mutation, stealing focus into the search box would move a keyboard or
            // screen-reader user away from the outcome they came back to read — and it also
            // silently skipped past the skip-to-content link.
            autoFocus={!outcome && !previewMeta}
            autoComplete="off"
            className={INPUT_CLASS}
          />
          <Button type="submit" variant="ghost">
            Search
          </Button>
        </form>
        {term.length === 0 && (
          <p className="t-meta mt-3 text-[var(--color-t3)]">
            {catalog.length} commands available. Type to match, or press ⌘K anywhere in Ascend for
            the same search.
          </p>
        )}
      </section>

      {/* ── RESULT ───────────────────────────────────────────────────────────────────────────
          What just happened, and where it happened. This sits above everything because after a
          confirmed write it is the only thing the operator is looking for. */}
      {outcome && (
        <section className="mb-12">
          <SectionLabel tier="decision">Result</SectionLabel>

          <div className="border-l border-[var(--color-line-strong)] pl-5">
            {outcome === "applied" && (
              <>
                <p className="t-h2 text-[var(--color-good)]">Applied</p>
                <p className="t-body mt-1.5 max-w-[68ch] text-[var(--color-t2)]">
                  The command completed and the vault was written.
                </p>
              </>
            )}
            {outcome === "noop" && (
              <>
                <p className="t-h2 text-[var(--color-t1)]">No change</p>
                <p className="t-body mt-1.5 max-w-[68ch] text-[var(--color-t2)]">
                  The vault was already in that state, so nothing was written and no event was
                  emitted.
                </p>
              </>
            )}
            {outcome === "error" && (
              <>
                <p className="t-h2 text-[var(--color-risk)]">Failed</p>
                {/* The runtime's own typed error, verbatim. It is already operator-safe — the
                    runtime normalises every throw into a message — so it is neither swallowed
                    nor replaced with a generic banner. */}
                <p className="t-body mt-1.5 max-w-[68ch] text-[var(--color-t2)]">
                  {sp.error ?? "The command did not complete."}
                </p>
              </>
            )}

            {/* The event is the evidence. It appears only when one was actually observed. */}
            {sp.eventType && (
              <p className="t-mono mt-3 text-[var(--color-t3)]">↳ event emitted · {sp.eventType}</p>
            )}

            {/* ── AFFECTED ENTITY ──────────────────────────────────────────────────────────
                Destinations derived from the emitted event's subject, through the canonical
                owners. Absent for a no-op, because no event means no authoritative subject. */}
            {(subjectHref || clientHref || subjectFocusHref) && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* Deliberately NOT accent. Accent on this page means "this writes" — and after the
                    write, navigating to the affected entity writes nothing. The committing button
                    below is the only accent affordance Console ever shows. */}
                {subjectHref && (
                  <Link href={subjectHref} className="contents">
                    <Button variant="ghost">Open {subjectEntity} →</Button>
                  </Link>
                )}
                {clientHref && (
                  <Link href={clientHref} className="contents">
                    <Button variant="ghost">Open client →</Button>
                  </Link>
                )}
                {subjectFocusHref && (
                  <Link
                    href={subjectFocusHref}
                    className="t-label text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-neural)]"
                  >
                    ◎ Focus in Neural Core
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── PREVIEW ──────────────────────────────────────────────────────────────────────────
          What WILL happen. Everything here is read-only; the single accent button below is the
          only thing on this page that writes. */}
      {previewMeta && (
        <section className="mb-12">
          <SectionLabel tier="decision" aside="requires confirmation">
            Preview
          </SectionLabel>

          <div className="border-l border-[var(--color-accent)]/45 pl-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="t-h2 text-[var(--color-t1)]">{previewMeta.label}</h3>
              <Badge tone="risk">mutation</Badge>
            </div>
            <p className="t-mono mt-1 text-[var(--color-t3)]">
              {previewMeta.id}
              {previewMeta.args[0] && arg && ` · ${previewMeta.args[0].name} ${arg}`}
            </p>

            {previewResult && !previewResult.ok ? (
              <p className="t-body mt-3 max-w-[68ch] text-[var(--color-risk)]">
                {previewResult.error}
              </p>
            ) : (
              previewResult && (
                <>
                  {/* The command's own description of the change, verbatim. The surface does not
                      paraphrase it and does not manufacture a before/after the handler did not
                      return — this string IS the handler's before → after statement. */}
                  <p className="t-body mt-3 max-w-[68ch] text-[var(--color-t1)]">
                    {previewResult.message}
                  </p>

                  <p className="t-meta mt-3 max-w-[68ch] text-[var(--color-t2)]">
                    {previewChanges
                      ? "Confirming writes to the vault and emits an event. Nothing has been written yet."
                      : "Confirming would make no change — the vault is already in that state."}
                  </p>

                  {/* POST-only confirm — the sole write trigger (DC-5x.4). */}
                  <form action={confirmMutation} className="mt-4 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="q" value={term} />
                    <input type="hidden" name="id" value={previewMeta.id} />
                    <input type="hidden" name="argName" value={previewMeta.args[0]?.name ?? ""} />
                    <input type="hidden" name="arg" value={arg} />
                    {/* Accent ONLY when confirming would actually write. When the producer says
                        the vault is already in that state, the button still works (idempotent by
                        design) but it is not a committing action, so it does not claim to be. */}
                    <Button type="submit" variant={previewChanges ? "primary" : "ghost"}>
                      Confirm {previewMeta.label.toLowerCase()}
                    </Button>
                    <span className="t-mono text-[var(--color-t3)]">POST · writes state</span>
                  </form>
                </>
              )
            )}
          </div>
        </section>
      )}

      {/* ── READ / NAVIGATION RESULT ─────────────────────────────────────────────────────── */}
      {(runResult || navResolution) && (
        <section className="mb-12">
          <SectionLabel tier="primary">Command output</SectionLabel>
          <div className="border-l border-[var(--color-line-strong)] pl-5">
            {runResult && (
              <p
                className="t-body max-w-[68ch]"
                style={{ color: runResult.ok ? "var(--color-t1)" : "var(--color-risk)" }}
              >
                {runResult.ok ? runResult.message : runResult.error}
              </p>
            )}
            {navResolution?.state === "needs-arg" && (
              <p className="t-body max-w-[68ch] text-[var(--color-t2)]">
                Enter a slug to resolve{" "}
                <span className="text-[var(--color-t1)]">{navResolution.meta.label}</span>.
              </p>
            )}
            {navResolution?.state === "resolved" && (
              <Link href={navResolution.href} className="contents">
                <Button variant="primary" autoFocus>
                  Go to {navResolution.meta.label.toLowerCase()} “{navResolution.arg}” →
                </Button>
              </Link>
            )}
            {navResolution?.state === "non-navigable" && (
              <p className="t-body max-w-[68ch] text-[var(--color-risk)]">
                “{navResolution.arg}” has no route for {navResolution.meta.nav?.entity} — that entity
                kind has no detail view yet.
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── COMMANDS ─────────────────────────────────────────────────────────────────────────
          The catalog, matched. A list of peers — each states what it does and what invoking it
          costs, so a mutation can never be mistaken for a read. */}
      {term && (
        <section className="mb-12">
          <SectionLabel tier="primary" aside={`${commandMatches.length} matched`}>
            Commands
          </SectionLabel>

          {commandMatches.length === 0 ? (
            <QuietEmpty>
              No command matches “{term}”. Commands are matched on their declared verbs — there is no
              fuzzy matching, so a near-miss finds nothing.
            </QuietEmpty>
          ) : (
            <ul className="flex flex-col">
              {commandMatches.map(({ metadata: m }) => {
                const spec = m.args[0];
                // navigation → resolve (nav) · read → run · mutation → preview (prev, read-only GET).
                const invoke = m.kind === "navigation" ? "nav" : m.kind === "mutation" ? "prev" : "run";
                const actionLabel =
                  m.kind === "navigation" ? "Resolve" : m.kind === "mutation" ? "Preview" : "Run";
                const isActive =
                  (invoke === "nav" && navId === m.id) ||
                  (invoke === "prev" && prevId === m.id) ||
                  (invoke === "run" && runId === m.id);
                return (
                  <li
                    key={m.id}
                    className="border-b border-[var(--color-line)] py-4 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="t-h2 min-w-0 text-[var(--color-t1)]">{m.label}</h3>
                      <Status tone={KIND_TONE[m.kind] ?? "neutral"}>{m.kind}</Status>
                    </div>
                    <p className="t-body mt-1 max-w-[68ch] text-[var(--color-t2)]">{m.description}</p>
                    <p className="t-mono mt-1.5 text-[var(--color-t3)]">
                      {KIND_NOTE[m.kind]} · {m.id}
                    </p>

                    <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="q" value={term} />
                      <input type="hidden" name={invoke} value={m.id} />
                      {spec && (
                        // `aria-label` rather than a visually-hidden <span>: a placeholder is not
                        // an accessible name, and an sr-only label is by definition clipped, which
                        // makes it indistinguishable from a real truncation defect in QA.
                        <input
                          name="arg"
                          aria-label={`${spec.description ?? spec.name} for ${m.label}`}
                          placeholder={spec.description ?? spec.name}
                          defaultValue={isActive ? arg : ""}
                          className={`${INPUT_CLASS} w-auto min-w-[180px]`}
                        />
                      )}
                      <Button type="submit" variant="ghost">
                        {actionLabel}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── OBJECTS ──────────────────────────────────────────────────────────────────────── */}
      {term && (
        <section>
          <SectionLabel tier="quiet" aside={`${items.length} found`}>
            Objects
          </SectionLabel>

          {items.length === 0 ? (
            <QuietEmpty>Nothing in the vault matches “{term}”.</QuietEmpty>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => {
                const focusHref = focusHrefFor(item.entity, item.result.id);
                return (
                  <li
                    key={`${item.entity}:${item.result.id}`}
                    className="flex items-center gap-3 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        background:
                          item.entity in NODE_VISUAL
                            ? NODE_VISUAL[item.entity as keyof typeof NODE_VISUAL].color
                            : "var(--color-t3)",
                      }}
                    />
                    <span className="t-label w-[74px] shrink-0 text-[var(--color-t3)]">
                      {item.entity}
                    </span>
                    <span className="t-body min-w-0 flex-1 text-[var(--color-t1)]">
                      {item.href ? (
                        <Link
                          href={item.href}
                          className="transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                        >
                          {displayLabel(item.label)}
                        </Link>
                      ) : (
                        displayLabel(item.label)
                      )}
                    </span>
                    {focusHref ? (
                      <Link
                        href={focusHref}
                        aria-label={`Focus ${displayLabel(item.label)} in the Neural Core`}
                        className="t-mono shrink-0 text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-neural)]"
                      >
                        ◎
                      </Link>
                    ) : (
                      <span className="t-mono shrink-0 text-[var(--color-t3)]">no detail route</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </PageShell>
  );
}