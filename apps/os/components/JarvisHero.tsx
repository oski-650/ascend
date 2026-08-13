"use client";

import { motion } from "framer-motion";
import { JarvisOrb } from "./JarvisOrb";
import type { Line } from "./HoloTerminal";

/**
 * Full-width JARVIS centerpiece for the dashboard.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  ORB (200px)        BRIEFING (spacious typography)             │
 *   │  reactive           - greeting                                 │
 *   │                     - up to 4 ranked recommendations           │
 *   │                     - status fragment                          │
 *   │                                                                │
 *   │                     [ ⌘K to speak with JARVIS ]                │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * The terminal lives in the global CommandPalette (⌘K from anywhere) —
 * this component just presents JARVIS's morning briefing.
 */
export function JarvisHero({ briefing }: { briefing: Line[] }) {
  function openPalette() {
    window.dispatchEvent(new CustomEvent("jarvis:open"));
  }

  return (
    <section className="mb-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
        className="glass scanlines rounded-2xl p-5 sm:p-8"
      >
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
          {/* Orb — much larger, centered on its column */}
          <div className="flex shrink-0 flex-col items-center gap-3">
            <JarvisOrb size={200} state="idle" />
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent)] hud-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--color-accent)]">
                JARVIS · online
              </span>
            </div>
          </div>

          {/* Briefing — spacious typography */}
          <div className="flex-1 self-stretch">
            <BriefingDisplay lines={briefing} />

            {/* Sleeker call-to-talk — a quiet ⌘K affordance instead of a button toggle */}
            <button
              type="button"
              onClick={openPalette}
              className="group mt-6 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-[var(--color-accent)]"
              aria-label="Open JARVIS command palette"
            >
              <span>speak with JARVIS</span>
              <kbd className="rounded border border-zinc-800/60 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-zinc-400 group-hover:border-[var(--color-accent)]/50 group-hover:text-[var(--color-accent)]">
                ⌘K
              </kbd>
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/**
 * Renders briefing lines with hero typography.
 */
function BriefingDisplay({ lines }: { lines: Line[] }) {
  const greeting = lines.find((l) => l.kind === "out");
  const bodyItems = lines
    .filter((l) => l.kind === "out" && l !== greeting)
    .slice(0, 12);
  const trailing = lines.filter((l) => l.kind === "sys");

  const intro = bodyItems.find((l) => !l.text.startsWith("  ▸"));
  const recs = bodyItems.filter((l) => l.text.startsWith("  ▸"));

  return (
    <div className="flex flex-col gap-4">
      {greeting && (
        <p className="font-serif text-2xl font-medium leading-tight text-zinc-100 sm:text-3xl">
          {greeting.text}
        </p>
      )}

      {intro && (
        <p className="text-base leading-relaxed text-zinc-300 sm:text-lg">{intro.text}</p>
      )}

      {recs.length > 0 && (
        <ul className="flex flex-col gap-2 border-l border-[var(--color-accent)]/30 pl-4">
          {recs.map((r, i) => (
            <li key={i} className="text-sm leading-relaxed text-zinc-200 sm:text-base">
              {r.text.replace(/^\s*▸\s*/, "")}
            </li>
          ))}
        </ul>
      )}

      {trailing.length > 0 && (
        <div className="flex flex-col gap-1 pt-2">
          {trailing.map((t, i) => (
            <p key={i} className="font-mono text-[11px] text-zinc-500">
              {t.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
