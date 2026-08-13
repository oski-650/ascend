"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CheckboxToggle({
  client,
  phase,
  itemIndex,
  initialDone,
  text,
}: {
  client: string;
  phase: string;
  itemIndex: number;
  initialDone: boolean;
  text: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState(initialDone);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    const next = !done;
    setDone(next); // optimistic
    setErr(null);
    try {
      const res = await fetch("/api/production/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, phase, itemIndex }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setDone(!next); // revert
        setErr(j.error ?? "Toggle failed");
        return;
      }
      // Server is now source of truth; refresh in transition so progress %, ladder, EHR etc. recompute.
      startTransition(() => router.refresh());
    } catch (e) {
      setDone(!next); // revert
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={done}
        title={done ? "Click to uncheck" : "Click to mark done"}
        className={`mt-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border font-mono text-[10px] transition-colors disabled:opacity-50 ${
          done
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25"
            : "border-[var(--color-fg-dim)]/40 text-transparent hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/5"
        }`}
      >
        {done ? "✓" : ""}
      </button>
      <span
        onClick={toggle}
        className={`flex-1 cursor-pointer select-none ${
          done ? "text-[var(--color-fg-dim)] line-through" : "text-[var(--color-fg)]"
        }`}
      >
        {text}
      </span>
      {err && <span className="font-mono text-[10px] text-[var(--color-danger)]">{err}</span>}
    </li>
  );
}
