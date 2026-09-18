"use client";

// components/galaxy/GalaxyNotice — the words that were missing.
//
// The pre-implementation witness for 1B is the whole argument for this file. With WebGL
// unavailable the operator got a black rectangle, an inert canvas and a toolbar that still looked
// live; during a lost context the canvas painted WHITE and the labels went on drifting over it.
// In neither case did anything on screen say what had happened, and an unexplained blank is not a
// bug report — the same lesson `SurfaceBoundary` was written for, one layer out.
//
// It lives in the DOM cockpit, OUTSIDE every renderer boundary, because the states it describes are
// exactly the states in which the things inside those boundaries are gone.

import { AlertTriangle } from "lucide-react";
import { surfaceNotice, type SurfaceState } from "./surfaceState";

export function GalaxyNotice({ state }: { state: SurfaceState }) {
  const notice = surfaceNotice(state);
  if (notice === null) return null;
  return (
    // `status`, not `alert`: this is a condition of the surface the operator is already looking at,
    // and `alert` interrupts a screen reader mid-sentence to say so.
    <aside className="galaxy-notice" role="status" data-surface={state}>
      <AlertTriangle size={15} aria-hidden />
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.detail}</p>
      </div>
    </aside>
  );
}
