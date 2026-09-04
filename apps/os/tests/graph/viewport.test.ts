// tests/graph — regression cover for the four "Fit" defects found on 2026-08-19.
//
// Deterministic and vault-independent by construction: the layout is seeded from hashes of node
// ids, so a synthetic graph with the same SHAPE as the real one reproduces the same pathology
// without depending on anyone's Obsidian folder.

import { describe, expect, it } from "vitest";
import { GraphSimulation } from "@/components/graph/simulation";
import {
  FIT_MIN_ZOOM,
  PANEL_BREAKPOINT,
  computeFitCamera,
  fitInsets,
  shouldSkipFrame,
  toScreen,
  toWorld,
  easeCamera,
  cameraSettled,
  type FitCamera,
} from "@/graph-view/viewport";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/graph-view/contract";

const MAX_ZOOM = 3.2;
/** The MANUAL zoom floor in GraphCanvas. A fit must be allowed to go below it. */
const MANUAL_MIN_ZOOM = 0.25;

function node(type: GraphNodeType, i: number): GraphNode {
  return {
    id: `${type}:${i}`,
    type,
    label: `${type} ${i}`,
    entityId: String(i),
    entity: "client",
    weight: 0.5,
    state: { health: null, status: null, attention: false },
    meta: [],
  };
}

/**
 * Build a graph of disconnected components with the given sizes — the shape measured on the real
 * vault at `artifacts` detail was 9 components sized 27,9,4,4,2,1,1,1,1 over 50 nodes.
 */
function componentGraph(sizes: number[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const types: GraphNodeType[] = ["client", "project", "opportunity", "invoice", "document"];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let n = 0;
  for (const size of sizes) {
    const first = n;
    for (let i = 0; i < size; i++) {
      nodes.push(node(types[(n + i) % types.length], n + i));
      if (i > 0) {
        const a = nodes[first].id;
        const b = nodes[first + i].id;
        edges.push({ id: `has_project:${a}->${b}`, type: "has_project", source: a, target: b });
      }
    }
    n += size;
  }
  return { nodes, edges };
}

function extentOf(sim: GraphSimulation) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of sim.nodes) {
    minX = Math.min(minX, s.x - s.r);
    minY = Math.min(minY, s.y - s.r);
    maxX = Math.max(maxX, s.x + s.r);
    maxY = Math.max(maxY, s.y + s.r);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ─── #2 · disconnected components must not explode ─────────────────────────────────────────────
describe("#2 · layout stays spatially coherent when filtering disconnects the graph", () => {
  const REAL_SHAPE = [27, 9, 4, 4, 2, 1, 1, 1, 1];

  it("keeps a 9-component graph inside a usable extent", () => {
    const { nodes, edges } = componentGraph(REAL_SHAPE);
    const sim = new GraphSimulation(nodes, edges);
    sim.prewarm();
    const e = extentOf(sim);
    // The observed failure was 1658 x 4583 — a vertical tower. Neither axis may run away, and the
    // aspect ratio must stay sane: a 1:2.8 sliver is what put the fit zoom under the floor.
    expect(e.w).toBeLessThan(2600);
    expect(e.h).toBeLessThan(2600);
    expect(Math.max(e.w, e.h) / Math.min(e.w, e.h)).toBeLessThan(2);
  });

  it("no node is flung into deep space", () => {
    const { nodes, edges } = componentGraph(REAL_SHAPE);
    const sim = new GraphSimulation(nodes, edges);
    sim.prewarm();
    // Bands top out at 560 (+45 seed jitter). Anything past 1500 escaped rather than settled.
    const far = sim.nodes.filter((s) => Math.hypot(s.x, s.y) > 1500);
    expect(far.map((s) => s.node.id)).toEqual([]);
  });

  it("actually converges — extra iterations must not change the result", () => {
    // The original layout was FROZEN, not settled: alpha decayed to ~0 mid-flight, so 220 and 6000
    // iterations agreed only because nothing was still moving. Convergence means agreeing at a
    // BOUNDED extent, which the assertion above pins.
    const { nodes, edges } = componentGraph(REAL_SHAPE);
    const a = new GraphSimulation(nodes, edges);
    a.prewarm();
    const b = new GraphSimulation(nodes, edges);
    b.prewarm(2000);
    const ea = extentOf(a);
    const eb = extentOf(b);
    expect(Math.abs(ea.w - eb.w)).toBeLessThan(ea.w * 0.15);
    expect(Math.abs(ea.h - eb.h)).toBeLessThan(ea.h * 0.15);
  });

  it("is deterministic — the same graph lays out identically twice", () => {
    const { nodes, edges } = componentGraph(REAL_SHAPE);
    const a = new GraphSimulation(nodes, edges);
    a.prewarm();
    const b = new GraphSimulation(nodes, edges);
    b.prewarm();
    expect(extentOf(a)).toEqual(extentOf(b));
  });

  it("a fully disconnected graph (every node isolated) still stays bounded", () => {
    const { nodes, edges } = componentGraph(Array.from({ length: 40 }, () => 1));
    expect(edges).toHaveLength(0);
    const sim = new GraphSimulation(nodes, edges);
    sim.prewarm();
    expect(extentOf(sim).w).toBeLessThan(2600);
    expect(sim.nodes.filter((s) => Math.hypot(s.x, s.y) > 1500)).toEqual([]);
  });
});

// ─── #1 · a fit may zoom out past the manual floor ─────────────────────────────────────────────
describe("#1 · MIN_ZOOM must not veto the fit arithmetic", () => {
  it("reaches a zoom below the manual floor when the graph demands it", () => {
    // The measured pathological case: 1658 x 4583 world units in a 1512x900 viewport needed 0.140.
    const cam = computeFitCamera(
      { minX: -829, minY: -2291, maxX: 829, maxY: 2292 },
      1512,
      900,
      fitInsets(1512, false),
      MAX_ZOOM
    );
    expect(cam.zoom).toBeLessThan(MANUAL_MIN_ZOOM);
    expect(cam.zoom).toBeGreaterThan(FIT_MIN_ZOOM);
  });

  it("never returns a degenerate or non-finite camera", () => {
    for (const box of [
      { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
    ]) {
      const cam = computeFitCamera(box, 1512, 900, fitInsets(1512, false), MAX_ZOOM);
      expect(Number.isFinite(cam.x)).toBe(true);
      expect(Number.isFinite(cam.y)).toBe(true);
      expect(cam.zoom).toBeGreaterThanOrEqual(FIT_MIN_ZOOM);
      expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it("still respects MAX_ZOOM for a tiny graph", () => {
    const cam = computeFitCamera({ minX: -5, minY: -5, maxX: 5, maxY: 5 }, 1512, 900, fitInsets(1512, false), MAX_ZOOM);
    expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });
});

// ─── #4 · insets reflect the panels that are actually mounted ──────────────────────────────────
describe("#4 · fitInsets matches real panel geometry", () => {
  it("reserves the context panel only when a node is selected", () => {
    expect(fitInsets(1512, false).right).toBe(24);
    expect(fitInsets(1512, true).right).toBeGreaterThan(360);
  });

  it("reserves the attention panel only at the lg breakpoint", () => {
    expect(fitInsets(PANEL_BREAKPOINT, false).left).toBe(330);
    expect(fitInsets(PANEL_BREAKPOINT - 1, false).left).toBe(24);
  });

  it("reserves no panel column below the breakpoint, where the panel spans the width", () => {
    const i = fitInsets(900, true);
    expect(i.left).toBe(24);
    expect(i.right).toBe(24);
  });
});

// ─── #1 + #4 together · the whole graph is actually on screen ──────────────────────────────────
describe("fit framing · every node lands inside the region the panels leave free", () => {
  const VIEWPORTS: [number, number][] = [[1512, 900], [1728, 1117], [1280, 800], [1024, 768]];

  for (const withPanel of [false, true]) {
    for (const [vw, vh] of VIEWPORTS) {
      it(`${vw}x${vh} ${withPanel ? "with" : "without"} context panel`, () => {
        const { nodes, edges } = componentGraph([27, 9, 4, 4, 2, 1, 1, 1, 1]);
        const sim = new GraphSimulation(nodes, edges);
        sim.prewarm();
        const b = extentOf(sim);
        const insets = fitInsets(vw, withPanel);
        const cam = computeFitCamera(b, vw, vh, insets, MAX_ZOOM);

        for (const [wx, wy] of [
          [b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY],
        ]) {
          const p = toScreen(wx, wy, cam, vw, vh);
          expect(p.x).toBeGreaterThanOrEqual(insets.left - 1);
          expect(p.x).toBeLessThanOrEqual(vw - insets.right + 1);
          expect(p.y).toBeGreaterThanOrEqual(insets.top - 1);
          expect(p.y).toBeLessThanOrEqual(vh - insets.bottom + 1);
        }
      });
    }
  }
});

// ─── #3 · reduced motion suppresses animation, never rendering ─────────────────────────────────
describe("#3 · a camera change repaints even while the loop is idling", () => {
  const IDLE = {
    cooled: true, pulseCount: 0, pointerDown: false,
    reducedMotion: true, painted: true, dirty: false,
  };

  it("skips the frame when genuinely idle", () => {
    expect(shouldSkipFrame(IDLE)).toBe(true);
  });

  it("PAINTS when the camera has been moved (Fit / wheel zoom / fly-to)", () => {
    expect(shouldSkipFrame({ ...IDLE, dirty: true })).toBe(false);
  });

  it("never skips before the first paint, even if dirty is unset", () => {
    expect(shouldSkipFrame({ ...IDLE, painted: false })).toBe(false);
  });

  it("never skips while motion is allowed — that loop runs every frame", () => {
    expect(shouldSkipFrame({ ...IDLE, reducedMotion: false })).toBe(false);
  });

  it("never skips while the simulation is hot, a pulse is live, or a pointer is down", () => {
    expect(shouldSkipFrame({ ...IDLE, cooled: false })).toBe(false);
    expect(shouldSkipFrame({ ...IDLE, pulseCount: 1 })).toBe(false);
    expect(shouldSkipFrame({ ...IDLE, pointerDown: true })).toBe(false);
  });
});

// ─── toWorld · the inverse that had been missing ───────────────────────────────────────────────
//
// Asserted as a ROUND TRIP rather than against expected numbers. A pair of hand-computed
// expectations would pass while both functions drifted together in the same wrong direction; a round
// trip fails the moment they disagree, which is the only property that matters for a pair whose
// whole job is to be each other's inverse.

describe("toWorld · the exact inverse of toScreen", () => {
  const CAMERAS: FitCamera[] = [
    { x: 0, y: 0, zoom: 1 },
    { x: -240, y: 615, zoom: 0.25 },
    { x: 1000, y: -1000, zoom: 3.2 },
    { x: 12.5, y: -7.25, zoom: 0.837 },
  ];
  const VIEWS: [number, number][] = [[1200, 800], [375, 667], [2560, 1440]];

  it("world → screen → world returns the original point", () => {
    for (const cam of CAMERAS) {
      for (const [w, h] of VIEWS) {
        for (const [wx, wy] of [[0, 0], [250, -80], [-1234.5, 987.25]] as [number, number][]) {
          const s = toScreen(wx, wy, cam, w, h);
          const back = toWorld(s.x, s.y, cam, w, h);
          expect(back.x, `${cam.zoom}@${w}x${h}`).toBeCloseTo(wx, 9);
          expect(back.y).toBeCloseTo(wy, 9);
        }
      }
    }
  });

  it("screen → world → screen returns the original point", () => {
    for (const cam of CAMERAS) {
      for (const [sx, sy] of [[0, 0], [600, 400], [1199.5, 0.5]] as [number, number][]) {
        const w = toWorld(sx, sy, cam, 1200, 800);
        const back = toScreen(w.x, w.y, cam, 1200, 800);
        expect(back.x).toBeCloseTo(sx, 9);
        expect(back.y).toBeCloseTo(sy, 9);
      }
    }
  });

  it("the centre of the view is the camera's focal point, at every zoom", () => {
    // The one property worth stating directly: it is what makes "focus this node" expressible as
    // "set the camera to the node's position".
    for (const cam of CAMERAS) {
      const c = toWorld(600, 400, cam, 1200, 800);
      expect(c.x).toBeCloseTo(cam.x, 9);
      expect(c.y).toBeCloseTo(cam.y, 9);
    }
  });

  it("zoom scales screen distance, never world distance", () => {
    const near = { x: 0, y: 0, zoom: 2 };
    const far = { x: 0, y: 0, zoom: 0.5 };
    const a = toWorld(600, 400, near, 1200, 800);
    const b = toWorld(700, 400, near, 1200, 800);
    const c = toWorld(600, 400, far, 1200, 800);
    const d = toWorld(700, 400, far, 1200, 800);
    // The same 100px gap covers 4x more world at a quarter of the zoom.
    expect(b.x - a.x).toBeCloseTo(50, 9);
    expect(d.x - c.x).toBeCloseTo(200, 9);
  });
});

// ─── easeCamera / cameraSettled · the arithmetic behind a demand-driven transition ─────────────
//
// Asserted as CONVERGENCE, never as "the value changed". A random walk changes the value too; what
// makes an ease an ease is that the remaining distance shrinks monotonically and the loop that
// drives it can decide to stop. Both halves are tested, because a step function without a
// termination condition is an infinite loop and a termination condition without a step is a snap.

describe("easeCamera · a step toward a target, and nothing else", () => {
  const A: FitCamera = { x: 0, y: 0, zoom: 1 };
  const B: FitCamera = { x: 400, y: -250, zoom: 2.5 };

  it("moves exactly k of the remaining distance, on every axis including zoom", () => {
    const step = easeCamera(A, B, 0.25);
    expect(step.x).toBeCloseTo(100, 9);
    expect(step.y).toBeCloseTo(-62.5, 9);
    expect(step.zoom).toBeCloseTo(1.375, 9);
  });

  it("converges — the remaining distance strictly shrinks every step", () => {
    let cam = A;
    let previous = Infinity;
    for (let i = 0; i < 40; i++) {
      cam = easeCamera(cam, B, 0.2);
      const remaining = Math.hypot(B.x - cam.x, B.y - cam.y) + Math.abs(B.zoom - cam.zoom);
      expect(remaining, `step ${i} did not reduce the distance`).toBeLessThan(previous);
      previous = remaining;
    }
    expect(cameraSettled(cam, B), "40 steps did not settle").toBe(true);
  });

  it("k = 1 arrives immediately; k = 0 never moves", () => {
    expect(easeCamera(A, B, 1)).toEqual(B);
    expect(easeCamera(A, B, 0)).toEqual(A);
  });

  it("does not mutate either argument", () => {
    const from = { ...A };
    const to = { ...B };
    easeCamera(from, to, 0.3);
    expect(from).toEqual(A);
    expect(to).toEqual(B);
  });

  it("is already settled when it starts at its target — a loop would never begin", () => {
    expect(cameraSettled(B, B)).toBe(true);
  });
});

describe("cameraSettled · the termination condition", () => {
  it("tolerance is in SCREEN pixels, so it scales with zoom", () => {
    // Half a world unit apart. Invisible zoomed out; a clear gap zoomed in. A fixed world tolerance
    // would stop the ease too early up close, leaving a visible jump at the end.
    const a: FitCamera = { x: 0, y: 0, zoom: 0.1 };
    const b: FitCamera = { x: 0.5, y: 0, zoom: 0.1 };
    expect(cameraSettled(a, b), "a sub-pixel gap was treated as unsettled").toBe(true);

    const near: FitCamera = { x: 0, y: 0, zoom: 8 };
    const nearOff: FitCamera = { x: 0.5, y: 0, zoom: 8 };
    expect(cameraSettled(near, nearOff), "a 4px gap was treated as settled").toBe(false);
  });

  it("a zoom difference alone keeps it unsettled", () => {
    expect(cameraSettled({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1.5 })).toBe(false);
  });
});
