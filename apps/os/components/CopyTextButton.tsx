"use client";

// components/CopyTextButton — the clipboard ACTION.
//
// Migrated to the Deep Field language: it now renders as a Button in the shared action layer
// instead of an emoji-led, semibold, always-accented control with a permanent char-count tag.
// The behaviour and the payloads are unchanged — this is presentation only.
//
// Legacy surfaces (/crm, /production, /sales) still pass `primary` / `secondary`; both map onto
// real Button variants so those routes keep working untouched.

import { useState } from "react";
import { Button } from "@/components/primitives";

export function CopyTextButton({
  payload,
  label,
  variant = "primary",
}: {
  payload: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  /**
   * Accepted and ignored. Legacy surfaces still pass an emoji here; the Deep Field action layer
   * has no emoji, and those routes are out of scope for this increment. Drop the prop when the
   * last legacy caller is migrated.
   */
  icon?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

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

  const resolved = variant === "primary" ? "primary" : variant === "secondary" ? "ghost" : "quiet";

  return (
    <Button
      type="button"
      onClick={onClick}
      variant={state === "error" ? "danger" : resolved}
      // The char count is diagnostic, not content — it lives in the tooltip, not on the surface.
      title={`${payload.length.toLocaleString()} characters`}
      aria-live="polite"
    >
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : label}
    </Button>
  );
}