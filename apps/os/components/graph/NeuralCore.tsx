"use client";

// components/graph/NeuralCore — the home experience.
//
// The graph is the ground plane; five elements float over it with intent (docs §2.7). This is a
// pure presentation component: it receives GraphModel + already-ranked PriorityItems as props and
// imports NOTHING from core/, lib/, engines/, or graph-view/projection. That isolation is what
// makes the projection swappable for the real indexer without touching the UI.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PriorityItem } from "@/engines/decision-engine";
import type { GraphModel } from "@/graph-view/contract";
import { DETAIL_LABEL, NODE_VISUAL, displayLabel, type DetailLevel } from "@/graph-view/taxonomy";
import { routeForEntity } from "@/navigation/routing";
import { useRouter } from "next/navigation";
import { syncVault, type SyncOutcome } from "@/app/sync-vault";
import { Button } from "@/components/primitives";
import { GraphCanvas } from "./GraphCanvas";
import { ContextPanel } from "./ContextPanel";

type Props = {
  model: GraphModel;
  priorityItems: PriorityItem[];
  metrics: { key: string; label: string; value: string; sub?: string }[];
  operatorDate: string;
  /** A GraphNode.id to pre-select — how an entity view hands context back to the graph. */
  initialFocusId?: string | null;
};

const DETAIL_ORDER: DetailLevel[] = ["core", "artifacts", "full"];

export function NeuralCore({ model, priorityItems, metrics, operatorDate, initialFocusId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusId ?? null);
  const [detail, setDetail] = useState<DetailLevel>("artifacts");
  const [ticker, setTicker] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<SyncOutcome | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // Reduced motion is honored at runtime, and reacts to the user changing it mid-session.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /**
   * Touch/compact is a DIFFERENT design, not a shrunk desktop (§16): the graph drops to the `core`
   * subgraph so nodes are large enough to tap, the legend collapses behind a toggle, and the
   * attention column becomes a bottom sheet instead of disappearing.
   */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      setCompact(mq.matches);
      if (mq.matches) setDetail("core");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const selected = useMemo(
    () => (selectedId ? (model.nodes.find((n) => n.id === selectedId) ?? null) : null),
    [selectedId, model.nodes]
  );

  // Only REAL events reach the ticker. Ambient activity cannot call this — it has no label and
  // never invokes onRealPulse (see simulation.ts).
  const handleRealPulse = useCallback((label: string) => {
    setTicker(label);
  }, []);

  const fitGraph = useCallback(() => window.dispatchEvent(new CustomEvent("ascend:fit-graph")), []);

  /**
   * Reconcile the vault. The server action owns everything; this only reflects the outcome.
   * `router.refresh()` re-reads the surfaces after memory has been appended to.
   */
  const runSync = useCallback(async () => {
    setSyncing(true);
    setSync(null);
    try {
      const outcome = await syncVault();
      setSync(outcome);
      if (outcome.ok && (outcome.changes.length > 0 || outcome.summary !== "No state changes detected.")) {
        router.refresh();
      }
    } finally {
      setSyncing(false);
    }
  }, [router]);

  // Esc deselects · F re-frames the graph.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /input|textarea/i.test(e.target.tagName);
      if (e.key === "Escape" && selectedId) setSelectedId(null);
      if (e.key.toLowerCase() === "f" && !typing && !e.metaKey && !e.ctrlKey) fitGraph();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, fitGraph]);

  const subjectNode = useCallback(
    (entity: string, id: string) => model.nodes.find((n) => n.entity === entity && n.entityId === id) ?? null,
    [model.nodes]
  );

  const legendTypes = useMemo(() => {
    const present = new Set(model.nodes.map((n) => n.type));
    return [...present];
  }, [model.nodes]);

  return (
    // `data-fullbleed` opts this page out of the shell's legacy max-width column
    // (see .ascend-main in globals.css) — the graph is a working canvas, not a document.
    <div
      data-fullbleed
      className="relative h-[calc(100vh-0px)] w-full overflow-hidden bg-[var(--color-bg-deep)]"
    >
      {/* ── The graph: the ground plane ──────────────────────────────────────────────────── */}
      <GraphCanvas
        model={model}
        detail={detail}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRealPulse={handleRealPulse}
        reducedMotion={reducedMotion}
      />

      {/* ── Header: identity + system status + three quiet numbers ───────────────────────── */}
      {/* `pl-16` on small screens clears the fixed nav-drawer button in the top-left. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-4 pl-16 md:pl-4 lg:p-7">
        <div className="pointer-events-auto min-w-0">
          <h1 className="t-h1 text-[var(--color-t1)]">Neural Core</h1>
          <p className="t-mono mt-1 text-[var(--color-t3)]">
            {operatorDate} · {model.source.nodeCount} objects · {model.source.edgeCount} relationships
          </p>
        </div>

        <div className="pointer-events-auto hidden gap-8 md:flex">
          {metrics.slice(0, 3).map((m) => (
            <div key={m.key} className="text-right">
              <p className="t-metric text-[var(--color-t1)]">{m.value}</p>
              <p className="t-label mt-0.5 text-[var(--color-t3)]">{m.label}</p>
            </div>
          ))}
        </div>
      </header>

      {/* ── Attention: a bottom sheet on compact screens ──────────────────────────────────────
          The Decision-ranked feed is the single most important thing on this page, so on mobile it
          gets a persistent, collapsed entry point rather than being hidden. */}
      {compact && priorityItems.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 lg:hidden">
          <div className="pointer-events-auto border-t border-[var(--color-line-strong)] bg-[var(--color-surface)]/97 backdrop-blur-xl">
            <button
              onClick={() => setAttentionOpen((o) => !o)}
              aria-expanded={attentionOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-3"
            >
              <span className="t-section text-[var(--color-t3)]">Needs you now</span>
              <span className="flex items-center gap-2">
                <span className="t-mono text-[var(--color-accent)]">{priorityItems.length}</span>
                <span aria-hidden className="t-mono text-[var(--color-t3)]">
                  {attentionOpen ? "▾" : "▴"}
                </span>
              </span>
            </button>
            {attentionOpen && (
              <ol className="max-h-[46vh] overflow-y-auto border-t border-[var(--color-line)] px-4 pb-4 pt-3">
                {priorityItems.slice(0, 5).map((item) => {
                  const node = subjectNode(item.subject.entity, item.subject.id);
                  const href = routeForEntity(item.subject.entity, item.subject.id);
                  return (
                    <li key={`${item.subject.entity}:${item.subject.id}`} className="mb-3.5 last:mb-0">
                      <div className="flex items-baseline gap-2">
                        <span className="t-mono text-[var(--color-accent)]">
                          {String(item.rank).padStart(2, "0")}
                        </span>
                        <span className="t-body font-medium text-[var(--color-t1)]">{item.subject.name}</span>
                      </div>
                      <p className="t-meta mt-1 text-[var(--color-t2)]">
                        {item.explanation.replace(/^because:\s*/i, "")}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        {node && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setSelectedId(node.id);
                              setAttentionOpen(false);
                            }}
                          >
                            Focus
                          </Button>
                        )}
                        {href && (
                          <Link href={href} className="t-label text-[var(--color-t3)]">
                            Open →
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* ── Attention column: Decision-ranked, max 3, scannable in seconds ────────────────── */}
      <div className="pointer-events-none absolute left-5 top-28 hidden w-[290px] lg:left-7 lg:block">
        <div className="pointer-events-auto">
          <p className="t-section mb-2.5 border-b border-[var(--color-line)] pb-2 text-[var(--color-t3)]">
            Needs you now
          </p>
          {priorityItems.length === 0 ? (
            <p className="t-meta text-[var(--color-t3)]">
              Nothing ranked needs attention. A quiet window for deep work.
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              {priorityItems.slice(0, 3).map((item) => {
                const node = subjectNode(item.subject.entity, item.subject.id);
                const href = routeForEntity(item.subject.entity, item.subject.id);
                return (
                  <li key={`${item.subject.entity}:${item.subject.id}`} className="anim-enter">
                    <div className="flex items-baseline gap-2">
                      <span className="t-mono text-[var(--color-accent)]">
                        {String(item.rank).padStart(2, "0")}
                      </span>
                      <span className="t-body font-medium text-[var(--color-t1)]">{item.subject.name}</span>
                    </div>
                    <p className="t-meta mt-1 text-[var(--color-t2)]">
                      {item.explanation.replace(/^because:\s*/i, "")}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {node && (
                        <Button variant="ghost" onClick={() => setSelectedId(node.id)}>
                          Focus
                        </Button>
                      )}
                      {href && (
                        <Link href={href} className="t-label text-[var(--color-t3)] hover:text-[var(--color-accent)]">
                          Open →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* ── Context panel ────────────────────────────────────────────────────────────────── */}
      {selected && (
        <div className="pointer-events-none absolute inset-x-4 bottom-32 top-24 z-30 flex justify-end lg:inset-x-auto lg:bottom-24 lg:right-7">
          <ContextPanel
            node={selected}
            model={model}
            href={routeForEntity(selected.entity, selected.entityId)}
            onClose={() => setSelectedId(null)}
            onFocusNode={setSelectedId}
          />
        </div>
      )}

      {/* ── Legend + activity key ────────────────────────────────────────────────────────────
          The written distinction between ambient and real motion. This is the honesty mechanism
          for §2.8 — not decoration. */}
      <footer className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 lg:gap-6 lg:p-7 ${
        compact && priorityItems.length > 0 ? "pb-16" : ""
      }`}>
        {/* The legend is a permanent fixture on desktop, where there is room for it. On small
            screens it becomes a toggle — the honesty text still has to be REACHABLE, but it must
            not consume half the viewport. */}
        <div className="pointer-events-auto min-w-0 max-w-[520px]">
          {(!compact || legendOpen) && (
            <>
              <ul className="mb-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
                {legendTypes.map((type) => (
                  <li key={type} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: NODE_VISUAL[type].color }}
                    />
                    <span className="t-label text-[var(--color-t3)]">{NODE_VISUAL[type].label}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1 border-t border-[var(--color-line)] pt-2">
                <p className="t-meta flex items-start gap-1.5 text-[var(--color-t3)]">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-neural)]" />
                  <span>Teal drift is ambient — the system idling. It never means a business event occurred.</span>
                </p>
                <p className="t-meta flex items-start gap-1.5 text-[var(--color-t3)]">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                  <span>Amber pulses are real events from the activity log.</span>
                </p>
              </div>
            </>
          )}
          {/* The ticker gets its own line so a long event summary never reflows the legend. */}
          {ticker && (
            <p className="t-mono mt-1 truncate text-[var(--color-accent)]" title={ticker}>
              ▸ {ticker}
            </p>
          )}
          {compact && (
            <Button variant="quiet" onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}>
              {legendOpen ? "Hide key" : "Key"}
            </Button>
          )}
        </div>

        {/* Density control — 30 of 91 nodes are checklist tasks, so this is measured, not assumed. */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          {/* `full` adds 30 checklist-task nodes — too dense to tap on a phone, so it is omitted
              on compact rather than hidden with a class (display utilities collide unreliably). */}
          {DETAIL_ORDER.filter((level) => !(compact && level === "full")).map((level) => (
            <Button
              key={level}
              variant={detail === level ? "primary" : "quiet"}
              onClick={() => setDetail(level)}
              aria-pressed={detail === level}
            >
              {DETAIL_LABEL[level]}
            </Button>
          ))}
          <span aria-hidden className="mx-0.5 hidden h-4 w-px bg-[var(--color-line)] sm:block" />
          <Button variant="quiet" onClick={fitGraph} title="Fit graph to view (F)">
            Fit
          </Button>
          <span aria-hidden className="mx-0.5 hidden h-4 w-px bg-[var(--color-line)] sm:block" />
          {/* SYNC — the only control here that writes. Explicit by design: reconciliation never
              happens on page load, because observing must not silently mutate. */}
          <Button
            variant="quiet"
            onClick={runSync}
            disabled={syncing}
            title="Inspect the vault for changes made outside Ascend"
          >
            {syncing ? "Syncing…" : "Sync vault"}
          </Button>
        </div>
      </footer>

      {/* ── Sync result ────────────────────────────────────────────────────────────────────────
          Quiet and factual. It states what was recorded and nothing more — no notification, no
          interpretation, no generated summary. It clears itself on the next sync. */}
      {sync && (
        <div
          role="status"
          className="pointer-events-auto absolute bottom-16 left-4 right-4 z-20 mx-auto max-w-[520px] rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[var(--shadow-e2)] backdrop-blur-xl sm:left-auto sm:right-6"
        >
          <div className="flex items-baseline justify-between gap-4">
            <p className="t-body text-[var(--color-t1)]">
              {sync.ok ? "Vault synchronized" : "Sync failed"}
            </p>
            <button
              onClick={() => setSync(null)}
              aria-label="Dismiss sync result"
              className="t-mono shrink-0 text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]"
            >
              ✕
            </button>
          </div>
          <p
            className="t-mono mt-1"
            style={{ color: sync.ok ? "var(--color-t2)" : "var(--color-risk)" }}
          >
            {sync.summary}
          </p>
          {sync.changes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {sync.changes.map((c, i) => (
                <li key={i} className="t-mono text-[var(--color-t2)]">
                  ↳ {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Accessibility: the parallel semantic list IS the Tab order ──────────────────────
          The graph is fully operable without touching the canvas. Visually hidden, not display:none,
          so it remains reachable by keyboard and screen reader. */}
      <div className="sr-only">
        <h2>Graph objects</h2>
        <ul>
          {model.nodes.map((n) => {
            const href = routeForEntity(n.entity, n.entityId);
            return (
              <li key={n.id}>
                <button onClick={() => setSelectedId(n.id)}>
                  {NODE_VISUAL[n.type].label}: {displayLabel(n.label)}
                  {n.state.status ? `, ${n.state.status}` : ""}
                  {n.state.attention ? ", needs attention" : ""}
                </button>
                {href && <Link href={href}>Open {displayLabel(n.label)}</Link>}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Real events are announced. Ambient activity never reaches this region. */}
      <div ref={liveRef} aria-live="polite" className="sr-only">
        {ticker}
      </div>
      <div aria-live="polite" className="sr-only">
        {selected ? `Selected ${NODE_VISUAL[selected.type].label}: ${displayLabel(selected.label)}` : ""}
      </div>
    </div>
  );
}