"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Subtle text-scramble animation (~300ms) — simulates "decryption" on page load.
 * Cycles each character through random glyphs before settling to the real letter,
 * left-to-right. Pure JS, no deps.
 *
 * Renders children as inline content so it composes inside any heading element.
 * To preserve markup like accent spans, only the plain text is scrambled —
 * pass the static label as `text` and any styled affixes as `prefix`/`suffix`.
 */
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789·▸◆◊";
const FRAME_MS = 28;
const PER_CHAR_FRAMES = 3;

export function ScrambleTitle({
  text,
  prefix,
  suffix,
  className = "",
}: {
  text: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
}) {
  const [display, setDisplay] = useState<string>(() => " ".repeat(text.length));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let frame = 0;
    const targetChars = text.split("");
    const totalFrames = targetChars.length * PER_CHAR_FRAMES;

    setDisplay(targetChars.map(() => randGlyph()).join(""));

    timerRef.current = setInterval(() => {
      frame++;
      if (frame >= totalFrames) {
        setDisplay(text);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const settledCount = Math.floor(frame / PER_CHAR_FRAMES);
      setDisplay(
        targetChars
          .map((c, i) => {
            if (i < settledCount) return c;
            if (c === " ") return " ";
            return randGlyph();
          })
          .join("")
      );
    }, FRAME_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // Only run on mount per text — re-runs only when text changes.
  }, [text]);

  return (
    <span className={className}>
      {prefix}
      <span aria-label={text}>{display}</span>
      {suffix}
    </span>
  );
}

function randGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}
