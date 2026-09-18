// @vitest-environment happy-dom
//
// PHASE 1B — FAILURE CONTAINMENT, ON THE RENDERER THAT ACTUALLY SHIPS.
//
// ─── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
//
// `tests/ui/galaxy-surfaces.test.ts` is a thorough suite — including a reduced-motion section —
// for `GalaxyView`, the RETIRED 2D renderer. `/galaxy` has not rendered it since the Galaxy
// rebuild. `GalaxyStage`, `SurfaceBoundary` and `GalaxyControls` are what ship, and before this
// file no test mounted any of them. Coverage of a retired renderer is not acceptance evidence for
// the live one, and this suite deliberately mounts the live one.
//
// ─── WHAT THIS FILE CANNOT SEE, AND DOES NOT CLAIM ─────────────────────────────────────────────
//
// happy-dom applies no stylesheet, has no viewport and has no WebGL. So it cannot witness the
// white paint of a lost context, the placement of the notice, or that a real driver failed. Those
// are the rendered CDP pass's, and they were witnessed there. What it CAN witness is which
// components survive which failure, which is exactly what containment means.
//
// Every assertion below was mutation-probed: the guard it protects was deleted and the suite
// re-run. Probes are recorded in docs/PHASE-1B-CHECKPOINT.md.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GalaxyStage } from "@/components/galaxy/GalaxyStage";
import { SystemExplorer } from "@/components/galaxy/SystemExplorer";
import { GalaxyControls } from "@/components/galaxy/GalaxyControls";
import { SurfaceBoundary } from "@/components/galaxy/SurfaceBoundary";
import {
  afterContextCreated, afterContextLost, afterContextRestored, afterSceneFailure,
  detectWebGL, isDegraded, isDrawing, surfaceNotice, type SurfaceState,
} from "@/components/galaxy/surfaceState";
import { buildSystemMap, type SystemMap } from "@/graph-view/field/systems";
import { toSpatialModel } from "@/graph-view/spatial";
import type { GraphProjection, GraphNode, GraphEdgeType } from "@/graph-view/contract";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * happy-dom answers every media query with `matches: false`, i.e. a desktop.
 *
 * That default made the first version of the directory-first test VACUOUS: on a notional desktop
 * with nothing selected the directory was already open for the pre-existing reason, so deleting the
 * new behaviour entirely left the suite green. Probed, caught, and fixed by putting the test on a
 * phone — where the old rule closes the directory and only degradation opens it.
 */
function phone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: /max-width:\s*767px/.test(query),
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

function fixture(): SystemMap {
  const node = (type: "client" | "project" | "invoice", id: string, label: string): GraphNode => ({
    id: `${type}:${id}`, entityId: id, entity: type, type, label, weight: 0.5,
    state: { health: null, status: null, attention: false }, meta: [{ label: "Reference", value: id }],
  });
  const graph: GraphProjection = {
    nodes: [node("client", "acme", "Acme"), node("project", "acme", "Website"), node("invoice", "deposit", "Deposit")],
    edges: ([["has_project", "client:acme", "project:acme"], ["billed", "client:acme", "invoice:deposit"]] as [GraphEdgeType, string, string][])
      .map(([type, source, target]) => ({ id: type, type, source, target })),
    activity: [], source: { name: "fixture", builtAt: "", nodeCount: 3, edgeCount: 2 },
  };
  return buildSystemMap(graph, toSpatialModel(graph));
}

// happy-dom has no WebGL, so the stage's own probe puts it in exactly the state a machine without
// WebGL reaches. That is not a workaround — it IS the unsupported case, reached the real way.
describe("WEBGL UNAVAILABLE · the business survives the missing picture", () => {
  it("says what happened, in words, instead of leaving a black rectangle", () => {
    const { container } = render(createElement(GalaxyStage, { systemMap: fixture() }));
    expect(screen.getByText("3D graphics unavailable")).toBeTruthy();
    const notice = container.querySelector(".galaxy-notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("WebGL");
    expect(notice?.textContent).toContain("directory");
  });

  it("MOUNTS NO RENDERER · the canvas that would throw uncaught is never created", () => {
    const { container } = render(createElement(GalaxyStage, { systemMap: fixture() }));
    // The witnessed failure mode: `<Canvas>` asks for a context, three throws OUTSIDE React, and no
    // boundary sees it. The fix is not to catch it — it is not to ask.
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("opens the directory on itself ON A PHONE, where nothing else would have opened it", () => {
    phone();
    render(createElement(GalaxyStage, { systemMap: fixture() }));
    const rows = screen.getAllByRole("button", { pressed: false }).filter((b) => b.className === "system-record");
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Acme"));
    expect(screen.getByRole("heading", { level: 2, name: "Acme" })).toBeTruthy();
    // The canonical route is the point of the whole surface surviving.
    expect(screen.getByRole("link", { name: /Open client/ }).getAttribute("href")).toBe("/clients/acme");
  });

  it("holds back the body labels, which without a render loop are last frame's coordinates", () => {
    const { container } = render(createElement(GalaxyStage, { systemMap: fixture() }));
    expect(container.querySelector(".system-labels")).toBeNull();
  });

  it("an explicit choice to close the directory still wins over directory-first", () => {
    phone();
    render(createElement(GalaxyStage, { systemMap: fixture() }));
    fireEvent.click(screen.getByRole("button", { name: "Close directory" }));
    expect(screen.queryByPlaceholderText("Search records…")).toBeNull();
  });
});

describe("DIRECTORY-FIRST · only when the scene is gone", () => {
  const explorer = (degraded: boolean) => createElement(SystemExplorer, {
    map: fixture(), selectedId: null, onSelect: () => {}, onOverview: () => {}, degraded,
  });

  it("a phone with a WORKING scene keeps the directory closed — the picture is the surface", () => {
    phone();
    render(explorer(false));
    expect(screen.queryByPlaceholderText("Search records…")).toBeNull();
  });

  it("a phone with NO scene opens it — the list is now the only surface there is", () => {
    phone();
    render(explorer(true));
    expect(screen.getByPlaceholderText("Search records…")).toBeTruthy();
  });
});

describe("CONTAINMENT · a boundary reports once and never remounts what threw", () => {
  const Boom = (): ReactNode => { throw new Error("scene exploded"); };

  it("the failure is announced exactly once — no retry, no remount loop", () => {
    const onFailure = vi.fn();
    const renders = vi.fn();
    const Counting = () => { renders(); throw new Error("scene exploded"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(createElement("div", null,
      createElement(SurfaceBoundary, { label: "Galaxy", fallback: null, onFailure }, createElement(Counting)),
      createElement("p", null, "cockpit"),
    ));
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toBe("scene exploded");
    // React makes its own bounded attempts at a subtree that throws. What must NOT happen is the
    // count growing afterwards: a caught boundary keeps its children unmounted, so re-rendering the
    // parent — which is what a state change from `onFailure` does — must not mount the scene again.
    const settled = renders.mock.calls.length;
    rerender(createElement("div", null,
      createElement(SurfaceBoundary, { label: "Galaxy", fallback: null, onFailure }, createElement(Counting)),
      createElement("p", null, "cockpit"),
    ));
    expect(renders.mock.calls.length).toBe(settled);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("a sibling OUTSIDE the boundary is untouched by what happened inside it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(createElement("div", null,
      createElement(SurfaceBoundary, { label: "Galaxy", fallback: null }, createElement(Boom)),
      createElement("p", null, "cockpit"),
    ));
    expect(screen.getByText("cockpit")).toBeTruthy();
  });

  it("a reduced rendering costs the effect and nothing else", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(createElement(SurfaceBoundary,
      { label: "Post-processing", fallback: null }, createElement(Boom)));
    // `fallback: null` is the difference between losing bloom and losing the galaxy: with no
    // fallback this boundary renders its "could not start" panel in the scene's place.
    expect(container.textContent).toBe("");
  });
});

describe("CONTROLS · never command a scene that is not running", () => {
  const controls = (drawing: boolean) => createElement(GalaxyControls, {
    rate: 1 as const, setRate: () => {}, drifting: false, setDrifting: () => {},
    reducedMotion: false, onView: () => {}, functional: true, drawing,
  });

  it("motion controls are disabled and the status says so", () => {
    render(controls(false));
    expect(screen.getByRole("button", { name: "Pause orbital motion" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Auto orbit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Scene unavailable");
  });

  it("the camera views stay live — they are what the scene returns to", () => {
    render(controls(false));
    expect(screen.getByRole("button", { name: "Overview" }).hasAttribute("disabled")).toBe(false);
  });

  it("a drawing scene is unchanged", () => {
    render(controls(true));
    expect(screen.getByRole("button", { name: "Pause orbital motion" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("In motion");
  });
});

describe("SURFACE STATE · the vocabulary the whole surface agrees on", () => {
  it("only a live scene is drawing", () => {
    const states: SurfaceState[] = ["starting", "live", "unsupported", "lost", "failed"];
    expect(states.filter(isDrawing)).toEqual(["live"]);
  });

  it("a chunk still loading is NOT degraded — an ordinary load must not look like a failure", () => {
    expect(isDegraded("starting")).toBe(false);
    expect(["unsupported", "lost", "failed"].every((s) => isDegraded(s as SurfaceState))).toBe(true);
  });

  it("every degraded state says something, and no working state interrupts", () => {
    expect(surfaceNotice("starting")).toBeNull();
    expect(surfaceNotice("live")).toBeNull();
    expect(surfaceNotice("lost")?.detail).toMatch(/returns by itself|restore/i);
    expect(surfaceNotice("unsupported")?.detail).toMatch(/directory/i);
  });
});

describe("PRECEDENCE · a teardown must not talk over the failure that caused it", () => {
  // Witnessed, not imagined. A fault injected into the scene produced exactly this sequence in the
  // browser, and the surface told the operator to wait for a context that was never coming back.
  it("THE WITNESSED RACE · a scene failure survives the contextlost its own unmount fires", () => {
    expect(afterContextLost(afterSceneFailure("live"))).toBe("failed");
    expect(surfaceNotice("failed")?.title).toBe("The sky could not be drawn");
  });

  it("restoration revives a lost context and nothing else", () => {
    expect(afterContextRestored("lost")).toBe("live");
    expect(afterContextRestored("failed")).toBe("failed");
    expect(afterContextRestored("unsupported")).toBe("unsupported");
  });

  it("a machine with no WebGL stays unsupported whatever else arrives", () => {
    expect(afterContextLost("unsupported")).toBe("unsupported");
    expect(afterSceneFailure("unsupported")).toBe("unsupported");
    expect(afterContextCreated("unsupported")).toBe("unsupported");
  });

  it("an ordinary context coming up is live", () => {
    expect(afterContextCreated("starting")).toBe("live");
    expect(afterContextLost("live")).toBe("lost");
  });
});

describe("DETECTION · asking the browser, and never throwing at it", () => {
  it("no context means unsupported", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(detectWebGL()).toBe(false);
  });

  it("a context means supported, and the probe hands it straight back", () => {
    const loseContext = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => ({ loseContext }),
    } as unknown as RenderingContext);
    expect(detectWebGL()).toBe(true);
    // A browser gives out a limited number of contexts; a probe that kept one could itself be why
    // the renderer's own request later fails.
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("a browser that THROWS on getContext is unsupported, not a crash", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw new Error("blocked"); });
    expect(detectWebGL()).toBe(false);
  });
});
