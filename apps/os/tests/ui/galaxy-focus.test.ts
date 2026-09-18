// Layer A — WHERE THE OPERATOR IS (Galaxy rebuild, Phase 1).
//
// `components/galaxy/camera/focusStore` is the drill path's state machine: Galaxy → System →
// Planet → Moon, and back. It is framework-free and created per mount, which is what makes it
// testable here at full strength — a state machine asserted through a React tree is asserted
// through whatever React happened to do that render.
//
// ─── THE TWO RULES THAT ARE NOT OBVIOUS ────────────────────────────────────────────────────────
//
// §10 says "clicks are ignored while `transitioning` is true" and "Escape queues a level-up if
// pressed mid-transition". Those are different answers to the same situation and the difference is
// deliberate:
//
//   • a CLICK mid-flight aimed at a body in a frame that no longer exists, so honouring it lands
//     somewhere the operator did not point at — it is dropped
//   • ESCAPE is how somebody gets OUT, and an Escape that silently did nothing for a second is how
//     a view feels stuck — it is queued
//
// Both are enforced in the store rather than at each call site, because a rule enforced at the call
// site holds until somebody adds a call site.

import { describe, expect, it } from "vitest";
import {
  BASE_TIME_SCALE, INITIAL_FOCUS, TIME_RATES, createFocusStore, effectiveTimeScale,
  levelForDepth, qualityTierFor,
} from "@/components/galaxy/camera/focusStore";
import { FOCUS_LEVELS } from "@/graph-view/field/scale";

const store = () => createFocusStore();

describe("THE DRILL PATH · the level is always the depth of the path", () => {
  it("opens at the galaxy, with nothing focused", () => {
    expect(store().getState().level).toBe("galaxy");
    expect(store().getState().targetId).toBeNull();
    expect(store().getState().path).toEqual([]);
    expect(INITIAL_FOCUS.transitioning).toBe(false);
  });

  it("descending walks the levels in order and records the breadcrumb", () => {
    const s = store();
    for (const [i, id] of ["client-a", "project-b", "doc-c"].entries()) {
      s.getState().settle();
      s.getState().descend(id);
      expect(s.getState().level, `step ${i}`).toBe(FOCUS_LEVELS[i + 1]);
      expect(s.getState().targetId).toBe(id);
      expect(s.getState().path).toHaveLength(i + 1);
      expect(s.getState().transitioning, "a descent did not start a transition").toBe(true);
    }
  });

  it("THE INVARIANT · level and path length never disagree, through any sequence", () => {
    // The one property everything else derives from — which system is mounted, which camera rail
    // applies, which post passes run. If these two ever drift apart the scene is in one level and
    // the camera is in another, and nothing errors.
    const s = store();
    const ids = ["a", "b", "c", "d"];
    for (const id of ids) { s.getState().settle(); s.getState().descend(id); }
    for (const step of ids) { void step; s.getState().settle(); s.getState().ascend(); }
    s.getState().settle();
    for (const id of ids) { s.getState().settle(); s.getState().descend(id); }
    s.getState().settle();
    expect(s.getState().level).toBe(levelForDepth(s.getState().path.length));
  });

  it("the drill path has a bottom — a moon has nothing inside it", () => {
    const s = store();
    for (const id of ["a", "b", "c"]) { s.getState().settle(); s.getState().descend(id); }
    s.getState().settle();
    s.getState().descend("d");
    expect(s.getState().level, "descended past the last level").toBe("moon");
    expect(s.getState().path, "the path grew past the level table").toHaveLength(3);
  });

  it("ascending from the galaxy does nothing at all", () => {
    const s = store();
    s.getState().ascend();
    expect(s.getState()).toMatchObject({ level: "galaxy", path: [], transitioning: false });
  });
});

describe("THE TRANSITION LOCK · a click is dropped and an escape is queued", () => {
  it("a descent mid-transition is DROPPED, not deferred", () => {
    const s = store();
    s.getState().descend("client-a");
    expect(s.getState().transitioning).toBe(true);
    s.getState().descend("client-b");
    expect(s.getState().targetId, "a click landed during a transition").toBe("client-a");
    expect(s.getState().path).toEqual(["client-a"]);
    // And it is not waiting anywhere: settling must not suddenly apply it.
    s.getState().settle();
    expect(s.getState().path).toEqual(["client-a"]);
    expect(s.getState().transitioning).toBe(false);
  });

  it("an ascent mid-transition is QUEUED, and applied when the transition settles", () => {
    const s = store();
    s.getState().descend("client-a");
    s.getState().ascend();
    expect(s.getState().path, "the queued ascent was applied immediately").toEqual(["client-a"]);
    expect(s.getState().queuedAscent).toBe(true);
    s.getState().settle();
    expect(s.getState().path, "the queued ascent was lost").toEqual([]);
    expect(s.getState().level).toBe("galaxy");
    expect(s.getState().queuedAscent).toBe(false);
  });

  it("the queue holds ONE ascent, not a count — a held Escape does not unwind the whole path", () => {
    // Escape repeats while held. Counting them would send the operator to the galaxy from a moon on
    // a single press-and-hold, which is not what "go back" means.
    const s = store();
    for (const id of ["a", "b"]) { s.getState().settle(); s.getState().descend(id); }
    s.getState().ascend();
    s.getState().ascend();
    s.getState().ascend();
    s.getState().settle();
    expect(s.getState().path, "a held escape unwound more than one level").toEqual(["a"]);
  });

  it("applying a queued ascent starts the ascent's OWN transition, and a second settle closes it", () => {
    // The subtle half. Settling the descent does not mean the view has arrived — it means the
    // camera may now start moving BACK, and that move has to settle in its turn. Clearing the flag
    // here would unlock the surface while the camera was still travelling, which is the exact
    // situation the lock exists for.
    const s = store();
    s.getState().descend("a");
    s.getState().ascend();
    s.getState().settle();
    expect(s.getState().path).toEqual([]);
    expect(s.getState().transitioning, "the ascent was applied without a transition to run it")
      .toBe(true);
    s.getState().settle();
    expect(s.getState().transitioning).toBe(false);
  });

  it("a queued ascent WITH NOWHERE TO GO leaves the surface unlocked", () => {
    // The degenerate case, and the one that would otherwise leave `transitioning` stuck true with
    // nothing in flight — which silently disables every click on the surface, with no error.
    // Escape queues unconditionally, so this is reachable by holding Escape at the galaxy while any
    // other transition runs.
    const s = store();
    s.getState().goTo(-1);
    s.getState().descend("a");
    s.getState().settle();
    s.getState().ascend();
    s.getState().settle();
    expect(s.getState().path).toEqual([]);
    s.getState().ascend();
    expect(s.getState().transitioning, "an ascent from the galaxy started a transition")
      .toBe(false);
  });
});

describe("THE BREADCRUMB · every segment is reachable, and the index is not trusted", () => {
  const drilled = () => {
    const s = store();
    for (const id of ["client", "project", "document"]) {
      s.getState().settle();
      s.getState().descend(id);
    }
    s.getState().settle();
    return s;
  };

  it("index -1 is the galaxy itself", () => {
    const s = drilled();
    s.getState().goTo(-1);
    expect(s.getState().path).toEqual([]);
    expect(s.getState().level).toBe("galaxy");
  });

  it("an interior index truncates to that segment", () => {
    const s = drilled();
    s.getState().goTo(0);
    expect(s.getState().path).toEqual(["client"]);
    expect(s.getState().level).toBe("system");
    expect(s.getState().targetId).toBe("client");
  });

  it("the CURRENT segment is a no-op rather than a transition to nowhere", () => {
    const s = drilled();
    s.getState().goTo(2);
    expect(s.getState().transitioning, "clicking where you already are started a transition")
      .toBe(false);
  });

  it("a stale index past the end of the path cannot grow it", () => {
    // The breadcrumb is UI and UI gets stale — an index from a render before an ascent would
    // otherwise index past the array and produce a path with holes in it.
    const s = drilled();
    s.getState().goTo(99);
    expect(s.getState().path).toEqual(["client", "project", "document"]);
    s.getState().goTo(-99);
    expect(s.getState().path).toEqual([]);
  });
});

describe("TIME · the operator can stop the galaxy without stopping the scene", () => {
  it("the composed rate is barely perceptible, and 1× is the default", () => {
    expect(BASE_TIME_SCALE).toBeLessThan(0.1);
    expect(INITIAL_FOCUS.rate).toBe(1);
    expect(TIME_RATES).toEqual([0, 1, 24]);
  });

  it("each rate multiplies the composed one, and 0× is a real answer", () => {
    for (const rate of TIME_RATES) {
      expect(effectiveTimeScale({ rate, reducedMotion: false }))
        .toBeCloseTo(BASE_TIME_SCALE * rate, 12);
    }
    // Zero stops the ORBITS. The frame loop keeps running, so the camera still moves and the scene
    // is still explorable — "paused" here means the galaxy holds still, not that the page freezes.
    expect(effectiveTimeScale({ rate: 0, reducedMotion: false })).toBe(0);
  });

  it("reduced motion overrides the rate entirely, including 24×", () => {
    expect(effectiveTimeScale({ rate: 24, reducedMotion: true })).toBe(0);
  });
});

describe("QUALITY · one question, asked once", () => {
  it("four cores or fewer is the reduced tier", () => {
    expect(qualityTierFor({ hardwareConcurrency: 4 })).toBe("reduced");
    expect(qualityTierFor({ hardwareConcurrency: 2 })).toBe("reduced");
    expect(qualityTierFor({ hardwareConcurrency: 5 })).toBe("high");
    expect(qualityTierFor({ hardwareConcurrency: 16 })).toBe("high");
  });

  it("an UNKNOWN machine is treated as capable", () => {
    // `navigator.hardwareConcurrency` is absent on some browsers. Defaulting to the reduced tier
    // would quietly hand a capable desktop the mobile scene with no way to tell, which is the
    // worse failure: the frame-rate governor catches the other direction.
    expect(qualityTierFor({})).toBe("high");
  });

  it("reduced motion forces the reduced tier regardless of the core count", () => {
    expect(qualityTierFor({ hardwareConcurrency: 32, reducedMotion: true })).toBe("reduced");
  });
});

describe("THE STORE IS PER-MOUNT · which is the whole reason it is a factory", () => {
  it("two stores do not share state", () => {
    // A module-level singleton would pass every other test in this file and fail this one, and the
    // failure it stands for is two surfaces silently steering each other's camera.
    const a = store();
    const b = store();
    a.getState().descend("client-a");
    expect(b.getState().path, "the second store saw the first one's focus").toEqual([]);
    expect(b.getState().transitioning).toBe(false);
  });

  it("initial state can be seeded without mutating the shared default", () => {
    const seeded = createFocusStore({ quality: "reduced", reducedMotion: true });
    expect(seeded.getState().quality).toBe("reduced");
    expect(INITIAL_FOCUS.quality, "the exported default was mutated").toBe("high");
    expect(store().getState().quality).toBe("high");
  });
});

describe("levelForDepth clamps rather than returning undefined", () => {
  it("every depth maps to a real level", () => {
    expect(levelForDepth(-5)).toBe("galaxy");
    expect(levelForDepth(0)).toBe("galaxy");
    expect(levelForDepth(3)).toBe("moon");
    expect(levelForDepth(99)).toBe("moon");
  });
});
