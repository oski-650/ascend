"use client";

import { useState } from "react";

export function CopyTargetButton({ payload }: { payload: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const charCount = payload.length;

  async function onClick() {
    try {
      await navigator.clipboard.writeText(payload);
      setState("copied");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold transition-all ${
          state === "copied"
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
            : state === "error"
              ? "border-[var(--color-risk)] bg-[var(--color-risk)]/10 text-[var(--color-risk)]"
              : "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
        }`}
      >
        <span className="text-base">{state === "copied" ? "✓" : state === "error" ? "!" : "🎯"}</span>
        <span>
          {state === "copied"
            ? "Copied · paste into Claude"
            : state === "error"
              ? "Copy failed"
              : "Copy Target Strategy Context"}
        </span>
      </button>
      <span className="t-label text-[var(--color-t3)] sm:ml-2">
        {charCount.toLocaleString()} chars
      </span>
    </div>
  );
}
