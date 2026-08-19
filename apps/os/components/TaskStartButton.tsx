"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/primitives";

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
  disabled,
}: {
  client: string;
  phase: string;
  task: string;
  /**
   * ACCEPTED AND IGNORED. The Deep Field Button has one size, so three hand-tuned padding scales
   * no longer exist. The prop stays in the signature because components/PhaseChecklist (a
   * not-yet-migrated legacy surface) passes `size="xs"`; removing it would break that page for no
   * benefit. Delete this prop when PhaseChecklist is migrated.
   */
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

  // COLOR SEMANTICS: "start" was accent on every row, so a build with 17 open tasks rendered 17
  // accent affordances and accent stopped meaning anything. Accent is reserved for operator
  // ATTENTION — and a timer that is CURRENTLY RUNNING is exactly that, so the running state keeps
  // it while the idle state is the ordinary ghost affordance.
  return isThisTask ? (
    <Button
      type="button"
      onClick={stop}
      disabled={busy}
      variant="primary"
      className="shrink-0"
      title="Stop tracking this task"
    >
      Stop
    </Button>
  ) : (
    <Button
      type="button"
      onClick={start}
      disabled={busy || disabled}
      className="shrink-0"
      title={active ? `Will auto-stop: ${active.task}` : "Start tracking this task"}
    >
      Start
    </Button>
  );
}
