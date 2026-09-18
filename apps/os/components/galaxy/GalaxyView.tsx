"use client";

// components/galaxy/GalaxyView — ONE SCENE, TWO SURFACES, AND THE CAMERA (Slices 5–6).
//
//     GraphProjection → SpatialModel → GalaxyLayout ──► Scene ──┬──► GalaxyCanvas  (pixels)
//                                                               └──► SceneList     (text)
//                                        camera + selection ────┘
//
// This component builds the `Scene` ONCE and hands the same value to both surfaces, and it owns the
// two pieces of state neither surface may own alone: WHAT IS SELECTED and WHERE THE CAMERA IS.
//
// ─── WHY THE CAMERA LIVES HERE AND NOT IN THE CANVAS ───────────────────────────────────────────
//
// Selecting a row in the list has to move the camera. If the canvas owned the camera, the list would
// need a way to reach into it and there would be two authorities over one view. One state, one
// owner, both surfaces downstream — the same argument that put `selectedId` here in Slice 5.
//
// The camera is PRESENTATION STATE and flows one way. It is derived from `scene.bounds` and from
// gestures, it is passed DOWN, and it never travels back up: no camera value reaches the Scene, the
// layout, the spatial model or the projection. Panning moves the camera; it does not move the graph.
// F65 makes that structural by forbidding in-place mutation of `.x`/`.y`/`.radius` anywhere in this
// directory — which is only viable BECAUSE this state is immutable, replaced rather than written.
//
// ─── `camera === null` MEANS "FOLLOW THE FIT" ──────────────────────────────────────────────────
//
// Rather than an effect that copies the fit into state and a flag saying whether the operator has
// touched it, `null` means the view has not been moved and the computed fit is in force. Reset is
// `setCamera(null)`. There is no synchronisation to get wrong, and a resize re-fits automatically
// until the moment somebody pans.
//
// ─── THE INSETS ARE THIS PAGE'S, NOT NEURAL CORE'S ─────────────────────────────────────────────
//
// `viewport.fitInsets` reserves 330px on the left for NeuralCore's attention panel, 380 on the right
// for its context panel and 130 top and bottom for its chrome — geometry measured from ITS markup.
// Slice 4 called it here, so `/galaxy` has been framing the graph into a region that avoided panels
// which do not exist on this page. `computeFitCamera` takes `Insets` as a plain parameter and is
// fully generic; only `fitInsets` is page-specific. So this page passes its own, and `fitInsets`
// stays exactly as it is for the surface it was measured from.
//
// ─── SLICE 7 · MOTION, AND THE LOOP THAT REFUSES TO IDLE ───────────────────────────────────────
//
// Camera JUMPS are eased; direct manipulation is not. Panning and wheeling are 1:1 with the pointer,
// because easing a drag makes the graph feel like it is lagging behind the hand. Focus and reset are
// jumps, and a jump is where easing earns its place: Slice 6 shipped them snapping, which is abrupt.
//
// THE LOOP IS DEMAND-DRIVEN AND SELF-TERMINATING. There is no `while mounted` frame loop here. A
// transition exists only while `cameraTarget` is non-null; each frame schedules exactly ONE
// `requestAnimationFrame`, the effect re-runs because the camera changed, and when `cameraSettled`
// says the difference is sub-pixel the target is cleared and NOTHING is scheduled again. An idle
// galaxy schedules no frames at all — the legacy `GraphCanvas` loop, which runs forever and decides
// per frame whether to skip, is deliberately NOT the architecture here.
//
// Unmount cancels through the effect's own cleanup, which is also what makes an interrupted
// transition deterministic: there is only ever ONE target, so a second interaction retargets rather
// than stacking a second animation on top of the first.
//
// MOTION CHANGES PRESENTATION OVER TIME. IT DOES NOT CHANGE WHAT THE GRAPH IS. Nothing in this file
// writes a coordinate — F65 bans the assignment outright, and every camera value here is replaced
// rather than mutated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import { DETAIL_LABEL, EDGE_VISUAL, isVisibleAt, type DetailLevel } from "@/graph-view/taxonomy";
import {
  cameraSettled, computeFitCamera, easeCamera, type FitCamera, type Insets,
} from "@/graph-view/viewport";
import { buildScene } from "./scene";
import { qualifyingActivations, type Activation } from "./activity";
import { type Relationship } from "./traversal";
import { GalaxyCanvas } from "./GalaxyCanvas";

/**
 * THE 3D GALAXY, CLIENT-ONLY.
 *
 * `ssr: false` because R3F's Canvas needs a DOM and a WebGL context, and "use client" is not
 * enough — Next still server-renders client components for the initial HTML. It also keeps three.js
 * out of the server bundle entirely.
 */
const GalaxyScene3D = dynamic(
  () => import("./GalaxyScene3D").then((m) => m.GalaxyScene3D),
  // `loading` is not decoration. Without it this renders NOTHING until the chunk arrives, which is
  // pixel-for-pixel what a crashed surface looks like — and telling those two apart cost a round
  // trip of guessing once already.
  { ssr: false, loading: () => <SurfaceLoading label="Loading the galaxy" /> }
);
import { SceneList } from "./SceneList";
import { relationshipsOf } from "./traversal";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { SurfaceBoundary, SurfaceLoading } from "./SurfaceBoundary";

/**
 * ─── THE ZOOM RANGE IS RELATIVE TO THE FIT, NOT ABSOLUTE ──────────────────────────────────────
 *
 * It was `MIN_ZOOM = 0.25` / `MAX_ZOOM = 3.2`, mirroring the legacy graph's manual range. Those are
 * absolute scale factors, and they were fine while the layout's world was a fixed few thousand
 * units across.
 *
 * The root disc now grows with the square root of the population, so the world spans about 29,000
 * units for a small graph and 160,000 for the real one — and the fit zoom that frames it falls to
 * roughly 0.005. A floor of 0.25 is FIFTY TIMES that: the operator could not zoom out far enough to
 * see their own galaxy, because the floor had become a ceiling. Exactly the failure the 3D camera's
 * hard-coded far plane produced, in the surface nobody was looking at.
 *
 * So the limits are RATIOS against the fit. "Half as far out as the whole graph" and "twelve times
 * closer" mean the same thing at any size of business, which is what an absolute number cannot.
 *
 * MAX_FIT_ZOOM stays absolute, and only bounds the FIT itself: a graph with one node in it must not
 * open at four hundred times magnification.
 */
export const ZOOM_OUT_LIMIT = 0.5;
export const ZOOM_IN_LIMIT = 12;
export const MAX_FIT_ZOOM = 3.2;
/** How far a focus jump zooms in, as a multiple of the fit. */
const FOCUS_ZOOM = 3;

/**
 * The zoom a focus jump lands on. EXPORTED so the behavioural suite recomputes the real rule rather
 * than a copy of it — six assertions held a hardcoded `Math.max(zoom, 1.25)`, and when the rule
 * became relative to the fit every one of them was asserting a formula the component no longer used.
 *
 * Never zooms OUT: if the operator is already closer than a focus jump would take them, focusing
 * keeps their distance and only re-centres.
 */
export const focusZoomFrom = (from: number, fit: number): number =>
  clampZoom(Math.max(from, fit * FOCUS_ZOOM), fit);
/** Fraction of the remaining distance covered per frame. ~0.22 settles a jump in roughly 250ms. */
const CAMERA_EASE = 0.22;
/** The same, for the focus emphasis ramp. Faster: dimming should acknowledge a click immediately. */
const EMPHASIS_EASE = 0.34;
/**
 * Frames an activation takes to fade out — roughly 1.2 seconds at 60fps.
 *
 * A PRESENTATION CONSTANT. It is how long the picture acknowledges a recent event and carries no
 * business meaning: nothing anywhere reads it, and no fact changes when it does.
 */
const ACTIVATION_FRAMES = 72;

/**
 * The browser's reduced-motion preference.
 *
 * Galaxy detects it ITSELF rather than receiving it, because there is no shared helper to reuse —
 * `apps/os` has no hooks directory and NeuralCore inlines the same `matchMedia` call, which this
 * must not import. Ten lines of a standard media query is the right amount of duplication.
 *
 * The global `prefers-reduced-motion` block in globals.css neutralises CSS transitions everywhere,
 * so DOM chrome is already covered for free. It does NOTHING for a canvas, which is exactly why this
 * exists: motion painted into a canvas carries an accessibility obligation the same effect in CSS
 * would not.
 */
function usePrefersReducedMotion(): boolean {
  // READ SYNCHRONOUSLY ON THE FIRST RENDER, not in an effect.
  //
  // Starting at `false` and correcting in an effect meant the first render did not yet know, so an
  // activation scheduled one frame before the preference arrived and the cleanup cancelled it. One
  // cancelled frame is harmless in itself, but "reduced motion schedules zero frames" is a rule
  // worth being literally true rather than nearly true. The lazy initialiser runs during render;
  // `window` is guarded because this module is evaluated on the server, where the answer is the
  // safe default and no markup depends on it.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * This page's free region: a plain gutter. `/galaxy` has no floating panels over the canvas — the
 * object list is a SIBLING column, so the canvas element is already the full drawable area and the
 * only reservation needed is breathing room at the edges.
 */
export const GALAXY_INSETS: Insets = { left: 24, right: 24, top: 24, bottom: 24 };

/** The zoom range this scene allows, both ends stated against the zoom that frames the whole graph. */
export const zoomBounds = (fit: number) => ({ min: fit * ZOOM_OUT_LIMIT, max: fit * ZOOM_IN_LIMIT });

const clampZoom = (z: number, fit: number): number => {
  const { min, max } = zoomBounds(fit);
  return Math.min(max, Math.max(min, z));
};

type Props = {
  projection: GraphProjection;
  spatial: SpatialModel;
  /**
   * Where the control starts. The LEVEL ITSELF is presentation state owned here, alongside selection
   * and camera — the page supplies a default and nothing more. Not persisted, not in the URL.
   */
  initialDetail: DetailLevel;
  /**
   * A GraphNode.id to open selected, or `null`.
   *
   * ALREADY VALIDATED by the page against the authorized projection — this component trusts it to
   * name a real object and does no membership check of its own, because doing one here would be a
   * second place deciding what exists. It seeds state ONCE and has no further authority: selection,
   * detail and camera all behave exactly as they would had the operator arrived without it.
   */
  initialFocusId: string | null;
  /**
   * Which renderer opens. TEMPORARY, and Slice 17 removes it with the toggle it seeds.
   *
   * It defaults to the 3D surface, which is the Galaxy. It exists as a prop at all so the 2D
   * painter's behavioural suite can say WHICH surface it is measuring instead of depending on which
   * one happens to be the default — a test that measures the canvas because of a default is a test
   * that goes silently vacuous the day the default moves, which is exactly what it did.
   */
  initialDimension?: "2d" | "3d";
};

/**
 * The levels an operator may choose, in order of increasing density.
 *
 * DERIVED FROM THE TAXONOMY'S OWN TYPE, never retyped as a list of strings this file invented:
 * `DETAIL_LABEL` is `Record<DetailLevel, string>`, so adding a level upstream appears here and a
 * level that stops existing fails to compile. What each level CONTAINS remains taxonomy's — this
 * file never says which node types belong to which level, and F65 keeps it that way.
 */
const DETAIL_LEVELS = Object.keys(DETAIL_LABEL) as DetailLevel[];

export function GalaxyView({
  projection, spatial, initialDetail, initialFocusId, initialDimension = "3d",
}: Props) {
  /**
   * The active level.
   *
   * It was a hardcoded prop until Slice 12, which meant `phase` and `task` were absent from every
   * scene anyone could produce — and because an edge needs both endpoints, `has_phase` and
   * `has_task` were absent with them. Two shipped capabilities, traversal and inspection, silently
   * covered less than they appeared to: a project's phases could not be reached, and the Status and
   * Progress pairs carried for a phase could not be read by anybody.
   */
  const [detail, setDetail] = useState<DetailLevel>(() => {
    // D1 · A FOCUSED OBJECT MUST BE VISIBLE.
    //
    // `?focus=<task id>` validated fine and then showed nothing, because the default level excludes
    // tasks — a link that works and displays an empty result is worse than one that fails. So when
    // the focused type is not in the default level, the view opens at the coarsest level that DOES
    // contain it.
    //
    // Both halves matter. The default is never coarsened: a client is visible at `core`, but opening
    // a client link at `core` would hide its invoices and documents for no reason, so anything the
    // default already shows stays at the default.
    //
    // No per-type rule is written here. `DETAIL_LEVELS` is taxonomy's own declaration order and
    // `isVisibleAt` is its own membership test; this asks them a question and does not answer one.
    if (!initialFocusId) return initialDetail;
    const focused = projection.nodes.find((n) => n.id === initialFocusId);
    if (!focused || isVisibleAt(focused.type, initialDetail)) return initialDetail;
    return DETAIL_LEVELS.find((level) => isVisibleAt(focused.type, level)) ?? initialDetail;
  });
  /**
   * THE LAYOUT IS A FUNCTION OF THE DETAIL LEVEL, and it has to be.
   *
   * ─── WHAT IT COST TO COMPUTE IT ONCE ─────────────────────────────────────────────────────────
   *
   * It used to be computed by the page over EVERY node and handed down fixed. The root disc is
   * sized by the number of parentless objects — `SEPARATION × √N` — so with 3,106 prospects in the
   * graph it spans about 129,000 units. At the Artifacts level those prospects are not drawn, and
   * the twenty-six bodies that are were left scattered across a disc sized for a population that
   * was not on screen.
   *
   * Measured: a client and its project ended up THIRTEEN world units apart once the galaxy was
   * normalised to fit, while the smallest sphere that resolves as a sphere is about forty. Every
   * project swallowed its own client. Six pairs rendered as six bodies, and no amount of tuning
   * sizes or glows could fix it, because the space between them was the problem.
   *
   * The detail level is presentation state this component owns, so the layout that depends on it
   * belongs here too. Each level now gets a disc sized for the objects it actually shows.
   *
   * A node whose parent is filtered out is re-rooted rather than left pointing at something absent,
   * so it takes a proper place in the disc instead of falling back to an anchor nobody can see.
   */
  const layout = useMemo<LayoutModel>(() => {
    const visible = spatial.nodes.filter((n) => isVisibleAt(n.visualType, detail));
    const present = new Set(visible.map((n) => n.id));
    return computeGalaxyLayout({
      nodes: visible.map((n) =>
        n.parent !== null && !present.has(n.parent) ? { ...n, parent: null } : n),
      edges: spatial.edges.filter((e) => present.has(e.source) && present.has(e.target)),
    });
  }, [spatial, detail]);

  const scene = useMemo(
    () => buildScene({ projection, spatial, layout, detail }),
    [projection, spatial, layout, detail]
  );


  /** Seeded from the URL when one was supplied; an ordinary selection from the first render on. */
  /**
   * TEMPORARY MIGRATION BOUNDARY (Slice 15).
   *
   * The 3D Galaxy is the product direction; the 2D canvas is what exists and what 88 witnesses
   * currently describe. Both are mounted so the new renderer can be built and compared without a
   * day where the surface is broken — and 2D stays DEFAULT here so every existing witness keeps
   * describing the same thing.
   *
   * THIS TOGGLE IS NOT ARCHITECTURE. Slice 16 restores capability parity and flips the default;
   * SLICE 17 DELETES GalaxyCanvas, this state, and this control together. If it is still here after
   * Slice 17, something went wrong.
   */
  const [dimension, setDimension] = useState<"2d" | "3d">(initialDimension);
  /** Bumped to ask the 3D camera to re-frame. */
  const [fitToken, setFitToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusId);
  /** What the live region says. Selection and traversal are different events and say different things. */
  const [announcement, setAnnouncement] = useState<string | null>(null);
  /** 1 → just acknowledged, 0 → faded out and permanently still. Uniform across every activation. */
  const [activationProgress, setActivationProgress] = useState(1);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /**
   * `null` = the view has not been moved. The computed fit is in force — or, when the page was
   * opened on a focused object, the camera that frames THAT object (see `openingCamera`).
   */
  const [camera, setCamera] = useState<FitCamera | null>(null);
  /** Non-null only while a camera JUMP is easing. Cleared the moment it settles. */
  const [cameraTarget, setCameraTarget] = useState<FitCamera | null>(null);
  /** 0 → nothing focused, 1 → focus fully applied. The only animated presentation scalar. */
  const [emphasis, setEmphasis] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * ONE CLOCK READING, TAKEN ONCE, AT MOUNT.
   *
   * Every event age in this view is measured against this single instant. Reading the clock per node
   * or per frame would mean objects were judged against slightly different "nows" and an activation
   * could expire mid-animation — a fact appearing to change while nothing about it did. `/galaxy` is
   * force-dynamic with no polling, so the projection is fixed for the session and one reading is the
   * honest amount of time this view needs to know about.
   */
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setSize({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fitCamera = useMemo<FitCamera | null>(
    () =>
      size.w === 0 || size.h === 0 || scene.nodes.length === 0
        ? null
        : computeFitCamera(scene.bounds, size.w, size.h, GALAXY_INSETS, MAX_FIT_ZOOM),
    [scene, size]
  );

  /**
   * The camera a focused arrival opens on.
   *
   * DERIVED, not seeded into state. Focusing at mount would mean a setState inside an effect — the
   * cascading-render pattern lint rejects and Slice 7 removed — and the fit is not knowable until
   * the stage has been measured, so there is no single moment to write it. Deriving it sidesteps
   * both: while the operator has not touched the camera (`camera === null`) the view frames the
   * focused object, and the instant they pan, zoom, select or reset, their own camera takes over and
   * this is never consulted again.
   */
  const openingCamera = useMemo<FitCamera | null>(() => {
    if (!initialFocusId || !fitCamera) return null;
    const node = scene.nodes.find((n) => n.id === initialFocusId);
    if (!node) return null;
    return { x: node.x, y: node.y, zoom: focusZoomFrom(fitCamera.zoom, fitCamera.zoom) };
  }, [initialFocusId, fitCamera, scene]);

  const active: FitCamera = camera ?? openingCamera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };

  /**
   * Which drawn objects have a qualifying recent event.
   *
   * Derived ONCE, here, from the activity the authorized projection already carries — no second
   * event read, no second query, and no separate derivation for the accessible surface. Both
   * surfaces receive this same map, which is what keeps them incapable of disagreeing.
   *
   * Keyed against `scene.nodes` rather than the projection, so an event naming an object the detail
   * level dropped cannot light anything up.
   */
  const activations: Map<string, Activation> = useMemo(
    () => qualifyingActivations(projection.activity, new Set(scene.nodes.map((n) => n.id)), now),
    [projection, scene, now]
  );

  // ── Gestures. Every one of these REPLACES the camera; none writes through to anything else.
  //
  // Pan and zoom are DIRECT MANIPULATION and are never eased: the graph must track the pointer 1:1.
  // Both also clear any running transition, so grabbing the canvas mid-flight takes control from
  // wherever the camera currently is instead of fighting an animation that is still arriving.
  const pan = useCallback((dxScreen: number, dyScreen: number) => {
    setCameraTarget(null);
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, x: from.x - dxScreen / from.zoom, y: from.y - dyScreen / from.zoom };
    });
  }, [fitCamera]);

  const zoomBy = useCallback((factor: number) => {
    setCameraTarget(null);
    setCamera((c) => {
      const from = c ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
      return { ...from, zoom: clampZoom(from.zoom * factor, fitCamera?.zoom ?? from.zoom) };
    });
  }, [fitCamera]);

  /**
   * Back to the computed fit.
   *
   * Eased when there is a fit to ease TOWARD, so the view glides back rather than jumping. Clearing
   * `camera` to null is what re-establishes "follow the fit", and that happens once the transition
   * settles — see the loop below.
   */
  /**
   * Begin a camera JUMP.
   *
   * Reduced motion is decided here rather than inside the transition effect, and that placement is
   * load-bearing twice over: an effect that calls setState synchronously cascades renders (lint
   * rejects it, correctly), and deciding here means a reduced-motion user schedules NO FRAME AT ALL
   * rather than one frame that immediately snaps. The witness counts frames, so the difference is
   * observable.
   */
  const jumpTo = useCallback((to: FitCamera) => {
    if (reducedMotion) {
      setCamera(to);
      setCameraTarget(null);
    } else {
      setCameraTarget(to);
    }
  }, [reducedMotion]);

  const resetView = useCallback(() => {
    setFitToken((t) => t + 1); // the 3D camera re-frames; harmless when 2D is mounted
    if (fitCamera) jumpTo(fitCamera);
    else setCamera(null);
  }, [fitCamera, jumpTo]);

  /**
   * Put an object in the middle of the view.
   *
   * The target is looked up in `scene.nodes`, so a focus request can only ever land on an object the
   * scene actually contains — an id from anywhere else is ignored rather than moving the camera to
   * a coordinate nothing occupies.
   */
  const focusNode = useCallback((id: string) => {
    const node = scene.nodes.find((n) => n.id === id);
    if (!node) return;
    const from = camera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
    // A TARGET, not a camera. The loop below carries the view there — or, under reduced motion,
    // `jumpTo` arrives immediately, which is exactly the snap Slice 6 shipped.
    jumpTo({ x: node.x, y: node.y, zoom: focusZoomFrom(from.zoom, fitCamera?.zoom ?? from.zoom) });
  }, [scene, camera, fitCamera, jumpTo]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) focusNode(id);
    const node = id ? scene.nodes.find((n) => n.id === id) : null;
    setAnnouncement(node ? `Selected ${node.label}` : null);
  }, [focusNode, scene]);

  /**
   * FOLLOW A RELATIONSHIP.
   *
   * The one traversal action in the Galaxy. The canvas calls it when a relationship is clicked and
   * the list calls it when one is activated by keyboard — so there is a single semantic, a single
   * `selectedId`, and no possibility of the two surfaces behaving differently.
   *
   * It goes through `select`, which is what makes traversal inherit the camera behaviour that
   * already exists rather than inventing a second way to move the view. Nothing new is computed:
   * `relationship.targetId` was validated as present by `relationshipsOf`, and this re-checks it
   * against the scene because a target that has left the scene must not be selected.
   *
   * SELECTION IS NOT TRAVERSAL. Clicking an object still just selects it; following a relationship
   * is a separate, explicit act with its own announcement.
   */
  const traverse = useCallback((relationship: Relationship) => {
    const target = scene.nodes.find((n) => n.id === relationship.targetId);
    if (!target) return;
    select(relationship.targetId);
    // Said AFTER select so the traversal's wording wins over the plain selection wording. The stored
    // direction decides the phrasing: forward along the edge, or back up it.
    const verb = EDGE_VISUAL[relationship.kind].label;
    setAnnouncement(
      relationship.outgoing
        ? `Followed ${verb} to ${target.label}`
        : `Followed ${verb} back to ${target.label}`
    );
  }, [scene, select]);

  /**
   * THE CAMERA TRANSITION. One frame per effect run, and the effect re-runs because the camera it
   * just set is a new dependency — so the loop advances itself and stops the instant it settles.
   *
   * Reduced motion takes the first branch: the target is adopted whole, no frame is ever scheduled,
   * and the result is identical to Slice 6's behaviour. Information is never carried by the motion,
   * only by the destination.
   */
  useEffect(() => {
    if (!cameraTarget) return;
    const from = camera ?? fitCamera ?? { x: 0, y: 0, zoom: 1 };
    const raf = requestAnimationFrame(() => {
      // Settling ADOPTS the target whole rather than approaching it: an exponential ease is
      // asymptotic and would otherwise never arrive, and the loop would never stop.
      if (reducedMotion || cameraSettled(from, cameraTarget)) {
        setCamera(cameraTarget);
        setCameraTarget(null);
      } else {
        setCamera(easeCamera(from, cameraTarget, CAMERA_EASE));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [camera, cameraTarget, fitCamera, reducedMotion]);

  /**
   * The emphasis ramp — the same shape, for the one presentation scalar that animates.
   *
   * Under reduced motion the ramp is not RUN and not stored: the drawn value is simply the target,
   * computed during render. No effect, no frame, no state update — which is both simpler and the
   * reason a reduced-motion session schedules nothing whatsoever.
   */
  const emphasisTarget = selectedId || hoverId ? 1 : 0;
  const drawnEmphasis = reducedMotion ? emphasisTarget : emphasis;
  useEffect(() => {
    if (reducedMotion) return;
    if (Math.abs(emphasis - emphasisTarget) < 0.01) return;
    const raf = requestAnimationFrame(() =>
      setEmphasis((e) => {
        const next = e + (emphasisTarget - e) * EMPHASIS_EASE;
        return Math.abs(emphasisTarget - next) < 0.01 ? emphasisTarget : next;
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [emphasis, emphasisTarget, reducedMotion]);

  /**
   * The activation fade. Same demand-driven shape as the camera transition: one frame scheduled per
   * frame, and nothing scheduled once it reaches zero — after which this view is permanently still.
   *
   * It is the first loop here that starts WITHOUT an interaction, which is the one way Slice 7's
   * model is widened. It stays bounded: the fade runs to completion exactly once per mount, because
   * the projection cannot change during a session.
   */
  useEffect(() => {
    if (reducedMotion) return;
    if (activations.size === 0 || activationProgress <= 0) return;
    const raf = requestAnimationFrame(() =>
      setActivationProgress((p) => {
        const next = p - 1 / ACTIVATION_FRAMES;
        return next <= 0.001 ? 0 : next;
      })
    );
    return () => cancelAnimationFrame(raf);
  }, [activationProgress, activations, reducedMotion]);

  /**
   * Under reduced motion the fade is not run and not stored — the drawn value is the state the fade
   * would have ENDED at, which is zero. No frame is scheduled and no halo is painted.
   *
   * The information is not lost with the motion: `SceneList` states the same activity in words for
   * every user, motion or not, from this same map. The canvas halo is an acknowledgement; the list
   * is the record.
   */
  const drawnActivation = reducedMotion ? 0 : activationProgress;

  /**
   * Change the level, and drop a selection the next level will not contain.
   *
   * Decided HERE, in the event handler, rather than in an effect: a synchronous setState inside an
   * effect cascades renders and lint rejects it, and the Slice 7 pattern is to decide at the moment
   * the operator acts. `isVisibleAt` is taxonomy's — this file never decides which types a level
   * holds, it only asks.
   *
   * The selection is CLEARED, not remembered. Switching back does not restore it: a selection that
   * survived invisibly would be state the operator cannot see, and a selection that reappeared would
   * be the view making a choice on their behalf. Restoration is not part of this slice.
   */
  const changeDetail = useCallback((next: DetailLevel) => {
    const current = scene.nodes.find((n) => n.id === selectedId);
    if (current && !isVisibleAt(current.visualType, next)) {
      setSelectedId(null);
      setAnnouncement(null);
    }
    setHoverId(null);
    setDetail(next);
  }, [scene, selectedId]);

  /**
   * The selection's NEIGHBOURHOOD: itself, plus exactly what traversal can reach from it.
   *
   * ─── ONE NEIGHBOURHOOD, SHARED BY BOTH SURFACES ──────────────────────────────────────────────
   *
   * Computed here rather than inside each surface, and that placement is the point. The list and
   * the galaxy must narrow to the SAME set — if each derived its own, the two would answer "what is
   * this connected to" separately and the non-visual one would drift first, which is the exact
   * failure `traversal` was extracted to prevent. `relationshipsOf` remains the only authority; this
   * calls it once and hands the answer to both.
   *
   * `null` means nothing is selected, and both surfaces show everything.
   */
  const neighbourhood = useMemo<Set<string> | null>(() => {
    if (selectedId === null) return null;
    const present = new Set(scene.nodes.map((n) => n.id));
    if (!present.has(selectedId)) return null;
    return new Set([
      selectedId,
      ...relationshipsOf(selectedId, scene.edges, present).map((r) => r.targetId),
    ]);
  }, [scene, selectedId]);

  const empty = scene.nodes.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: "#0d0f11" }}>
      <div ref={stageRef} style={{ position: "relative", flex: "1 1 auto", minWidth: 0 }}>
        {empty ? (
          // An honest empty state. Never a placeholder object: a fabricated node would be a business
          // object the renderer invented, which is the one thing this layer must never do.
          <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                      margin: 0, color: "#9aa2ab" }}>
            Nothing to show. The graph is empty for this account.
          </p>
        ) : (
          <>
            {dimension === "3d" ? (
              // A throw anywhere in the WebGL subtree unmounts it to nothing. The boundary is what
              // turns that into a sentence instead of a black rectangle.
              <SurfaceBoundary label="The 3D galaxy">
              <GalaxyScene3D
                scene={scene}
                selectedId={selectedId}
                hoverId={hoverId}
                onSelect={select}
                onHover={setHoverId}
                fitToken={fitToken}
                motion={!reducedMotion}
                neighbourhood={neighbourhood}
              />
              </SurfaceBoundary>
            ) : (
            <GalaxyCanvas
              scene={scene}
              camera={active}
              viewW={size.w}
              viewH={size.h}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={select}
              onHover={setHoverId}
              emphasis={drawnEmphasis}
              activations={activations}
              activation={drawnActivation}
              onTraverse={traverse}
              onPan={pan}
              onZoom={zoomBy}
            />
            )}
            <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
              {/*
                Detail level. Buttons with `aria-pressed`, matching the convention the existing
                Neural Core detail control already uses — a familiar interaction rather than a new
                one. The label comes from taxonomy's DETAIL_LABEL, so "Everything" is the word its
                owner chose and not one invented here.
              */}
              <div role="group" aria-label="Detail level" style={{ display: "flex", gap: 4 }}>
                {DETAIL_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => changeDetail(level)}
                    aria-pressed={detail === level}
                    style={{ ...CONTROL, borderColor: detail === level ? "#7fa8d0" : "#1e2227" }}
                  >
                    {DETAIL_LABEL[level]}
                  </button>
                ))}
              </div>
              {/* Temporary. Removed with the 2D renderer in Slice 17. */}
              <div role="group" aria-label="Renderer" style={{ display: "flex", gap: 4 }}>
                {(["2d", "3d"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDimension(d)}
                    aria-pressed={dimension === d}
                    style={{ ...CONTROL, borderColor: dimension === d ? "#7fa8d0" : "#1e2227" }}
                  >
                    {d === "2d" ? "2D" : "3D"}
                  </button>
                ))}
              </div>
              <button type="button" onClick={resetView} style={CONTROL}>
                Reset view
              </button>
            </div>
          </>
        )}
      </div>

      {/*
        The non-visual surface. A real, keyboard-reachable representation of the same scene — not a
        summary and not an afterthought. The canvas is aria-hidden; this is the accessible path to
        the same objects, and selecting here moves the camera exactly as clicking there does.
      */}
      <nav
        aria-label="Graph objects"
        style={{
          flex: "0 0 22rem", maxWidth: "40%", overflowY: "auto",
          padding: "1rem", borderLeft: "1px solid #1e2227", color: "#e9ebee",
          font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem", font: "600 13px/1.4 inherit", color: "#9aa2ab" }}>
          {scene.nodes.length} objects · {scene.edges.length} relationships
        </h2>
        <SceneList
          scene={scene}
          selectedId={selectedId}
          neighbourhood={neighbourhood}
          onSelect={select}
          activations={activations}
          onTraverse={traverse}
        />
      </nav>

      {/* Selection is announced rather than left to the visual change alone. */}
      <div aria-live="polite" style={SR_ONLY}>
        {announcement ?? ""}
      </div>
    </div>
  );
}

const CONTROL: React.CSSProperties = {
  background: "#14181c", border: "1px solid #1e2227", borderRadius: 4,
  color: "#e9ebee", font: "12px ui-sans-serif, system-ui, sans-serif",
  padding: "0.35rem 0.7rem", cursor: "pointer",
};

const SR_ONLY: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
};
