"use client";

import { useEffect, useRef, useState } from "react";

type Entry = {
  id: string;
  client: string;
  phase: string;
  task: string;
  started: string;
  ended: string | null;
};

function formatHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STORAGE_KEY = "ascend.stopwatch.activeId";

declare global {
  interface WindowEventMap {
    "ascend:stopwatch-changed": CustomEvent<{ entry: Entry | null }>;
  }
}

export function StopwatchWidget() {
  const [active, setActive] = useState<Entry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const tickRef = useRef<number | null>(null);

  // Fetch active session on mount + when storage flag changes (cross-tab) + when start/stop dispatched.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/time/active", { cache: "no-store" });
        const json = (await res.json()) as { active: Entry | null };
        if (!cancelled) {
          setActive(json.active);
          if (json.active) localStorage.setItem(STORAGE_KEY, json.active.id);
          else localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // network errors are non-fatal — widget just stays hidden
      }
    }
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    const onChange = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("ascend:stopwatch-changed", onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ascend:stopwatch-changed", onChange as EventListener);
    };
  }, []);

  // Local 1s tick when active.
  useEffect(() => {
    if (!active) {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setElapsed(0);
      return;
    }
    const update = () => {
      const startedMs = new Date(active.started).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    };
    update();
    tickRef.current = window.setInterval(update, 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [active]);

  async function stop() {
    if (!active || busy) return;
    setBusy(true);
    try {
      await fetch("/api/time/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id }),
      });
      setActive(null);
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("ascend:stopwatch-changed", { detail: { entry: null } }));
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  return (
    <div
      role="status"
      className="fixed left-4 right-4 top-4 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-accent)]/50 bg-[var(--color-surface)]/95 px-3 py-2.5 shadow-[var(--shadow-e2)] backdrop-blur sm:left-auto sm:right-4 sm:max-w-sm"
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300">REC</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[var(--color-fg)]">{active.task}</p>
        <p className="truncate font-mono text-[10px] text-[var(--color-fg-dim)]">
          {active.client} · {active.phase}
        </p>
      </div>
      <span className="font-mono text-base font-bold tabular-nums text-amber-300 sm:text-lg">
        {formatHMS(elapsed)}
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className="shrink-0 rounded-md border border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)] hover:text-[var(--color-bg)] disabled:opacity-50"
      >
        {busy ? "…" : "Stop"}
      </button>
    </div>
  );
}
