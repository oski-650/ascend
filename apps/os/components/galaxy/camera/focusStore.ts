// components/galaxy/camera/focusStore — WHERE THE OPERATOR IS (brief §10, §13).
//
// The drill path is Galaxy → System → Planet → Moon, and this store is the only thing that knows
// which of those is current. Everything else — which system is mounted, how far the camera sits
// back, whether the star field is faded, which post passes are enabled — is derived from it.
//
// ─── WHY THIS IS A FACTORY AND NOT A MODULE SINGLETON ──────────────────────────────────────────
//
// The obvious zustand shape is `export const useFocus = create(...)`, and it is wrong here twice
// over. F65 bans module-level mutable state under `components/galaxy` — a singleton store is
// precisely that, and the ban exists because a second surface reading the first one's state is the
// kind of coupling nothing fails on until it does. And a factory is what makes the transitions
// below testable in plain Node, which matters more: a state machine asserted through a React tree
// is asserted through whatever React happened to do.
//
// So the store is created per mount, by the provider, and the camera rig subscribes to it OUTSIDE
// the React render loop. That last part is not a performance note. Driving a camera through React
// state re-renders the tree sixty times a second and is the second entry on the brief's own list of
// what wrecks this.
//
// ─── TRANSITIONING IS A LOCK, NOT A FLAG ───────────────────────────────────────────────────────
//
// §10: "Clicks are ignored while `transitioning` is true. Escape queues a level-up if pressed
// mid-transition." Both halves are enforced HERE rather than by each caller remembering to check,
// because a rule enforced at the call site is a rule that holds until somebody adds a call site.
// `descend` during a transition is dropped; `ascend` during one is queued and applied on `settle`.

import { createStore, type StoreApi } from "zustand/vanilla";
import { FOCUS_LEVELS, type FocusLevel } from "@/graph-view/field/scale";

/** Orbital rate multipliers the operator can choose. "live / day / month" in §12's words. */
export const TIME_RATES = [0, 1, 24] as const;
export type TimeRate = (typeof TIME_RATES)[number];

/**
 * Base orbital rate at galaxy level.
 *
 * 0.06 makes the motion barely perceptible — felt rather than watched. A galaxy that visibly spins
 * reads as an animation; one that has moved when you look back reads as a place.
 */
export const BASE_TIME_SCALE = 0.06;

/** What the machine can afford. Decided once by the composer, never re-asked per frame. */
export type QualityTier = "high" | "reduced";

export interface FocusState {
  readonly level: FocusLevel;
  readonly targetId: string | null;
  /** Breadcrumb ids, root → current. Its length is always the level's index. */
  readonly path: readonly string[];
  readonly transitioning: boolean;
  /** An ascend requested mid-transition, applied when the current one settles. */
  readonly queuedAscent: boolean;
  readonly rate: TimeRate;
  readonly quality: QualityTier;
  readonly reducedMotion: boolean;
}

export interface FocusActions {
  /** Go one level IN, onto `id`. Dropped while a transition is in flight. */
  descend(id: string): void;
  /** Go one level OUT. Queued rather than dropped while a transition is in flight. */
  ascend(): void;
  /** Jump to a breadcrumb segment by its index in `path`. Index -1 is the galaxy. */
  goTo(index: number): void;
  /** The transition finished. Applies any queued ascent. */
  settle(): void;
  setRate(rate: TimeRate): void;
  setQuality(quality: QualityTier): void;
  setReducedMotion(reduced: boolean): void;
}

export type FocusStore = StoreApi<FocusState & FocusActions>;

/** Level for a path of length n. Clamped, so a malformed path cannot index past the table. */
export function levelForDepth(depth: number): FocusLevel {
  return FOCUS_LEVELS[Math.min(Math.max(depth, 0), FOCUS_LEVELS.length - 1)];
}

/** The initial, un-drilled state. Exported so a test can assert against it rather than restate it. */
export const INITIAL_FOCUS: FocusState = {
  level: "galaxy",
  targetId: null,
  path: [],
  transitioning: false,
  queuedAscent: false,
  rate: 1,
  quality: "high",
  reducedMotion: false,
};

/**
 * The effective orbital rate: the base scale the galaxy was composed at, times what the operator
 * asked for. Zero is a real answer — it stops the galaxy without stopping the frame loop, so the
 * camera still moves and the scene is still explorable.
 */
export function effectiveTimeScale(state: Pick<FocusState, "rate" | "reducedMotion">): number {
  return state.reducedMotion ? 0 : BASE_TIME_SCALE * state.rate;
}

/** A new store, owned by one mount. */
export function createFocusStore(initial: Partial<FocusState> = {}): FocusStore {
  return createStore<FocusState & FocusActions>((set, get) => ({
    ...INITIAL_FOCUS,
    ...initial,

    descend(id) {
      const state = get();
      // The lock. A click that lands mid-flight is dropped outright rather than queued: the
      // operator aimed at a body in a frame that no longer exists, and honouring it would land
      // somewhere they did not point at.
      if (state.transitioning) return;
      if (state.level === FOCUS_LEVELS[FOCUS_LEVELS.length - 1]) return;
      const path = [...state.path, id];
      set({ path, level: levelForDepth(path.length), targetId: id, transitioning: true });
    },

    ascend() {
      const state = get();
      // Queued rather than dropped, because Escape is how somebody gets OUT. A held Escape that
      // silently did nothing during a one-second transition is how a view feels stuck.
      if (state.transitioning) {
        set({ queuedAscent: true });
        return;
      }
      if (state.path.length === 0) return;
      const path = state.path.slice(0, -1);
      set({
        path,
        level: levelForDepth(path.length),
        targetId: path.length > 0 ? path[path.length - 1] : null,
        transitioning: true,
      });
    },

    goTo(index) {
      const state = get();
      if (state.transitioning) return;
      // `index` addresses a breadcrumb SEGMENT, so the new path keeps index + 1 entries and -1 is
      // the galaxy itself. Clamped rather than trusted: the breadcrumb is UI and UI gets stale.
      const depth = Math.min(Math.max(index + 1, 0), state.path.length);
      if (depth === state.path.length) return;
      const path = state.path.slice(0, depth);
      set({
        path,
        level: levelForDepth(path.length),
        targetId: path.length > 0 ? path[path.length - 1] : null,
        transitioning: true,
      });
    },

    settle() {
      const state = get();
      if (!state.queuedAscent) {
        set({ transitioning: false });
        return;
      }
      // Apply the queued ascent as one move: clearing the flag and re-entering `ascend` would need
      // two frames and would show the settled view for one of them.
      const path = state.path.slice(0, -1);
      set({
        path,
        level: levelForDepth(path.length),
        targetId: path.length > 0 ? path[path.length - 1] : null,
        transitioning: state.path.length > 0,
        queuedAscent: false,
      });
    },

    setRate(rate) { set({ rate }); },
    setQuality(quality) { set({ quality }); },
    setReducedMotion(reducedMotion) { set({ reducedMotion }); },
  }));
}

/**
 * Which tier a machine gets, from what the browser will tell us about it.
 *
 * Pure and argument-taking rather than reading `navigator` itself, for the reason the composer owns
 * every environment query: one place asks what the machine is, and everything downstream is handed
 * the answer. Two places asking is two answers that can disagree.
 */
export function qualityTierFor(env: {
  hardwareConcurrency?: number;
  reducedMotion?: boolean;
}): QualityTier {
  if (env.reducedMotion) return "reduced";
  // §13's threshold. Four cores or fewer is the mobile tier: 45k stars, no lensing, no depth of
  // field. `undefined` is treated as capable — an unknown machine gets the full scene and the
  // frame-rate governor catches it if that was wrong, which is the failure worth having.
  return (env.hardwareConcurrency ?? 8) <= 4 ? "reduced" : "high";
}
