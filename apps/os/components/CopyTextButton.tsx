"use client";

import { useState } from "react";

export function CopyTextButton({
  payload,
  label,
  variant = "primary",
  icon,
}: {
  payload: string;
  label: string;
  variant?: "primary" | "secondary";
  icon?: string;
}) {
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

  const base =
    "inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-all";
  const sizing = variant === "primary" ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs";
  const idle =
    variant === "primary"
      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
      : "border-[var(--color-border-hi)] bg-[var(--color-bg)] text-[var(--color-fg-mute)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]";

  return (
    <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${sizing} ${
          state === "copied"
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
            : state === "error"
              ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
              : idle
        }`}
      >
        <span>{state === "copied" ? "✓" : state === "error" ? "!" : (icon ?? "📋")}</span>
        <span>{state === "copied" ? "Copied · paste into Claude" : state === "error" ? "Copy failed" : label}</span>
      </button>
      <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)] sm:ml-1">
        {charCount.toLocaleString()} chars
      </span>
    </div>
  );
}
