"use client";

// components/shell/CommandPalette — the ⌘K surface.
//
// REPLACES the previous components/CommandPalette.tsx, whose `inferCommand` regex layer was a
// SECOND, fuzzier command matcher sitting beside packages/commands.matchCommands. That duplication
// is exactly the pattern the architecture forbids, so it is deleted rather than restyled. All
// matching here happens server-side in the deterministic owners, via /api/console/search.
//
// Discovery never executes. Commands are shown, and mutations still route through the existing
// preview → explicit POST confirm gate in the Console — this palette does not create a fast path.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { displayLabel } from "@/graph-view/taxonomy";

type ObjectHit = {
  id: string;
  entity: string;
  title: string;
  /** Detail route, resolved server-side by navigation/routing. */
  href: string | null;
  /** Neural Core route with this object pre-selected, resolved server-side by the graph contract. */
  focusHref: string | null;
};
type CommandHit = { id: string; label: string; description: string; kind: string };
type Row =
  | { kind: "object"; hit: ObjectHit }
  | { kind: "command"; hit: CommandHit };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [objects, setObjects] = useState<ObjectHit[]>([]);
  const [commands, setCommands] = useState<CommandHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K toggle, plus an event so the nav rail's Search button can open it without this
  // component having to render a floating trigger that collides with page content.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("ascend:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ascend:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // Focus after paint so the input is actually mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setTerm("");
      setObjects([]);
      setCommands([]);
      setCursor(0);
    }
  }, [open]);

  // Debounced search against the existing deterministic matchers.
  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length === 0) {
      setObjects([]);
      setCommands([]);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/console/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setObjects(data.objects ?? []);
        setCommands(data.commands ?? []);
        setCursor(0);
      } catch {
        /* aborted or offline — leave the previous results in place */
      } finally {
        setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, open]);

  const rows: Row[] = [
    ...objects.map((hit) => ({ kind: "object" as const, hit })),
    ...commands.map((hit) => ({ kind: "command" as const, hit })),
  ];

  const activate = useCallback(
    (row: Row | undefined, intent: "open" | "focus" = "open") => {
      if (!row) return;
      if (row.kind === "object") {
        // Two destinations for the same object: its entity view, or itself inside the graph.
        // Both hrefs arrive finished from /api/console/search — the palette resolves neither, so
        // it holds no routing table and no graph model of its own.
        const target = intent === "focus" ? row.hit.focusHref : row.hit.href;
        if (target) {
          router.push(target);
          setOpen(false);
        }
        return;
      }
      // Commands are handed to the Console, which owns invocation and the confirmation gate.
      router.push(`/console?q=${encodeURIComponent(term)}`);
      setOpen(false);
    },
    [router, term]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // ⌘/Ctrl+Enter jumps into the Neural Core with the object selected, rather than opening its
      // entity view. Same row, same keystroke, one modifier — Graph and Entity are two views of one
      // object, so they are two intents on one action rather than two list items.
      activate(rows[cursor], e.metaKey || e.ctrlKey ? "focus" : "open");
    }
  };

  // The trigger lives in the nav rail (see NavRail). This component renders only the overlay, so it
  // never floats over page content.
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="anim-overlay w-full max-w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-e2)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-line)] px-4">
          <span aria-hidden className="t-mono text-[var(--color-accent)]">
            ›
          </span>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search clients, prospects, documents — or type a command"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
            className="t-body flex-1 bg-transparent py-3.5 text-[var(--color-t1)] placeholder:text-[var(--color-t3)] focus:outline-none"
          />
          {loading && <span className="t-label text-[var(--color-t3)]">…</span>}
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {term.trim().length === 0 && (
            <p className="t-meta px-4 py-3 text-[var(--color-t3)]">
              Type to search the vault. ↑↓ to move, ↵ to open, ⌘↵ to focus in the Neural Core, esc
              to close.
            </p>
          )}

          {term.trim().length > 0 && rows.length === 0 && !loading && (
            <p className="t-meta px-4 py-3 text-[var(--color-t3)]">No matches.</p>
          )}

          {objects.length > 0 && (
            <>
              <p className="t-section px-4 pb-1 pt-2 text-[var(--color-t3)]">Objects</p>
              <ul>
                {objects.map((hit, i) => (
                  <Row
                    key={hit.id}
                    active={cursor === i}
                    onSelect={() => activate(rows[i])}
                    onFocusInGraph={hit.focusHref ? () => activate(rows[i], "focus") : undefined}
                    tag={hit.entity}
                    title={displayLabel(hit.title)}
                    hint={hit.href ? undefined : "no detail route"}
                  />
                ))}
              </ul>
            </>
          )}

          {commands.length > 0 && (
            <>
              <p className="t-section px-4 pb-1 pt-2 text-[var(--color-t3)]">Commands</p>
              <ul>
                {commands.map((hit, i) => (
                  <Row
                    key={hit.id}
                    active={cursor === objects.length + i}
                    onSelect={() => activate(rows[objects.length + i])}
                    tag={hit.kind}
                    title={hit.label}
                    hint={hit.description}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One result.
 *
 * The graph action is a SIBLING button, not a nested one: a button inside a button is invalid HTML
 * and collapses to a single unusable control. Keyboard users reach the same destination with ⌘↵ on
 * the highlighted row, so this affordance exists for the pointer without adding a tab stop that
 * would double the length of the palette's focus order.
 */
function Row({
  active,
  onSelect,
  onFocusInGraph,
  tag,
  title,
  hint,
}: {
  active: boolean;
  onSelect: () => void;
  /** Omitted when the object cannot be a graph node — the affordance is then simply absent. */
  onFocusInGraph?: () => void;
  tag: string;
  title: string;
  hint?: string;
}) {
  return (
    <li
      className={`flex items-center transition-colors duration-[120ms] ${
        active ? "bg-[var(--color-surface-3)]" : "hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left"
      >
        <span className="t-label w-[74px] shrink-0 text-[var(--color-t3)]">{tag}</span>
        <span className="t-body min-w-0 flex-1 truncate text-[var(--color-t1)]">{title}</span>
        {hint && <span className="t-mono hidden shrink-0 text-[var(--color-t3)] sm:block">{hint}</span>}
      </button>
      {onFocusInGraph && (
        <button
          onClick={onFocusInGraph}
          tabIndex={-1}
          aria-label={`Focus ${title} in the Neural Core`}
          title="Focus in the Neural Core (⌘↵)"
          className="t-mono shrink-0 px-4 py-2 text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-neural)]"
        >
          ◎
        </button>
      )}
    </li>
  );
}