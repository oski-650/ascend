"use client";

import { motion } from "framer-motion";

/**
 * Animated reactor-style orb — three intersecting elliptical rings at different
 * tilts and rotation speeds, with a pulsing core and ambient cyan glow.
 * Pure SVG; no Three.js dependency.
 *
 * State affects intensity:
 *   - idle:       slow rotation, gentle pulse
 *   - speaking:   slightly faster, brighter core
 *   - processing: violet shift + faster pulse (used while a command runs)
 */
export function JarvisOrb({
  size = 80,
  state = "idle",
}: {
  size?: number;
  state?: "idle" | "speaking" | "processing";
}) {
  const accent = state === "processing" ? "var(--color-system)" : "var(--color-accent)";
  const glow = state === "processing" ? "var(--color-system-glow)" : "var(--color-accent-glow)";
  const pulseDuration = state === "idle" ? 2.4 : 1.2;
  const ring1Duration = state === "processing" ? 4 : 8;
  const ring2Duration = state === "processing" ? 5 : 11;
  const ring3Duration = state === "processing" ? 3 : 6;

  return (
    <div
      style={{ width: size, height: size, filter: `drop-shadow(0 0 12px ${glow})` }}
      className="relative shrink-0"
      aria-hidden
    >
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <defs>
          <radialGradient id="orb-core">
            <stop offset="0%" stopColor={accent} stopOpacity="1" />
            <stop offset="60%" stopColor={accent} stopOpacity="0.4" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orb-ambient">
            <stop offset="0%" stopColor={accent} stopOpacity="0.15" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient outer glow */}
        <circle cx="60" cy="60" r="58" fill="url(#orb-ambient)" />

        {/* Static outer ring */}
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={accent}
          strokeOpacity="0.28"
          strokeWidth="0.6"
          strokeDasharray="2 4"
        />

        {/* Ring 1 — flat horizontal-ish ellipse, slow spin */}
        <motion.ellipse
          cx="60"
          cy="60"
          rx="50"
          ry="14"
          fill="none"
          stroke={accent}
          strokeOpacity="0.55"
          strokeWidth="0.9"
          style={{ transformOrigin: "60px 60px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: ring1Duration, repeat: Infinity, ease: "linear" }}
        />

        {/* Ring 2 — tilted ellipse, opposite spin */}
        <motion.ellipse
          cx="60"
          cy="60"
          rx="50"
          ry="22"
          fill="none"
          stroke={accent}
          strokeOpacity="0.4"
          strokeWidth="0.9"
          style={{ transformOrigin: "60px 60px", transform: "rotate(60deg)" }}
          animate={{ rotate: [60, -300] }}
          transition={{ duration: ring2Duration, repeat: Infinity, ease: "linear" }}
        />

        {/* Ring 3 — narrow vertical-ish, fastest */}
        <motion.ellipse
          cx="60"
          cy="60"
          rx="18"
          ry="50"
          fill="none"
          stroke={accent}
          strokeOpacity="0.5"
          strokeWidth="0.9"
          style={{ transformOrigin: "60px 60px", transform: "rotate(-30deg)" }}
          animate={{ rotate: [-30, 330] }}
          transition={{ duration: ring3Duration, repeat: Infinity, ease: "linear" }}
        />

        {/* Orbiting particle dots */}
        {[0, 120, 240].map((angle) => (
          <motion.circle
            key={angle}
            cx={60}
            cy={8}
            r="1.4"
            fill={accent}
            style={{ transformOrigin: "60px 60px", transform: `rotate(${angle}deg)` }}
            animate={{ rotate: [angle, angle + 360] }}
            transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
          />
        ))}

        {/* Pulsing core */}
        <motion.circle
          cx="60"
          cy="60"
          r="22"
          fill="url(#orb-core)"
          animate={{ opacity: [0.7, 1, 0.7], scale: [0.92, 1.05, 0.92] }}
          style={{ transformOrigin: "60px 60px" }}
          transition={{ duration: pulseDuration, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Center dot */}
        <circle cx="60" cy="60" r="3" fill={accent} />
      </svg>
    </div>
  );
}
