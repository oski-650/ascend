"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  client: string;
  phase: string;
  task: string;
  started: string;
  ended: string | null;
};

export function TaskStartButton({
  client,
  phase,
  task,
  size = "sm",
  disabled,
}: {
  client: string;
  phase: string;
  task: string;
  size?: "xs" | "sm" | "md";
  disabled?: boolean;
}) {
  const [active, setActive] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/time/active", { cache: "no-store" });
        const json = (await res.json()) as { active: Entry | null };
        if (!cancelled) setActive(json.active);
      } catch {
        /* non-fatal */
      }
    }
    refresh();
    const onChange = () => refresh();
    window.addEventListener("ascend:stopwatch-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("ascend:stopwatch-changed", onChange);
    };
  }, []);

  const isThisTask =
    active && active.client === client && active.phase === phase && active.task === task;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/time/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, phase, task }),
      });
      const json = (await res.json()) as { entry?: Entry };
      if (json.entry) setActive(json.entry);
      window.dispatchEvent(new CustomEvent("ascend:stopwatch-changed", { detail: { entry: json.entry ?? null } }));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (busy || !active) return;
    setBusy(true);
    try {
      await fetch("/api/time/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id }),
      });
      setActive(null);
      window.dispatchEvent(new CustomEvent("ascend:stopwatch-changed", { detail: { entry: null } }));
    } finally {
      setBusy(false);
    }
  }

  const padding = {
    xs: "px-1.5 py-0.5 text-[10px]",
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-1.5 text-sm",
  }[size];

  if (isThisTask) {
    return (
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className={`shrink-0 rounded border border-amber-400/60 bg-amber-400/10 font-mono uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-400 hover:text-[var(--color-bg)] disabled:opacity-50 ${padding}`}
        title="Stop tracking this task"
      >
        ⏸ stop
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy || disabled}
      className={`shrink-0 rounded border border-[var(--color-accent)]/40 bg-transparent font-mono uppercase tracking-wider text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-30 ${padding}`}
      title={active ? `Will auto-stop: ${active.task}` : "Start tracking this task"}
    >
      ▶ start
    </button>
  );
}
