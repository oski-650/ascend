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
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GalaxyView, GALAXY_INSETS, MAX_ZOOM, MIN_ZOOM } from "@/components/galaxy/GalaxyView";
import { buildScene } from "@/components/galaxy/scene";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { computeFitCamera, fitInsets, toScreen } from "@/graph-view/viewport";
import type { GraphEdge, GraphNode, GraphNodeType, GraphProjection } from "@/graph-view/contract";
import type { EntityKind } from "@/domain";

const VIEW_W = 1200;
const VIEW_H = 800;

// ─── the recorder ──────────────────────────────────────────────────────────────────────────────
type Path = { points: [number, number][]; kind: "fill" | "stroke"; alpha: number };
const paths: Path[] = [];
const texts: { text: string; x: number; y: number }[] = [];

function makeRecorder(): Record<string, unknown> {
  let current: [number, number][] = [];
  const ctx = {
    setTransform: () => {}, clearRect: () => {}, save: () => {}, restore: () => {},
    setLineDash: () => {}, measureText: (t: string) => ({ width: t.length * 6 }),
    beginPath: () => { current = []; },
    moveTo: (x: number, y: number) => { current.push([x, y]); },
    lineTo: (x: number, y: number) => { current.push([x, y]); },
    closePath: () => {},
    arc: (x: number, y: number) => { current.push([x, y]); },
    fill: () => { paths.push({ points: [...current], kind: "fill", alpha: ctx.globalAlpha }); },
    stroke: () => { paths.push({ points: [...current], kind: "stroke", alpha: ctx.globalAlpha }); },
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

const projectionOf = (nodes: GraphNode[], edges: GraphEdge[]): GraphProjection => ({
  nodes, edges, activity: [],
  source: { name: "test", builtAt: "2026-09-03T00:00:00Z", nodeCount: nodes.length, edgeCount: edges.length },
});

function mount(projection: GraphProjection = projectionOf(NODES, EDGES)) {
  const spatial = toSpatialModel(projection);
  const layout = computeGalaxyLayout(spatial);
  const scene = buildScene({ projection, spatial, layout, detail: "full" });
  render(createElement(GalaxyView, { projection, spatial, layout, detail: "full" }));
  // The camera the component will be using: this page's OWN insets, not NeuralCore's.
  const camera = computeFitCamera(scene.bounds, VIEW_W, VIEW_H, GALAXY_INSETS, MAX_ZOOM);
  const screenOf = (id: string, cam = camera) => {
    const n = scene.nodes.find((x) => x.id === id)!;
    return toScreen(n.x, n.y, cam, VIEW_W, VIEW_H);
  };
  mountCamera = camera;
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
      expect(screen.getAllByRole("button", { name: new RegExp(n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
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
        { name: new RegExp(n.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).length === 1)
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
    fireEvent.click(screen.getAllByRole("button", { name: /client acme/ })[0]);

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
    fireEvent.click(screen.getAllByRole("button", { name: /client acme/ })[0]);
    const row = screen.getAllByRole("button", { name: /client acme/ })[0];
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
    expect(screen.getAllByRole("button", { name: /client acme/ })[0].textContent)
      .toMatch(/at risk|needs attention/);
  });
});

describe("EMPTY · an honest empty state, never a placeholder object", () => {
  it("an empty projection renders a message and paints nothing", () => {
    const empty = projectionOf([], []);
    const spatial = toSpatialModel(empty);
    render(createElement(GalaxyView, { projection: empty, spatial, layout: computeGalaxyLayout(spatial), detail: "full" }));
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
    fireEvent.click(screen.getAllByRole("button", { name: /project rebuild/ })[0]);

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
    fireEvent.click(screen.getAllByRole("button", { name: /project rebuild/ })[0]);
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

    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /task alpha/ })[0]);

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
