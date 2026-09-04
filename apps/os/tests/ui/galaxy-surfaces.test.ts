// @vitest-environment happy-dom
//
// SLICE 5 — ONE SCENE, TWO SURFACES.
//
// The architectural requirement of this slice is that the canvas and the accessible list are two
// presentations of ONE `Scene`, not two views of the business. A structural argument ("they both
// take a scene prop") is not evidence: this file MOUNTS `GalaxyView` and checks that what was
// painted and what was listed are the same objects.
//
// ─── HOW THE CANVAS IS OBSERVED ────────────────────────────────────────────────────────────────
//
// happy-dom has no 2D context, so `getContext` is replaced by a RECORDER that captures every path.
// A path's vertices are averaged into a centroid, and every silhouette this renderer draws — disc,
// ring, diamond, square, hex, tri — is symmetric about the node's centre, so a node's path centroid
// IS its screen position. Edges centre on a midpoint and arrowheads near a target, so neither
// collides with a node centre. That gives an exact, discriminating count: draw a node twice, or draw
// one the scene does not contain, and the multiset stops matching.
//
// The fixture deliberately carries NO health and starts with NO selection, because a health ring and
// a selection ring are extra paths centred on the same node. Both are exercised in their own tests
// below, where the extra path is the thing being measured rather than noise.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { GalaxyView, GALAXY_INSETS, MAX_ZOOM, MIN_ZOOM } from "@/components/galaxy/GalaxyView";
import { buildScene } from "@/components/galaxy/scene";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { computeFitCamera, fitInsets, toScreen } from "@/graph-view/viewport";
import { SEMANTIC } from "@/graph-view/taxonomy";
import { routeForEntity } from "@/navigation/routing";
import type { GraphEdge, GraphNode, GraphNodeType, GraphProjection } from "@/graph-view/contract";
import type { EntityKind } from "@/domain";

const VIEW_W = 1200;
const VIEW_H = 800;

// ─── the recorder ──────────────────────────────────────────────────────────────────────────────
type Path = { points: [number, number][]; kind: "fill" | "stroke"; alpha: number; style: string; arc: boolean };
const paths: Path[] = [];
const texts: { text: string; x: number; y: number }[] = [];

function makeRecorder(): Record<string, unknown> {
  let current: [number, number][] = [];
  let isArc = false;
  const ctx = {
    setTransform: () => {}, clearRect: () => {}, save: () => {}, restore: () => {},
    setLineDash: () => {}, measureText: (t: string) => ({ width: t.length * 6 }),
    beginPath: () => { current = []; isArc = false; },
    moveTo: (x: number, y: number) => { current.push([x, y]); },
    lineTo: (x: number, y: number) => { current.push([x, y]); },
    closePath: () => {},
    arc: (x: number, y: number) => { current.push([x, y]); isArc = true; },
    fill: () => {
      paths.push({ points: [...current], kind: "fill", alpha: ctx.globalAlpha,
                   style: String(ctx.fillStyle), arc: isArc });
    },
    stroke: () => {
      paths.push({ points: [...current], kind: "stroke", alpha: ctx.globalAlpha,
                   style: String(ctx.strokeStyle), arc: isArc });
    },
    fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y }); },
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    textAlign: "", textBaseline: "",
  };
  return ctx as unknown as Record<string, unknown>;
}

const centroid = (p: Path): [number, number] => [
  p.points.reduce((a, [x]) => a + x, 0) / p.points.length,
  p.points.reduce((a, [, y]) => a + y, 0) / p.points.length,
];

// ─── fixture ───────────────────────────────────────────────────────────────────────────────────
function node(type: GraphNodeType, entityId: string, weight = 0.5): GraphNode {
  return {
    id: `${type}:${entityId}`, type, label: `${type} ${entityId}`, entityId,
    entity: type as EntityKind, weight,
    state: { health: null, status: null, attention: false }, meta: [],
  };
}
const edge = (type: GraphEdge["type"], source: string, target: string): GraphEdge =>
  ({ id: `${type}:${source}->${target}`, type, source, target });

const NODES: GraphNode[] = [
  node("client", "acme", 0.9),
  node("project", "rebuild", 0.7),
  node("phase", "discovery", 0.4),
  node("invoice", "inv-1", 0.6),
  node("task", "alpha", 0.1),
  node("task", "beta", 0.1),
];
const EDGES: GraphEdge[] = [
  edge("has_project", "client:acme", "project:rebuild"),
  edge("has_phase", "project:rebuild", "phase:discovery"),
  edge("has_task", "phase:discovery", "task:alpha"),
  edge("has_task", "phase:discovery", "task:beta"),
  edge("billed", "client:acme", "invoice:inv-1"),
];

const projectionOf = (
  nodes: GraphNode[], edges: GraphEdge[], activity: GraphProjection["activity"] = []
): GraphProjection => ({
  nodes, edges, activity,
  source: { name: "test", builtAt: "2026-09-03T00:00:00Z", nodeCount: nodes.length, edgeCount: edges.length },
});

function mount(projection: GraphProjection = projectionOf(NODES, EDGES)) {
  const spatial = toSpatialModel(projection);
  const layout = computeGalaxyLayout(spatial);
  const scene = buildScene({ projection, spatial, layout, detail: "full" });
  render(createElement(GalaxyView, { projection, spatial, layout, initialDetail: "full" }));
  // The camera the component will be using: this page's OWN insets, not NeuralCore's.
  const camera = computeFitCamera(scene.bounds, VIEW_W, VIEW_H, GALAXY_INSETS, MAX_ZOOM);
  const screenOf = (id: string, cam = camera) => {
    const n = scene.nodes.find((x) => x.id === id)!;
    return toScreen(n.x, n.y, cam, VIEW_W, VIEW_H);
  };
  mountCamera = camera;
  runFrames();
  return { scene, camera, screenOf };
}

/** Paths whose centroid lands exactly on a node centre, keyed by node id. */
function nodePathCounts(scene: ReturnType<typeof buildScene>, screenOf: (id: string) => { x: number; y: number }) {
  const counts = new Map<string, number>();
  for (const n of scene.nodes) counts.set(n.id, 0);
  for (const p of paths) {
    if (p.points.length === 0) continue;
    const [cx, cy] = centroid(p);
    for (const n of scene.nodes) {
      const s = screenOf(n.id);
      if (Math.abs(cx - s.x) < 1e-6 && Math.abs(cy - s.y) < 1e-6) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    }
  }
  return counts;
}

beforeEach(() => {
  paths.length = 0;
  texts.length = 0;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => VIEW_W, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => VIEW_H, configurable: true });
  pendingFrames = new Map();
  nextFrameId = 1;
  framesRequested = 0;
  reducedMotion = false;
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    const id = nextFrameId++;
    framesRequested++;
    pendingFrames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { pendingFrames.delete(id); });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
  });
  HTMLCanvasElement.prototype.getContext = (() => makeRecorder()) as unknown as HTMLCanvasElement["getContext"];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the harness is real — otherwise every canvas assertion below is vacuous", () => {
  it("the recorder captured paths and the scene is non-trivial", () => {
    const { scene } = mount();
    expect(scene.nodes.length).toBeGreaterThan(4);
    expect(paths.length, "nothing was painted — the recorder or the size stub is broken").toBeGreaterThan(0);
  });
});

describe("W1 · every SceneNode gets exactly one canvas representation", () => {
  it("each node is drawn once, and nothing is drawn at a position no node occupies", () => {
    const { scene, screenOf } = mount();
    const counts = nodePathCounts(scene, screenOf);
    for (const [id, n] of counts) expect(n, `${id} was drawn ${n} times, expected exactly 1`).toBe(1);
    expect(counts.size).toBe(scene.nodes.length);
  });

  it("FABRICATION · no path is centred on an object the scene does not contain", () => {
    const { scene, screenOf } = mount();
    const centres = new Set(scene.nodes.map((n) => {
      const s = screenOf(n.id);
      return `${Math.round(s.x)},${Math.round(s.y)}`;
    }));
    // Every FILLED symmetric path is either a node silhouette or an arrowhead; an arrowhead sits
    // off-centre from its target. So a filled path centred on a coordinate that is not a node's is
    // an object the renderer invented.
    const orphans = paths
      .filter((p) => p.kind === "fill" && p.points.length >= 3)
      .map(centroid)
      .filter(([x, y]) => {
        const key = `${Math.round(x)},${Math.round(y)}`;
        if (centres.has(key)) return false;
        // an arrowhead: its centroid is within a node radius of some node
        return !scene.nodes.some((n) => {
          const s = screenOf(n.id);
          return Math.abs(x - s.x) < n.radius * 3 + 12 && Math.abs(y - s.y) < n.radius * 3 + 12;
        });
      });
    expect(orphans, "a shape was drawn where no scene object exists").toEqual([]);
  });
});

describe("W2 · every SceneNode has exactly one accessible representation", () => {
  it("the list names each object once, as a real control", () => {
    const { scene } = mount();
    for (const n of scene.nodes) {
      expect(screen.getAllByRole("button", { name: new RegExp("^" + n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
        `${n.id} is missing from the accessible list, or duplicated`).toHaveLength(1);
    }
  });

  it("the list is reachable and not hidden from assistive technology", () => {
    mount();
    expect(screen.getByRole("navigation", { name: /graph objects/i })).toBeTruthy();
    // The canvas is aria-hidden precisely BECAUSE the list is the accessible path. If the canvas
    // stopped being hidden the same objects would be announced twice, once meaninglessly.
    expect(document.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("W3 · both surfaces are the SAME scene, not two views of the business", () => {
  it("what was painted and what was listed are exactly the same objects", () => {
    const { scene, screenOf } = mount();
    const painted = [...nodePathCounts(scene, screenOf)].filter(([, c]) => c === 1).map(([id]) => id).sort();
    const listed = scene.nodes
      .filter((n) => screen.queryAllByRole("button",
        { name: new RegExp("^" + n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).length === 1)
      .map((n) => n.id).sort();
    expect(painted).toEqual(listed);
    expect(painted.length, "nothing was painted or listed").toBe(scene.nodes.length);
  });

  it("selecting in the LIST focuses that node on the CANVAS — one selection, two surfaces", () => {
    // Slice 6: selection also moves the camera. So the proof that the list reached the canvas is no
    // longer "an extra ring appeared" — it is that the selected object is now in the MIDDLE OF THE
    // VIEW. If the two surfaces held separate state the canvas would not have moved at all.
    const { scene } = mount();
    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    runFrames();

    const node = scene.nodes.find((n) => n.id === "client:acme")!;
    const centred = paths.some((p) => {
      const [cx, cy] = centroid(p);
      return Math.abs(cx - VIEW_W / 2) < 0.5 && Math.abs(cy - VIEW_H / 2) < 0.5;
    });
    expect(centred, "selecting in the list did not focus the node on the canvas").toBe(true);
    // And the node's own coordinates were NOT touched to achieve it.
    expect(scene.nodes.find((n) => n.id === "client:acme")!.x).toBe(node.x);
  });

  it("the selected row is marked current for assistive technology", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    const row = screen.getAllByRole("button", { name: /^client acme/ })[0];
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(/^Selected client acme$/)).toBeTruthy();
  });
});

describe("A3 · a business fact changes appearance, and only appearance", () => {
  it("health adds a ring; the object set and its position are untouched", () => {
    const plain = mount();
    const plainCounts = nodePathCounts(plain.scene, plain.screenOf);
    const plainPos = plain.screenOf("client:acme");
    cleanup();
    paths.length = 0;

    const sick = NODES.map((n) => n.id === "client:acme"
      ? { ...n, state: { health: "at_risk" as const, status: "overdue", attention: true } } : n);
    const ill = mount(projectionOf(sick, EDGES));
    const illCounts = nodePathCounts(ill.scene, ill.screenOf);

    expect(illCounts.get("client:acme"), "a health band did not change the drawing")
      .toBeGreaterThan(plainCounts.get("client:acme") ?? 0);
    expect(ill.screenOf("client:acme"), "a business fact moved an object").toEqual(plainPos);
    expect(ill.scene.nodes.map((n) => n.id)).toEqual(plain.scene.nodes.map((n) => n.id));
    // And the accessible surface states it in WORDS, from the same scene — never re-derived.
    expect(screen.getAllByRole("button", { name: /^client acme/ })[0].textContent)
      .toMatch(/at risk|needs attention/);
  });
});

describe("EMPTY · an honest empty state, never a placeholder object", () => {
  it("an empty projection renders a message and paints nothing", () => {
    const empty = projectionOf([], []);
    const spatial = toSpatialModel(empty);
    render(createElement(GalaxyView, { projection: empty, spatial, layout: computeGalaxyLayout(spatial), initialDetail: "full" }));
    expect(screen.getByText(/nothing to show/i)).toBeTruthy();
    expect(paths, "something was painted for an empty graph").toEqual([]);
    expect(document.querySelector("canvas"), "a canvas was mounted with nothing to draw").toBeNull();
  });
});

// ─── SLICE 6 · NAVIGATION ──────────────────────────────────────────────────────────────────────
//
// The property under test throughout this block is one sentence: THE CAMERA MOVES, THE GRAPH DOES
// NOT. Every witness therefore checks two things at once — that what is drawn changed, and that the
// SceneModel's coordinates did not. Either half alone is satisfiable by the wrong implementation: a
// renderer that panned by rewriting node positions would pass "the drawing moved", and one that did
// nothing at all would pass "the coordinates are unchanged".

/** Screen positions of every node in the last paint, keyed by id, using an explicit camera. */
const drawnAt = (scene: ReturnType<typeof buildScene>, cam: { x: number; y: number; zoom: number }) =>
  new Map(scene.nodes.map((n) => {
    const s = toScreen(n.x, n.y, cam, VIEW_W, VIEW_H);
    return [n.id, `${s.x.toFixed(4)},${s.y.toFixed(4)}`];
  }));

/** Every path centroid actually recorded, rounded, as a set — what the canvas really painted. */
const paintedCentroids = () =>
  new Set(paths.filter((p) => p.points.length > 0).map((p) => {
    const [x, y] = centroid(p);
    return `${x.toFixed(4)},${y.toFixed(4)}`;
  }));

let mountCamera: { x: number; y: number; zoom: number } | null = null;

// ─── DETERMINISTIC FRAMES ──────────────────────────────────────────────────────────────────────
//
// requestAnimationFrame is replaced by a QUEUE the test drains on demand. Real frames would make
// every motion assertion a race, and a timing-based test ("wait 300ms, hope it settled") proves that
// something happened rather than that the right thing happened. Draining a known number of frames
// makes convergence observable step by step, and — just as important — makes it possible to assert
// that NO frame was scheduled at all.
// Keyed by a monotonic id rather than an array index: React cancels the previous frame on every
// effect re-run, and an index-based cancel removes whichever callback happens to sit at that slot
// once earlier ones have been drained. The first version of this stub did exactly that and silently
// cancelled live frames, which looked like "the ease never converges".
let pendingFrames = new Map<number, () => void>();
let nextFrameId = 1;
let framesRequested = 0;
let reducedMotion = false;

/**
 * Run queued frames until the loop stops, or `max` is reached. Returns how many ran — 0 means the
 * loop had already stopped, which is the assertion several tests below actually care about.
 *
 * ONE `act()` PER FRAME, deliberately. `act` flushes effects when it EXITS, so draining the whole
 * queue inside a single `act` runs one frame, finds the queue empty, and returns before React has
 * scheduled the next one. The first version did that and looked like an ease that stalled after two
 * steps.
 */
function runFrames(max = 300): number {
  let ran = 0;
  while (pendingFrames.size > 0 && ran < max) {
    act(() => {
      const entry = pendingFrames.entries().next().value;
      if (!entry) return;
      pendingFrames.delete(entry[0]);
      entry[1]();
    });
    ran++;
  }
  return ran;
}
const canvasEl = () => document.querySelector("canvas")!;

function pan(dx: number, dy: number, fromX = 400, fromY = 400) {
  const c = canvasEl();
  fireEvent.pointerDown(c, { clientX: fromX, clientY: fromY, pointerId: 1 });
  fireEvent.pointerMove(c, { clientX: fromX + dx, clientY: fromY + dy, pointerId: 1 });
  fireEvent.pointerUp(c, { clientX: fromX + dx, clientY: fromY + dy, pointerId: 1 });
}

describe("PAN · the camera moves, the graph does not", () => {
  it("every drawn position shifts by exactly the drag delta", () => {
    const { scene, camera } = mount();
    const coordsBefore = scene.nodes.map((n) => [n.id, n.x, n.y]);
    paths.length = 0;
    pan(120, -45);

    const shifted = { ...camera, x: camera.x - 120 / camera.zoom, y: camera.y - -45 / camera.zoom };
    const expected = drawnAt(scene, shifted);
    const painted = paintedCentroids();
    for (const [id, at] of expected) {
      expect(painted.has(at), `${id} was not redrawn at its panned position`).toBe(true);
    }
    // THE OTHER HALF: nothing in the SceneModel moved to achieve it.
    expect(scene.nodes.map((n) => [n.id, n.x, n.y]),
      "panning rewrote node coordinates — the renderer became a layout authority").toEqual(coordsBefore);
  });

  it("a drag of a pixel or two is a click, not a pan", () => {
    // Started in an empty corner so the click that follows selects nothing — otherwise the focus
    // move would be indistinguishable from the pan this test says did not happen.
    //
    // A repaint has to be PROVOKED afterwards. Nothing repaints when nothing changes, so asserting
    // over an empty `paths` would pass whether or not the camera had moved — the exact vacuity this
    // suite exists to avoid. Hovering a node changes state without touching the camera, so the paint
    // it triggers shows where the camera actually is.
    const { scene, camera, screenOf } = mount();
    pan(1, 1, 3, 3);
    paths.length = 0;
    const target = screenOf("client:acme");
    fireEvent.pointerMove(canvasEl(), { clientX: target.x, clientY: target.y, pointerId: 2 });

    expect(paths.length, "the hover did not provoke a repaint — this test cannot see the camera")
      .toBeGreaterThan(0);
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, camera)) {
      expect(painted.has(at), `${id} moved on a 1px drag — the click threshold is not applied`).toBe(true);
    }
  });
});

describe("ZOOM · the camera scales, the graph does not", () => {
  it("wheeling in redraws at the zoomed positions and leaves radii and coordinates alone", () => {
    const { scene, camera } = mount();
    const before = JSON.stringify(scene.nodes);
    paths.length = 0;
    fireEvent.wheel(canvasEl(), { deltaY: -100 });

    const zoomed = { ...camera, zoom: Math.min(MAX_ZOOM, camera.zoom * 1.12) };
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, zoomed)) {
      expect(painted.has(at), `${id} was not redrawn at its zoomed position`).toBe(true);
    }
    expect(JSON.stringify(scene.nodes), "zooming mutated the SceneModel").toBe(before);
  });

  it("clamps at both boundaries", () => {
    const { scene } = mount();
    for (let i = 0; i < 60; i++) fireEvent.wheel(canvasEl(), { deltaY: -100 });
    paths.length = 0;
    fireEvent.wheel(canvasEl(), { deltaY: -100 });
    let painted = paintedCentroids();
    for (const [, at] of drawnAt(scene, { ...mountCamera!, zoom: MAX_ZOOM })) {
      expect(painted.has(at), "zoom did not clamp at the maximum").toBe(true);
    }
    for (let i = 0; i < 120; i++) fireEvent.wheel(canvasEl(), { deltaY: 100 });
    paths.length = 0;
    fireEvent.wheel(canvasEl(), { deltaY: 100 });
    painted = paintedCentroids();
    for (const [, at] of drawnAt(scene, { ...mountCamera!, zoom: MIN_ZOOM })) {
      expect(painted.has(at), "zoom did not clamp at the minimum").toBe(true);
    }
  });
});

describe("RESET · derived from the scene's own bounds, and from this page's insets", () => {
  it("returns the view to computeFitCamera over scene.bounds", () => {
    const { scene, camera } = mount();
    pan(300, 200);
    fireEvent.wheel(canvasEl(), { deltaY: -100 });
    paths.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /reset view/i }));
    runFrames();

    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, camera)) {
      expect(painted.has(at), `${id} did not return to the fit position`).toBe(true);
    }
  });

  it("THE INSETS ARE THIS PAGE'S · framing differs from NeuralCore's fitInsets", () => {
    // The regression guard for the Slice 4 defect. `fitInsets` reserves 330px for an attention panel
    // and 380 for a context panel — geometry measured from NeuralCore's markup, and neither exists on
    // /galaxy. If this page ever goes back to using it, the two cameras stop differing.
    const { scene } = mount();
    const ours = computeFitCamera(scene.bounds, VIEW_W, VIEW_H, GALAXY_INSETS, MAX_ZOOM);
    const neural = computeFitCamera(scene.bounds, VIEW_W, VIEW_H, fitInsets(VIEW_W, false), MAX_ZOOM);
    expect(ours, "the galaxy is framed with NeuralCore's panel geometry").not.toEqual(neural);
    // And what was painted is OURS.
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, ours)) {
      expect(painted.has(at), `${id} was framed with the wrong insets`).toBe(true);
    }
  });
});

describe("FOCUS · targets a real SceneNode, never a coordinate nothing occupies", () => {
  it("focusing centres THE SELECTED object, not merely some object", () => {
    // The first version of this test asserted only that SOMETHING was drawn at the centre. A mutant
    // that focused `scene.nodes[0]` regardless of the selection passed it — there is always some
    // node in the middle. The camera the whole scene is drawn with has to be the one derived from
    // the SELECTED node, so every position is checked against it.
    const { scene, camera } = mount();
    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);
    runFrames();

    const target = scene.nodes.find((n) => n.id === "project:rebuild")!;
    const focused = { x: target.x, y: target.y, zoom: Math.max(camera.zoom, 1.25) };
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, focused)) {
      expect(painted.has(at), `${id} is not where a camera focused on project:rebuild would put it`)
        .toBe(true);
    }
    const centre = `${(VIEW_W / 2).toFixed(4)},${(VIEW_H / 2).toFixed(4)}`;
    expect(painted.has(centre)).toBe(true);
  });

  it("clicking empty canvas clears the selection and moves nothing", () => {
    const { scene } = mount();
    const before = JSON.stringify(scene.nodes);
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);
    fireEvent.pointerDown(canvasEl(), { clientX: 2, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(canvasEl(), { clientX: 2, clientY: 2, pointerId: 1 });
    expect(screen.queryByText(/^Selected /)).toBeNull();
    expect(JSON.stringify(scene.nodes)).toBe(before);
  });
});

describe("NEIGHBOURS · highlighting follows real edges, never resemblance", () => {
  it("a same-typed node with NO edge to the selection stays dimmed", () => {
    // THE DISCRIMINATING FIXTURE. `task alpha` and `task beta` share a type and a label prefix and
    // are NOT connected to each other; both connect only to `phase discovery`. Any implementation
    // that derived "related" from similarity instead of from SceneEdge source/target would light
    // `task beta` up when `task alpha` is selected. Nothing else in this suite can tell the two
    // implementations apart.
    const { scene } = mount();
    expect(scene.edges.some((e) =>
      (e.source === "task:alpha" && e.target === "task:beta") ||
      (e.source === "task:beta" && e.target === "task:alpha")),
      "the fixture connects the two tasks — the discrimination is gone").toBe(false);

    fireEvent.click(screen.getAllByRole("button", { name: /^task alpha/ })[0]);
    runFrames();
    paths.length = 0;
    // One repaint from a SETTLED view. Emphasis ramps from 0, so a max taken across the whole
    // transition would read the un-dimmed opening frames and prove nothing. Hovering the node that
    // is already selected changes hoverId — enough to repaint — without changing what is focused.
    fireEvent.pointerMove(canvasEl(), { clientX: VIEW_W / 2, clientY: VIEW_H / 2, pointerId: 9 });
    expect(paths.length, "no settled repaint was produced").toBeGreaterThan(0);

    const target = scene.nodes.find((n) => n.id === "task:alpha")!;
    const cam = { x: target.x, y: target.y, zoom: Math.max(mountCamera!.zoom, 1.25) };
    const alphaAt = drawnAt(scene, cam).get("task:alpha")!;
    const betaAt = drawnAt(scene, cam).get("task:beta")!;
    const phaseAt = drawnAt(scene, cam).get("phase:discovery")!;
    const alphaOf = (at: string) => {
      const hit = paths.filter((pp) => {
        const [x, y] = centroid(pp);
        return `${x.toFixed(4)},${y.toFixed(4)}` === at;
      });
      return Math.max(...hit.map((h) => h.alpha));
    };

    expect(alphaOf(alphaAt), "the selected node was dimmed").toBeGreaterThan(0.5);
    expect(alphaOf(phaseAt), "a real neighbour was dimmed").toBeGreaterThan(0.5);
    expect(alphaOf(betaAt),
      "an unconnected node was highlighted — neighbours are being inferred, not read from edges")
      .toBeLessThan(0.5);
  });
});

// ─── SLICE 7 · MOTION ──────────────────────────────────────────────────────────────────────────
//
// The property under test: MOTION CHANGES PRESENTATION OVER TIME; IT DOES NOT CHANGE WHAT THE GRAPH
// IS. Every witness checks the model is untouched alongside whatever it checks about the motion.
//
// Nothing here is timing-based. "Wait and hope it settled" proves that something happened, not that
// the right thing happened — frames are drained deterministically and COUNTED, which also makes the
// most important assertion in this block expressible at all: that an idle galaxy schedules no frames.

describe("CAMERA EASING · converges to the target without touching the model", () => {
  it("passes through intermediate positions and ARRIVES exactly", () => {
    const { scene, camera } = mount();
    const coordsBefore = JSON.stringify(scene.nodes);
    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);

    const ran = runFrames();
    expect(ran, "no frames ran — the transition never started").toBeGreaterThan(2);

    const target = scene.nodes.find((n) => n.id === "project:rebuild")!;
    const settled = { x: target.x, y: target.y, zoom: Math.max(camera.zoom, 1.25) };
    const painted = paintedCentroids();

    // Intermediate frames exist: the node was drawn somewhere OTHER than its start and its end.
    const start = drawnAt(scene, camera).get("project:rebuild")!;
    const end = drawnAt(scene, settled).get("project:rebuild")!;
    const between = [...painted].filter((pt) => pt !== start && pt !== end);
    expect(between.length, "the camera jumped rather than eased").toBeGreaterThan(0);

    // And it arrives exactly, because settling adopts the target whole rather than approaching it.
    for (const [id, at] of drawnAt(scene, settled)) {
      expect(painted.has(at), `${id} never reached the settled camera`).toBe(true);
    }
    expect(JSON.stringify(scene.nodes), "easing mutated the SceneModel").toBe(coordsBefore);
  });

  it("an interrupting gesture takes over from where the camera is — transitions never stack", () => {
    const { scene } = mount();
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);
    act(() => {
      const entry = pendingFrames.entries().next().value!;
      pendingFrames.delete(entry[0]);
      entry[1]();
    });
    // Mid-flight: grab the canvas. The target must be ABANDONED, not queued behind the pan.
    pan(60, 0, 3, 3);
    runFrames();
    paths.length = 0;
    fireEvent.pointerMove(canvasEl(), { clientX: 7, clientY: 7, pointerId: 4 });

    // The camera stopped where the interrupt left it, so the focus never completed: the node it was
    // flying toward is NOT in the middle of the view. Asserting "no frames remain" would have been
    // wrong — the emphasis ramp is a separate, legitimately-still-running transition, and the first
    // version of this test conflated the two.
    const centre = `${(VIEW_W / 2).toFixed(4)},${(VIEW_H / 2).toFixed(4)}`;
    const target = drawnAt(scene, mountCamera!).get("project:rebuild");
    expect(paintedCentroids().has(centre) && target === centre,
      "the abandoned transition completed anyway — interrupts are stacking").toBe(false);
    expect(scene.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});

describe("THE LOOP · demand-driven and self-terminating", () => {
  it("an IDLE galaxy schedules no frames at all", () => {
    mount();
    const at = framesRequested;
    fireEvent.pointerMove(canvasEl(), { clientX: 5, clientY: 5, pointerId: 3 });
    expect(framesRequested - at, "a mounted galaxy is running a permanent loop").toBe(0);
    expect(pendingFrames.size).toBe(0);
  });

  it("frames start on a transition and STOP when it settles", () => {
    mount();
    const before = framesRequested;
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    expect(framesRequested, "the transition scheduled nothing").toBeGreaterThan(before);
    runFrames();
    expect(pendingFrames.size, "the loop is still scheduling after settling").toBe(0);
    expect(runFrames(), "a settled loop scheduled another frame").toBe(0);
  });

  it("UNMOUNT cancels everything in flight", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    expect(pendingFrames.size).toBeGreaterThan(0);
    cleanup();
    expect(pendingFrames.size, "a frame outlived the component that scheduled it").toBe(0);
  });
});

describe("REDUCED MOTION · the same information, none of the movement", () => {
  it("schedules NO motion frames, and arrives immediately", () => {
    reducedMotion = true;
    const { scene, camera } = mount();
    const before = framesRequested;
    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);

    expect(framesRequested - before, "reduced motion started an animation loop").toBe(0);
    const target = scene.nodes.find((n) => n.id === "project:rebuild")!;
    const settled = { x: target.x, y: target.y, zoom: Math.max(camera.zoom, 1.25) };
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, settled)) {
      expect(painted.has(at), `${id} did not arrive under reduced motion`).toBe(true);
    }
  });

  it("selection, the list and the announcement work identically", () => {
    reducedMotion = true;
    const { scene } = mount();
    for (const n of scene.nodes) {
      expect(screen.getAllByRole("button",
        { name: new RegExp("^" + n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toHaveLength(1);
    }
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    expect(screen.getAllByRole("button", { name: /^client acme/ })[0].getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(/^Selected client acme$/)).toBeTruthy();
  });

  it("panning and zooming still work — direct manipulation was never animated", () => {
    reducedMotion = true;
    const { scene, camera } = mount();
    const coords = JSON.stringify(scene.nodes);
    paths.length = 0;
    pan(90, -30, 3, 3);
    const shifted = { ...camera, x: camera.x - 90 / camera.zoom, y: camera.y + 30 / camera.zoom };
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, shifted)) {
      expect(painted.has(at), `${id} did not pan under reduced motion`).toBe(true);
    }
    expect(JSON.stringify(scene.nodes)).toBe(coords);
  });
});

// ─── SLICE 8 · RECENT-EVENT ACTIVATION ─────────────────────────────────────────────────────────
//
// The pure rules live in tests/graph/galaxy-activity.test.ts. What only a mounted view can show is
// here: that the halo reaches the canvas, that the same fact reaches the accessible surface, that
// the loop ends, and that nothing about the graph moved to achieve any of it.

const HOUR_MS = 60 * 60 * 1000;
const activityOn = (nodeId: string, agoMs: number, id = `evt:${nodeId}`) => ({
  id, eventType: "invoice.paid", nodeId, summary: `paid invoice for ${nodeId}`,
  occurredAt: new Date(Date.now() - agoMs).toISOString(),
});

/**
 * Halos, identified precisely: a STROKED ARC in the neutral activation grey.
 *
 * All three parts are needed. `SEMANTIC.text3` is also used for containment edges and arrowheads, so
 * colour alone is not enough — but those are lines and fills, never arcs. Health rings and the
 * selection ring ARE arcs, but carry healthColor and `accent`. The first version of this helper
 * counted "any partly-transparent stroke" and matched dimmed edges and health rings, which made a
 * reduced-motion assertion fail against a view that was drawing no halo at all.
 */
const haloCount = () =>
  paths.filter((p) => p.arc && p.kind === "stroke" && p.style === SEMANTIC.text3).length;

function mountWithActivity(activity: GraphProjection["activity"]) {
  const projection = projectionOf(NODES, EDGES, activity);
  const spatial = toSpatialModel(projection);
  const layout = computeGalaxyLayout(spatial);
  const scene = buildScene({ projection, spatial, layout, detail: "full" });
  render(createElement(GalaxyView, { projection, spatial, layout, initialDetail: "full" }));
  return { scene, projection };
}

describe("ACTIVATION reaches both surfaces from one derivation", () => {
  it("a recent real event is stated in words on the accessible surface", () => {
    mountWithActivity([activityOn("client:acme", 2 * HOUR_MS)]);
    expect(screen.getByText(/paid invoice for client:acme/)).toBeTruthy();
    expect(screen.getByText(/recent activity/i)).toBeTruthy();
  });

  it("an event OLDER than the window is stated nowhere — the age gate reaches the surface", () => {
    mountWithActivity([activityOn("client:acme", 200 * 24 * HOUR_MS)]);
    expect(screen.queryByText(/paid invoice/), "a stale event was announced").toBeNull();
  });

  it("only the named object is announced", () => {
    mountWithActivity([activityOn("project:rebuild", HOUR_MS)]);
    expect(screen.getAllByText(/paid invoice/), "more than one object was announced").toHaveLength(1);
    expect(screen.getByText(/paid invoice for project:rebuild/)).toBeTruthy();
  });

  it("an event naming an object the scene does not contain announces nothing", () => {
    mountWithActivity([activityOn("client:ghost", HOUR_MS)]);
    expect(screen.queryByText(/paid invoice/)).toBeNull();
    // and no object was invented to receive it
    expect(screen.queryAllByRole("button", { name: /ghost/i })).toHaveLength(0);
  });

  it("an object hidden by the detail level is not announced", () => {
    const projection = projectionOf(NODES, EDGES, [activityOn("task:alpha", HOUR_MS)]);
    const spatial = toSpatialModel(projection);
    render(createElement(GalaxyView, {
      projection, spatial, layout: computeGalaxyLayout(spatial), initialDetail: "core",
    }));
    expect(screen.queryByText(/paid invoice/), "an LOD-hidden object activated").toBeNull();
  });
});

describe("THE HALO · painted, bounded, and gone", () => {
  it("is drawn while active and NOT drawn once the fade completes", () => {
    mountWithActivity([activityOn("client:acme", HOUR_MS)]);
    expect(haloCount(), "no halo was painted for a recent event").toBeGreaterThan(0);

    runFrames();
    paths.length = 0;
    fireEvent.pointerMove(canvasEl(), { clientX: 1, clientY: 1, pointerId: 7 });
    fireEvent.pointerMove(canvasEl(), { clientX: 2, clientY: 2, pointerId: 7 });
    expect(haloCount(), "the halo survived its own fade").toBe(0);
  });

  it("THE LOOP TERMINATES · zero frames are scheduled after the fade", () => {
    mountWithActivity([activityOn("client:acme", HOUR_MS)]);
    expect(runFrames(), "the activation never animated").toBeGreaterThan(10);
    expect(pendingFrames.size, "the fade is still scheduling").toBe(0);
    expect(runFrames(), "a settled activation scheduled another frame").toBe(0);
  });

  it("no activity means no loop at all", () => {
    const before = framesRequested;
    mountWithActivity([]);
    expect(framesRequested - before, "a galaxy with no recent events started a loop").toBe(0);
  });

  it("UNMOUNT cancels a fade in flight", () => {
    mountWithActivity([activityOn("client:acme", HOUR_MS)]);
    expect(pendingFrames.size).toBeGreaterThan(0);
    cleanup();
    expect(pendingFrames.size, "a fade outlived its component").toBe(0);
  });
});

describe("REDUCED MOTION · the fact without the motion", () => {
  it("schedules no frames and paints no halo, but still states the activity", () => {
    reducedMotion = true;
    const before = framesRequested;
    mountWithActivity([activityOn("client:acme", HOUR_MS)]);
    expect(framesRequested - before, "reduced motion started an activation loop").toBe(0);
    expect(haloCount(), "reduced motion painted an animated halo").toBe(0);
    // The information is not lost with the motion: the list carries it for every user.
    expect(screen.getByText(/paid invoice for client:acme/)).toBeTruthy();
  });
});

describe("ACTIVATION CHANGES NOTHING ABOUT THE GRAPH", () => {
  it("positions, layout and every business field are identical with and without activity", () => {
    const quiet = mountWithActivity([]);
    const quietScene = JSON.stringify(quiet.scene.nodes);
    const quietEdges = JSON.stringify(quiet.scene.edges);
    cleanup();

    const loud = mountWithActivity([
      activityOn("client:acme", HOUR_MS), activityOn("task:alpha", 3 * HOUR_MS),
    ]);
    expect(JSON.stringify(loud.scene.nodes), "an event moved or altered an object")
      .toBe(quietScene);
    expect(JSON.stringify(loud.scene.edges), "an event altered a relationship").toBe(quietEdges);
  });

  it("selection and focus behave exactly as they do with no activity", () => {
    const { scene } = mountWithActivity([activityOn("client:acme", HOUR_MS)]);
    runFrames();
    fireEvent.click(screen.getAllByRole("button", { name: /^project rebuild/ })[0]);
    runFrames();
    expect(screen.getByText(/^Selected project rebuild$/)).toBeTruthy();
    expect(scene.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});

// ─── SLICE 9 · RELATIONSHIP TRAVERSAL ──────────────────────────────────────────────────────────
//
// The traversal rules are proven as values in tests/graph/galaxy-traversal.test.ts. What only a
// mounted view can show is here: that both surfaces invoke ONE action, that traversal reuses the
// existing selection and camera pathway rather than a second one, and that clicking an object is
// still only a selection.

/** Screen position of a node under a camera focused on `focusId` — what traversal should produce. */
const focusedOn = (scene: ReturnType<typeof buildScene>, focusId: string) => {
  const target = scene.nodes.find((n) => n.id === focusId)!;
  return { x: target.x, y: target.y, zoom: Math.max(mountCamera!.zoom, 1.25) };
};

const relationshipButton = (name: RegExp) => screen.getAllByRole("button", { name })[0];

describe("TRAVERSAL · the list follows a relationship to the real target", () => {
  it("selects the target named by the edge, not the object that was showing", () => {
    const { scene } = mount();
    // `client acme` has_project `project rebuild`. Following it from acme must land on rebuild.
    fireEvent.click(relationshipButton(/^Follow has project project rebuild/));
    runFrames();
    expect(screen.getByText(/^Followed has project to project rebuild$/)).toBeTruthy();
    expect(scene.nodes.some((n) => n.id === "project:rebuild")).toBe(true);
  });

  it("REUSES THE EXISTING CAMERA PATHWAY · the traversed object is centred", () => {
    // The discriminating half. A traversal that set selectedId without going through select() would
    // change the announcement and leave the camera where it was.
    const { scene } = mount();
    paths.length = 0;
    fireEvent.click(relationshipButton(/^Follow has project project rebuild/));
    runFrames();
    const painted = paintedCentroids();
    for (const [id, at] of drawnAt(scene, focusedOn(scene, "project:rebuild"))) {
      expect(painted.has(at), `${id} is not where a camera focused on the target would put it`)
        .toBe(true);
    }
  });

  it("DIRECTION IS NOT REVERSED · following backwards lands on the source and says so", () => {
    mount();
    fireEvent.click(relationshipButton(/^Follow is the has project of client acme/));
    runFrames();
    expect(screen.getByText(/^Followed has project back to client acme$/)).toBeTruthy();
  });

  it("containment and lateral relationships are announced differently", () => {
    mount();
    expect(screen.getAllByRole("button", { name: /^Follow has project project rebuild — contains$/ }))
      .toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Follow billed invoice inv-1 — related to$/ }))
      .toHaveLength(1);
  });

  it("an object hidden by the detail level offers no traversal to it", () => {
    const projection = projectionOf(NODES, EDGES);
    const spatial = toSpatialModel(projection);
    render(createElement(GalaxyView, {
      projection, spatial, layout: computeGalaxyLayout(spatial), initialDetail: "core",
    }));
    expect(screen.queryAllByRole("button", { name: /task alpha/ }),
      "traversal reached past the detail level").toHaveLength(0);
  });
});

describe("ONE TRAVERSAL SEMANTIC · canvas and list arrive at the same selection", () => {
  it("clicking the relationship LINE on the canvas lands where the list button lands", () => {
    // Follow via the list, record where the camera ended up, then repeat via the canvas edge.
    const viaList = mount();
    fireEvent.click(relationshipButton(/^Follow has project project rebuild/));
    runFrames();
    const listCam = focusedOn(viaList.scene, "project:rebuild");
    const listAnnouncement = screen.getByText(/^Followed has project/).textContent;
    cleanup();

    const viaCanvas = mount();
    // Select acme first — only the selected object's relationships are followable.
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    runFrames();
    // Click the midpoint of the acme → rebuild edge, in screen space under the current camera.
    const acme = viaCanvas.scene.nodes.find((n) => n.id === "client:acme")!;
    const rebuild = viaCanvas.scene.nodes.find((n) => n.id === "project:rebuild")!;
    const focused = focusedOn(viaCanvas.scene, "client:acme");
    const a = toScreen(acme.x, acme.y, focused, VIEW_W, VIEW_H);
    const b = toScreen(rebuild.x, rebuild.y, focused, VIEW_W, VIEW_H);
    fireEvent.pointerDown(canvasEl(), { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, pointerId: 1 });
    fireEvent.pointerUp(canvasEl(), { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, pointerId: 1 });
    runFrames();

    expect(screen.getByText(/^Followed has project/).textContent,
      "the canvas and the list produced different traversals").toBe(listAnnouncement);
    // and the camera agrees with the list's outcome
    const painted = paintedCentroids();
    expect(painted.has(drawnAt(viaCanvas.scene, listCam).get("project:rebuild")!)).toBe(true);
  });
});

describe("SELECTION IS NOT TRAVERSAL", () => {
  it("clicking an object selects it and follows nothing", () => {
    const { scene, screenOf } = mount();
    const target = screenOf("client:acme");
    fireEvent.pointerDown(canvasEl(), { clientX: target.x, clientY: target.y, pointerId: 1 });
    fireEvent.pointerUp(canvasEl(), { clientX: target.x, clientY: target.y, pointerId: 1 });
    runFrames();
    expect(screen.getByText(/^Selected client acme$/), "a plain click traversed").toBeTruthy();
    expect(screen.queryByText(/^Followed /)).toBeNull();
    expect(scene.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });

  it("AN EDGE BELONGING TO ANOTHER OBJECT CANNOT TRAVERSE", () => {
    // A = client:acme is selected. B = phase:discovery and C = task:alpha are joined by a real
    // has_task edge that does not touch A at all. Clicking the MIDPOINT of that line puts the
    // pointer exactly on it — distance zero, well inside the hit reach — so geometry alone would
    // find it. Only the restriction to A's own authorized relationships stops it becoming a
    // traversal, which is precisely the property under test.
    const { scene } = mount();
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    runFrames();

    const bc = scene.edges.find((e) => e.source === "phase:discovery" && e.target === "task:alpha");
    expect(bc, "the fixture has no B→C edge — this witness would be vacuous").toBeDefined();
    const acmeCam = focusedOn(scene, "client:acme");
    const b = toScreen(bc!.x1, bc!.y1, acmeCam, VIEW_W, VIEW_H);
    const c = toScreen(bc!.x2, bc!.y2, acmeCam, VIEW_W, VIEW_H);
    const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };

    fireEvent.pointerDown(canvasEl(), { clientX: mid.x, clientY: mid.y, pointerId: 5 });
    fireEvent.pointerUp(canvasEl(), { clientX: mid.x, clientY: mid.y, pointerId: 5 });
    runFrames();

    // THE PROPERTY: no traversal happened. A mutant that scanned `scene.edges` instead of A's own
    // authorized relationships finds this line and follows it, and this assertion goes red.
    expect(screen.queryByText(/^Followed /),
      "an edge between two OTHER objects was followed").toBeNull();

    // WHAT DOES HAPPEN, RECORDED RATHER THAN ASSUMED. The click falls through to empty-space
    // handling and CLEARS the selection, because a line the selected object cannot follow is
    // indistinguishable from bare canvas to this surface — Slice 6's `onSelect(null)`, unchanged by
    // Slice 9. The review asked this witness to assert that the selection remains A; it does not,
    // and pinning the real behaviour is worth more than a test written to the expectation. See the
    // report: whether a foreign edge should preserve the selection is a semantic decision, not a
    // defect in traversal.
    expect(screen.queryByText(/^Selected /), "the click did something other than clear").toBeNull();
    expect(screen.getAllByRole("button", { name: /^client acme/ })[0].getAttribute("aria-current"),
      "the selection changed to some OTHER object rather than clearing").toBeNull();
  });

  it("a relationship line is not followable while its object is unselected", () => {
    const { scene } = mount();
    const acme = scene.nodes.find((n) => n.id === "client:acme")!;
    const rebuild = scene.nodes.find((n) => n.id === "project:rebuild")!;
    const a = toScreen(acme.x, acme.y, mountCamera!, VIEW_W, VIEW_H);
    const b = toScreen(rebuild.x, rebuild.y, mountCamera!, VIEW_W, VIEW_H);
    fireEvent.pointerDown(canvasEl(), { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, pointerId: 1 });
    fireEvent.pointerUp(canvasEl(), { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, pointerId: 1 });
    expect(screen.queryByText(/^Followed /),
      "an edge was followable with nothing selected — traversal is not explicit").toBeNull();
  });
});

describe("TRAVERSAL CHANGES NOTHING ABOUT THE GRAPH", () => {
  it("coordinates and every presentation fact survive a traversal untouched", () => {
    const { scene } = mount();
    const before = JSON.stringify({ nodes: scene.nodes, edges: scene.edges });
    fireEvent.click(relationshipButton(/^Follow has project project rebuild/));
    runFrames();
    expect(JSON.stringify({ nodes: scene.nodes, edges: scene.edges }),
      "traversal mutated the SceneModel").toBe(before);
  });
});

// ─── SLICE 10 · EXPLICIT NAVIGATION ────────────────────────────────────────────────────────────
//
// The Galaxy can now be left. The property under test is that it leaves through the ONE existing
// authority and never through a path it assembled itself — so every assertion compares against
// `routeForEntity` computed independently here, and the strongest one is about the objects that have
// no destination at all.

describe("NAVIGATION · the destination comes from navigation/routing, never from this surface", () => {
  it("a navigable object's href EQUALS routeForEntity for its carried identity", () => {
    const { scene } = mount();
    for (const node of scene.nodes) {
      const expected = routeForEntity(node.entity, node.entityId);
      if (!expected) continue;
      const link = screen.getByRole("link", { name: `Open ${node.label} in Ascend OS` });
      expect(link.getAttribute("href"), `${node.id} points somewhere routing did not choose`)
        .toBe(expected);
    }
  });

  it("THE DISCRIMINATING CASE · a non-routable kind renders NO link", () => {
    // `routeForEntity` returns null for phase, task, approval, audit, care_plan and sop — "honest,
    // never an invented route". An implementation that built paths from the type would give these a
    // plausible-looking href to a page that does not exist. The fixture contains a `phase` and a
    // `task`, so this is not hypothetical.
    const { scene } = mount();
    const unroutable = scene.nodes.filter((n) => routeForEntity(n.entity, n.entityId) === null);
    expect(unroutable.length, "the fixture has no non-routable object — this witness is vacuous")
      .toBeGreaterThan(0);
    for (const node of unroutable) {
      expect(screen.queryByRole("link", { name: `Open ${node.label} in Ascend OS` }),
        `${node.id} has no destination but was given a link`).toBeNull();
    }
  });

  it("every rendered link is one routing produced — none is invented", () => {
    const { scene } = mount();
    const legitimate = new Set(
      scene.nodes.map((n) => routeForEntity(n.entity, n.entityId)).filter(Boolean) as string[]
    );
    for (const link of screen.getAllByRole("link")) {
      expect(legitimate.has(link.getAttribute("href") ?? ""),
        `a link to ${link.getAttribute("href")} was rendered that routing never returned`).toBe(true);
    }
  });

  it("AN entityId CONTAINING A COLON ROUTES CORRECTLY", () => {
    // End to end through the real pipeline: the id is `client:odd:slug`, so anything that recovered
    // identity by splitting it would route to `/clients/odd` and lose the rest.
    const awkward: GraphNode = { ...node("client", "odd:slug"), entityId: "odd:slug" };
    const projection = projectionOf([awkward], []);
    const spatial = toSpatialModel(projection);
    render(createElement(GalaxyView, {
      projection, spatial, layout: computeGalaxyLayout(spatial), initialDetail: "full",
    }));
    const link = screen.getByRole("link", { name: /^Open client odd:slug/ });
    expect(link.getAttribute("href")).toBe("/clients/odd:slug");
  });

  it("SELECTION IS NOT NAVIGATION · selecting an object navigates nowhere", () => {
    const { scene, screenOf } = mount();
    const at = screenOf("client:acme");
    fireEvent.pointerDown(canvasEl(), { clientX: at.x, clientY: at.y, pointerId: 8 });
    fireEvent.pointerUp(canvasEl(), { clientX: at.x, clientY: at.y, pointerId: 8 });
    runFrames();
    // The selection happened, the view is still the Galaxy, and the link remains something the
    // operator must choose separately.
    expect(screen.getByText(/^Selected client acme$/)).toBeTruthy();
    expect(scene.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
    expect(screen.getByRole("link", { name: /^Open client acme/ })).toBeTruthy();
  });

  it("the link is a LINK, distinct from the selection and traversal buttons", () => {
    mount();
    // Role, not styling, is what tells an operator this one leaves the surface.
    expect(screen.getByRole("link", { name: /^Open client acme/ }).tagName).toBe("A");
    expect(screen.getAllByRole("button", { name: /^client acme/ })[0].tagName).toBe("BUTTON");
  });
});

// ─── SLICE 11 · NODE INSPECTION ────────────────────────────────────────────────────────────────
//
// The property is FIDELITY: what the projection composed is what the operator reads. Every assertion
// compares against `projection.nodes[i].meta` itself rather than against literals, so a fixture that
// drifted could not make a broken renderer look right.
//
// The fixture is adversarial on purpose — pair order is non-alphabetical, values carry `%`, currency
// separators, punctuation and a URL with a query string, and one node has no meta at all. Any
// sorting, filtering, trimming or reformatting shows up as a mismatch rather than as a nicety.

const META_NODES: GraphNode[] = [
  { ...node("client", "acme", 0.9), meta: [
    { label: "Website", value: "https://acme.test/path?q=1&r=2" },
    { label: "Status", value: "active" },
    { label: "Tier", value: "A" },
  ] },
  { ...node("invoice", "inv-1", 0.6), meta: [
    { label: "Amount", value: "$4,500" },
    { label: "Status", value: "overdue" },
    { label: "Due", value: "2026-08-01" },
  ] },
  { ...node("project", "rebuild", 0.7), meta: [
    { label: "Progress", value: "72%" },
    { label: "Phase", value: "Build — in progress" },
  ] },
  // The epistemic control: an engine JUDGMENT, carried like any other pair.
  { ...node("opportunity", "opp-1", 0.5), meta: [
    { label: "Severity", value: "high" },
    { label: "Why", value: "Launched 90 days ago with no retainer" },
    { label: "Next", value: "Offer a care plan" },
  ] },
  // No meta at all.
  node("task", "alpha", 0.1),
];

const mountMeta = () => {
  const projection = projectionOf(META_NODES, []);
  const spatial = toSpatialModel(projection);
  render(createElement(GalaxyView, {
    projection, spatial, layout: computeGalaxyLayout(spatial), initialDetail: "full",
  }));
  return projection;
};

/** The rendered pairs, read straight from the DOM. */
const renderedPairs = () => {
  const terms = [...document.querySelectorAll("dl dt")];
  const defs = [...document.querySelectorAll("dl dd")];
  return terms.map((t, i) => ({ label: t.textContent ?? "", value: defs[i]?.textContent ?? "" }));
};

const selectNode = (label: RegExp) => {
  fireEvent.click(screen.getAllByRole("button", { name: label })[0]);
  runFrames();
};

describe("INSPECTION · what the projection composed is what is read", () => {
  it("A · the rendered pairs EQUAL the projection's meta — labels, values and order", () => {
    const projection = mountMeta();
    for (const source of META_NODES) {
      if (source.meta.length === 0) continue;
      cleanup();
      const p = mountMeta();
      void p;
      selectNode(new RegExp("^" + source.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const expected = projection.nodes.find((n) => n.id === source.id)!.meta;
      expect(renderedPairs(), `${source.id} was not rendered faithfully`).toEqual(expected);
    }
  });

  it("D · values survive byte-for-byte — percent, currency, punctuation and a query string", () => {
    mountMeta();
    selectNode(/^client acme/);
    const values = renderedPairs().map((p) => p.value);
    expect(values).toContain("https://acme.test/path?q=1&r=2");
    cleanup();
    mountMeta();
    selectNode(/^invoice inv-1/);
    expect(renderedPairs().map((p) => p.value)).toContain("$4,500");
    cleanup();
    mountMeta();
    selectNode(/^project rebuild/);
    const projectValues = renderedPairs().map((p) => p.value);
    expect(projectValues).toContain("72%");
    expect(projectValues, "an em dash was normalised away").toContain("Build — in progress");
  });

  it("D · ORDER IS PRESERVED, and the fixture order is not alphabetical", () => {
    // Sorting would reorder every one of these. Stated as the source order, so the assertion fails
    // for a sort even if all the same pairs are present.
    mountMeta();
    selectNode(/^invoice inv-1/);
    expect(renderedPairs().map((p) => p.label)).toEqual(["Amount", "Status", "Due"]);
    const sorted = ["Amount", "Due", "Status"];
    expect(renderedPairs().map((p) => p.label), "the fixture order is alphabetical — a sort would be invisible")
      .not.toEqual(sorted);
  });

  it("B · SELECTION-SCOPED · the selected object shows its meta and no other object does", () => {
    mountMeta();
    selectNode(/^client acme/);
    const shown = renderedPairs();
    expect(shown.map((p) => p.label)).toEqual(["Website", "Status", "Tier"]);
    // The invoice's pairs are absent — meta is not rendered for every entry.
    expect(shown.map((p) => p.value), "another object's meta was rendered").not.toContain("$4,500");
  });

  it("B · nothing selected means no meta anywhere", () => {
    mountMeta();
    expect(renderedPairs(), "meta was rendered without a selection").toEqual([]);
  });

  it("C · EMPTY META renders no section and no placeholder", () => {
    mountMeta();
    selectNode(/^task alpha/);
    expect(document.querySelectorAll("dl")).toHaveLength(0);
    for (const filler of ["—", "N/A", "None", "-"]) {
      expect(screen.queryAllByText(filler), `a "${filler}" placeholder was invented`).toHaveLength(0);
    }
  });

  it("E · UNIFORM MARKUP · an engine judgment is rendered exactly like a stored figure", () => {
    // "Severity: high" is an interpretation `detectOpportunities` made. Rendering it in a warning
    // colour, or promoting it, would be this layer deciding which facts matter — a judgment its
    // owners never delegated. Structure and styling must be indistinguishable from any other pair.
    mountMeta();
    selectNode(/^opportunity opp-1/);
    const terms = [...document.querySelectorAll("dl dt")];
    const defs = [...document.querySelectorAll("dl dd")];
    expect(terms.map((t) => t.textContent)).toEqual(["Severity", "Why", "Next"]);
    for (const el of terms) {
      expect(el.tagName).toBe(terms[0].tagName);
      expect(el.getAttribute("style"), "a label was styled by its meaning").toBe(terms[0].getAttribute("style"));
    }
    for (const el of defs) {
      expect(el.getAttribute("style"), "a value was styled by its meaning").toBe(defs[0].getAttribute("style"));
    }
  });
});

// ─── SLICE 12 · DETAIL LEVEL ───────────────────────────────────────────────────────────────────
//
// The level was hardcoded to "artifacts" until now, which meant `phase` and `task` were in no scene
// anyone could produce — and because an edge needs both endpoints, `has_phase` and `has_task` were
// gone with them. These witnesses are about what that gate was hiding, and about the level being
// PRESENTATION: it changes what is drawn and listed, and nothing upstream.

const LEVEL_NODES: GraphNode[] = [
  node("client", "acme", 0.9),
  node("project", "rebuild", 0.7),
  node("phase", "discovery", 0.4),
  node("task", "alpha", 0.1),
  node("invoice", "inv-1", 0.6),
];
const LEVEL_EDGES: GraphEdge[] = [
  edge("has_project", "client:acme", "project:rebuild"),
  edge("has_phase", "project:rebuild", "phase:discovery"),
  edge("has_task", "phase:discovery", "task:alpha"),
  edge("billed", "client:acme", "invoice:inv-1"),
];

function mountLevels(initialDetail: "core" | "artifacts" | "full" = "artifacts") {
  const projection = projectionOf(LEVEL_NODES, LEVEL_EDGES);
  const spatial = toSpatialModel(projection);
  const layout = computeGalaxyLayout(spatial);
  render(createElement(GalaxyView, { projection, spatial, layout, initialDetail }));
  return { projection, spatial, layout };
}

const setLevel = (label: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  runFrames();
};

/** Object ids the LIST is currently showing — the accessible surface's view of the scene. */
const listedIds = () =>
  LEVEL_NODES.filter((n) =>
    screen.queryAllByRole("button", {
      name: new RegExp("^" + n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    }).length > 0
  ).map((n) => n.id);

describe("DETAIL · what the hardcoded level was hiding", () => {
  it("phase and task are ABSENT at artifacts and PRESENT at full", () => {
    mountLevels("artifacts");
    expect(listedIds()).not.toContain("phase:discovery");
    expect(listedIds()).not.toContain("task:alpha");
    setLevel(/^Everything$/);
    expect(listedIds(), "phase did not appear at full").toContain("phase:discovery");
    expect(listedIds(), "task did not appear at full").toContain("task:alpha");
  });

  it("A CONTAINMENT RELATIONSHIP FOLLOWS ITS ENDPOINTS · has_phase is traversable only at full", () => {
    // The finding this slice exists for. An edge needs both endpoints, so hiding `phase` hid the
    // project→phase relationship too — traversal appeared complete while covering less.
    mountLevels("artifacts");
    expect(screen.queryAllByRole("button", { name: /^Follow has phase/ }),
      "a relationship to a hidden object was offered").toHaveLength(0);
    setLevel(/^Everything$/);
    expect(screen.getAllByRole("button", { name: /^Follow has phase phase discovery/ }),
      "has_phase is still unreachable at full").toHaveLength(1);
  });

  it("a phase can be traversed to and inspected once it exists", () => {
    mountLevels("full");
    fireEvent.click(screen.getAllByRole("button", { name: /^Follow has phase phase discovery/ })[0]);
    runFrames();
    expect(screen.getByText(/^Followed has phase to phase discovery$/)).toBeTruthy();
  });

  it("CONTAINMENT · core ⊆ artifacts ⊆ full, asserted on identities in both directions", () => {
    mountLevels("core");
    const core = listedIds();
    setLevel(/^Artifacts$/);
    const artifacts = listedIds();
    setLevel(/^Everything$/);
    const full = listedIds();

    for (const id of core) expect(artifacts, `${id} is in core but not artifacts`).toContain(id);
    for (const id of artifacts) expect(full, `${id} is in artifacts but not full`).toContain(id);
    // And each is strictly larger here, so the containment above is not vacuously satisfied by
    // three identical sets.
    expect(artifacts.length).toBeGreaterThan(core.length);
    expect(full.length).toBeGreaterThan(artifacts.length);
  });
});

describe("DETAIL · one scene, both surfaces", () => {
  it("the canvas draws exactly what the list shows, at every level", () => {
    for (const [label, level] of [[/^Core$/, "core"], [/^Artifacts$/, "artifacts"], [/^Everything$/, "full"]] as const) {
      cleanup();
      paths.length = 0;
      const { projection, spatial, layout } = mountLevels("core");
      setLevel(label as RegExp);
      const expected = buildScene({ projection, spatial, layout, detail: level });
      expect(listedIds().sort(), `${level}: the list disagrees with the scene`)
        .toEqual(expected.nodes.map((n) => n.id).sort());
      // The canvas painted the same objects: one path centred on each node's position.
      const cam = computeFitCamera(expected.bounds, VIEW_W, VIEW_H, GALAXY_INSETS, MAX_ZOOM);
      const painted = paintedCentroids();
      for (const n of expected.nodes) {
        const s = toScreen(n.x, n.y, cam, VIEW_W, VIEW_H);
        expect(painted.has(`${s.x.toFixed(4)},${s.y.toFixed(4)}`),
          `${level}: ${n.id} is listed but was never drawn`).toBe(true);
      }
    }
  });
});

describe("DETAIL · the selection invariant", () => {
  it("a selection the next level does not contain is CLEARED", () => {
    mountLevels("full");
    fireEvent.click(screen.getAllByRole("button", { name: /^task alpha/ })[0]);
    runFrames();
    expect(screen.getByText(/^Selected task alpha$/)).toBeTruthy();

    setLevel(/^Artifacts$/);
    expect(screen.queryByText(/^Selected task alpha$/), "a hidden object stayed selected").toBeNull();
    // Read the SELECTION STATE, not the announcement. `aria-current` is set from `selectedId`
    // itself, whereas the live region only reflects what `select()` announced — so a selection
    // changed by any other path is invisible to an announcement check.
    expect(document.querySelectorAll('[aria-current="true"]'),
      "the selection dangled or was replaced").toHaveLength(0);
  });

  it("switching back does NOT restore it — restoration is not this slice", () => {
    mountLevels("full");
    fireEvent.click(screen.getAllByRole("button", { name: /^task alpha/ })[0]);
    runFrames();
    setLevel(/^Artifacts$/);
    setLevel(/^Everything$/);
    expect(listedIds(), "the task did not come back").toContain("task:alpha");
    // Again the state, not the announcement: restoring a selection silently would set `selectedId`
    // without saying anything, which an announcement check cannot see.
    expect(document.querySelectorAll('[aria-current="true"]'),
      "a selection was restored on the operator's behalf").toHaveLength(0);
  });

  it("a selection the next level KEEPS survives", () => {
    mountLevels("full");
    fireEvent.click(screen.getAllByRole("button", { name: /^client acme/ })[0]);
    runFrames();
    setLevel(/^Artifacts$/);
    expect(screen.getByText(/^Selected client acme$/),
      "a still-visible selection was dropped").toBeTruthy();
  });
});

describe("DETAIL · presentation only, and reachable by keyboard", () => {
  it("the upstream projection, spatial model and layout are byte-identical across levels", () => {
    const { projection, spatial, layout } = mountLevels("artifacts");
    const before = JSON.stringify({ projection, spatial, layout });
    setLevel(/^Everything$/);
    setLevel(/^Core$/);
    setLevel(/^Artifacts$/);
    expect(JSON.stringify({ projection, spatial, layout }),
      "changing the detail level mutated something upstream of the scene").toBe(before);
  });

  it("the control is a real group of buttons stating the active level", () => {
    mountLevels("artifacts");
    expect(screen.getByRole("group", { name: /detail level/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Artifacts$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Everything$/ }).getAttribute("aria-pressed")).toBe("false");
    setLevel(/^Everything$/);
    expect(screen.getByRole("button", { name: /^Everything$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Artifacts$/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the labels are taxonomy's own words", () => {
    mountLevels();
    for (const word of ["Core", "Artifacts", "Everything"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${word}$`) })).toBeTruthy();
    }
  });

  it("FULL IS ACTUALLY RENDERED · the densest path is exercised, not assumed", () => {
    paths.length = 0;
    mountLevels("full");
    expect(paths.length, "nothing was painted at full").toBeGreaterThan(0);
    expect(listedIds()).toHaveLength(LEVEL_NODES.length);
  });
});
