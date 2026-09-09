// Copies the compiled target context to the clipboard.
//
// ─── IT USES THE Button PRIMITIVE (2026-09-08) ─────────────────────────────────────────────────
//
// It used to hand-roll its own padding, radius, border, font size and colours, which is why the
// prospect header carried five controls in four different visual languages: this one was a filled
// accent pill with an emoji, its neighbours were `t-label` outlines. Nothing here needed to be
// different — it is a button, and the app already has one.
//
// The character count moved into `title`. It answers "how much am I about to paste", which is worth
// having on hover and is not worth a permanent slab of text floating between two buttons.

"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";

export function CopyTargetButton({ payload }: { payload: string }) {
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

  return (
    <Button
      type="button"
      onClick={onClick}
      // GHOST, not primary: "Promote to client" is the consequential action on this page and
      // should be the only accented one. Copying context is a utility.
      variant={state === "error" ? "danger" : state === "copied" ? "primary" : "ghost"}
      title={`${payload.length.toLocaleString()} characters`}
    >
      {state === "copied" ? "Copied — paste into Claude" : state === "error" ? "Copy failed" : "Copy strategy context"}
    </Button>
  );
}
