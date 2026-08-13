"use client";

import { motion } from "framer-motion";

/**
 * Mobile/touch-friendly floating launcher for the CommandPalette.
 * Dispatches a `jarvis:open` event the palette listens for.
 * Hidden on sm+ since desktop users get the ⌘K shortcut.
 *
 * Positioned bottom-left to avoid the StopwatchWidget which lives bottom-right.
 */
export function JarvisLauncher() {
  function open() {
    window.dispatchEvent(new CustomEvent("jarvis:open"));
  }

  return (
    <motion.button
      type="button"
      onClick={open}
      aria-label="Open JARVIS command palette"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 20, delay: 0.4 }}
      whileTap={{ scale: 0.94 }}
      className="fixed bottom-4 left-4 z-[60] flex size-12 items-center justify-center rounded-full border border-[var(--color-accent)]/50 bg-zinc-950/80 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.7)] backdrop-blur sm:hidden"
    >
      <span className="absolute inset-0 rounded-full bg-[var(--color-accent)]/10" />
      <span className="relative block size-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)] hud-pulse" />
    </motion.button>
  );
}
