// components/galaxy/surfaceState — WHAT THE PICTURE IS DOING, IN ONE WORD.
//
// ─── WHY DETECTION AND NOT A BOUNDARY ──────────────────────────────────────────────────────────
//
// Phase 1B began by asking the browser what actually happens when WebGL is unavailable, because the
// answer decides the whole design. It was witnessed on 2026-09-18 against the running service with
// `getContext` returning null for every webgl request:
//
//     [uncaught] Error: THREE.WebGLRenderer: Error creating WebGL context.
//
// UNCAUGHT. React never sees it, so `SurfaceBoundary` never fires and renders no message — the
// renderer is configured outside the render phase, and a throw there is not a React error. The
// operator was left with a black rectangle, an inert 300×150 canvas and a toolbar whose motion
// controls still looked live. Nothing on screen said the word WebGL.
//
// An error boundary therefore CANNOT be the mechanism for this class. The capability has to be
// asked about before the renderer is allowed to try, which is what `detectWebGL` is for.
//
// ─── WHY THERE IS NO RECOVERY MACHINERY HERE ───────────────────────────────────────────────────
//
// The same pass witnessed context loss and restoration. `webglcontextlost` arrives with
// `defaultPrevented === true` and `THREE.WebGLRenderer: Context Restored.` follows a restore on its
// own: three.js already preventDefaults the loss and rebuilds its state. Adding our own
// preventDefault, remount or retry would be a second owner of recovery, and two owners of recovery
// is how a surface ends up in a remount loop. We observe the events and say what is happening; the
// renderer recovers itself.
//
// What loss DID need fixing is what it looks like: the lost canvas painted WHITE, and the DOM
// labels carried on animating over it while the toolbar read "In motion".

/** The one word the whole surface agrees on. */
export type SurfaceState =
  /** The WebGL chunk or context is still coming up. */
  | "starting"
  /** A context exists and the scene is drawing. */
  | "live"
  /** This browser or machine cannot give us WebGL at all. */
  | "unsupported"
  /** The context went away; three.js may yet restore it. */
  | "lost"
  /** Something inside the scene threw. The picture is gone; the business is not. */
  | "failed";

/** True only while the scene is actually drawing. */
export function isDrawing(state: SurfaceState): boolean {
  return state === "live";
}

/**
 * Whether the operator should be handed the directory instead of a picture.
 *
 * `starting` is deliberately absent: a chunk in flight resolves in a moment, and opening the
 * directory underneath it would make an ordinary load look like a failure.
 */
export function isDegraded(state: SurfaceState): boolean {
  return state === "unsupported" || state === "lost" || state === "failed";
}

/** What the operator is told, in words, on the surface itself. */
export function surfaceNotice(state: SurfaceState): { title: string; detail: string } | null {
  switch (state) {
    case "unsupported":
      return {
        title: "3D graphics unavailable",
        detail: "This browser or device cannot open a WebGL context, so the sky cannot be drawn. Every client, project and record is still listed in the directory.",
      };
    case "lost":
      return {
        title: "Display interrupted",
        detail: "The graphics context was lost — usually after the device was backgrounded or put under load. The view returns by itself when the browser restores it. The directory keeps working meanwhile.",
      };
    case "failed":
      return {
        title: "The sky could not be drawn",
        detail: "The scene stopped with an error, which is recorded in the browser console. The directory, search and every record link below are unaffected.",
      };
    default:
      return null;
  }
}

/**
 * Asks the browser for a context on a throwaway canvas, and throws nothing.
 *
 * Deliberately separate from the renderer's own context: this runs BEFORE `<Canvas>` is allowed to
 * mount, so that the uncaught throw witnessed above never happens. The probe context is released
 * immediately — holding it would count against the browser's context limit and could itself be the
 * reason the real one fails.
 */
export function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (gl === null) return false;
    // Hand the context straight back. A browser will only give out so many.
    const lose = "getExtension" in gl ? (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context") : null;
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

// ─── THE ORDER THESE ARRIVE IN IS NOT THE ORDER THEY MATTER IN ─────────────────────────────────
//
// Witnessed on 2026-09-18 with a fault injected into the scene: the boundary caught the throw and
// set `failed`, and then unmounting the subtree disposed three's renderer, which fired
// `webglcontextlost` on the way out. The last writer won, so a surface that had CRASHED told the
// operator "Display interrupted … the view returns by itself when the browser restores it" — an
// invitation to wait for something that was never coming back.
//
// So the states have a precedence, kept here as three pure transitions rather than inline in the
// handlers: a terminal state is not overwritten by the wreckage of its own teardown.

/** A lost context never overrides a state the surface cannot recover from by waiting. */
export function afterContextLost(previous: SurfaceState): SurfaceState {
  return previous === "failed" || previous === "unsupported" ? previous : "lost";
}

/** Restoration returns only what loss took. It cannot revive a scene that threw. */
export function afterContextRestored(previous: SurfaceState): SurfaceState {
  return previous === "lost" ? "live" : previous;
}

/** A scene that threw is terminal — except on a machine that never had WebGL to begin with. */
export function afterSceneFailure(previous: SurfaceState): SurfaceState {
  return previous === "unsupported" ? previous : "failed";
}

/** A context that came up is only news if we were waiting for one. */
export function afterContextCreated(previous: SurfaceState): SurfaceState {
  return previous === "unsupported" || previous === "failed" ? previous : "live";
}
