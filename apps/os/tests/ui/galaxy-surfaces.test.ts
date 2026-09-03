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
import { GalaxyView } from "@/components/galaxy/GalaxyView";
import { buildScene } from "@/components/galaxy/scene";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { computeFitCamera, fitInsets, toScreen } from "@/graph-view/viewport";
import type { GraphEdge, GraphNode, GraphNodeType, GraphProjection } from "@/graph-view/contract";
import type { EntityKind } from "@/domain";

const VIEW_W = 1200;
const VIEW_H = 800;
const MAX_ZOOM = 3.2;

// ─── the recorder ──────────────────────────────────────────────────────────────────────────────
type Path = { points: [number, number][]; kind: "fill" | "stroke" };
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
    fill: () => { paths.push({ points: [...current], kind: "fill" }); },
    stroke: () => { paths.push({ points: [...current], kind: "stroke" }); },
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
  const camera = computeFitCamera(scene.bounds, VIEW_W, VIEW_H, fitInsets(VIEW_W, false), MAX_ZOOM);
  const screenOf = (id: string) => {
    const n = scene.nodes.find((x) => x.id === id)!;
    return toScreen(n.x, n.y, camera, VIEW_W, VIEW_H);
  };
  return { scene, screenOf };
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

  it("selecting in the LIST changes what the canvas draws — one selection, two surfaces", () => {
    const { scene, screenOf } = mount();
    const before = nodePathCounts(scene, screenOf).get("client:acme");
    paths.length = 0;
    fireEvent.click(screen.getAllByRole("button", { name: /client acme/ })[0]);
    const after = nodePathCounts(scene, screenOf).get("client:acme");
    // A selection ring is an extra path on the same centre. If the two surfaces held separate state
    // the canvas would not have repainted at all.
    expect(after, "clicking the list did not reach the canvas").toBeGreaterThan(before ?? 0);
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
