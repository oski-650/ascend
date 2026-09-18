"use client";

// components/galaxy/SurfaceBoundary — WHY THE SCREEN WENT BLANK.
//
// ─── THE DEFECT THIS EXISTS BECAUSE OF ─────────────────────────────────────────────────────────
//
// `next/dynamic({ ssr: false })` with no `loading` renders NOTHING while the chunk is in flight, and
// a React subtree that throws unmounts to NOTHING. WebGL adds a third silent nothing: a browser or
// a machine that cannot give us a context fails without an exception anyone sees.
//
// Three different failures, one indistinguishable symptom — a black rectangle — and the operator has
// no way to tell them apart, or to tell any of them from "the galaxy is loading" or from "this
// account has no data". That cost a full round trip of guessing, which is the actual argument for
// this file: an unexplained blank is not a bug report, and it is what the surface produced.
//
// So every one of those states now SAYS something. A boundary that shows the error is worth more
// than a boundary that hides it — this is an internal operator console, and the person looking at it
// is the person who can fix it.

import { Component, type ReactNode } from "react";

const PANEL: React.CSSProperties = {
  position: "absolute", inset: 0, display: "grid", placeItems: "center",
  padding: 24, margin: 0, textAlign: "center",
  color: "#9aa2ab", font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** What went wrong, in words, where the picture would have been. */
export class SurfaceBoundary extends Component<
  { children: ReactNode; label: string; fallback?: ReactNode },
  { failure: string | null }
> {
  state: { failure: string | null } = { failure: null };

  static getDerivedStateFromError(error: unknown) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    // Console as well as screen. The message on screen is deliberately short; the console keeps the
    // stack, which is what actually locates the line.
    console.error(`[galaxy] ${this.props.label} failed`, error);
  }

  render() {
    if (this.state.failure === null) return this.props.children;
    // A caller may offer a REDUCED rendering rather than a message — used for the post-processing
    // pass, where losing bloom should cost the glow and not the galaxy.
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div style={PANEL}>
        <span>
          <strong style={{ color: "#c9d1d9", display: "block", marginBottom: 6 }}>
            {this.props.label} could not start
          </strong>
          {this.state.failure}
        </span>
      </div>
    );
  }
}

/** Shown while the WebGL chunk is in flight. Without it, loading is indistinguishable from broken. */
export function SurfaceLoading({ label }: { label: string }) {
  return <p style={PANEL}>{label}…</p>;
}
