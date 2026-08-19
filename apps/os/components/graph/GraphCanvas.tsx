"use client";

// components/graph/GraphCanvas — the Neural Core renderer.
//
// Canvas 2D. It consumes GraphModel (the contract) and knows NOTHING about CRM, the vault, slugs,
// or where the data came from — which is what makes the projection swappable.
//
// PERFORMANCE DISCIPLINE:
//   • `shadowBlur` is BANNED in the draw loop. Glows are pre-rendered radial-gradient sprites,
//     cached per (type, radius bucket) in an offscreen canvas.
//   • The rAF loop halts entirely when the simulation has cooled, no pointer is active, no pulse is
//     in flight, and the canvas is off-screen (IntersectionObserver) or the tab is hidden.
//   • prefers-reduced-motion disables breathing, ambient pulses, and camera easing outright.
//
// ACCESSIBILITY: the canvas is not the only way in. NeuralCore renders a parallel semantic list of
// real links that IS the Tab order; this component exposes selection via callbacks so both stay in
// sync. Selection changes are announced by the parent's live region.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphModel, GraphNode } from "@/graph-view/contract";
import {
  EDGE_VISUAL,
  NODE_VISUAL,
  SEMANTIC,
  displayLabel,
  healthColor,
  isVisibleAt,
  type DetailLevel,
} from "@/graph-view/taxonomy";
import {
  GraphSimulation,
  makeAmbientPulse,
  makeRealPulse,
  stepPulse,
  type Pulse,
  type SimNode,
} from "./simulation";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.2;
/** Seconds between ambient firings. Sparse by design — this must never read as a screensaver. */
const AMBIENT_INTERVAL = 3.4;
/** Above this zoom, node labels are drawn. */
const LABEL_ZOOM = 0.62;

type Props = {
  model: GraphModel;
  detail: DetailLevel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRealPulse: (label: string) => void;
  reducedMotion: boolean;
};

export function GraphCanvas({ model, detail, selectedId, onSelect, onRealPulse, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Filter to the active detail level. Edges survive only if both endpoints do.
  const { nodes, edges } = useMemo(() => {
    const visible = model.nodes.filter((n) => isVisibleAt(n.type, detail));
    const ids = new Set(visible.map((n) => n.id));
    return { nodes: visible, edges: model.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [model, detail]);

  const simRef = useRef<GraphSimulation | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 0.85, tx: 0, ty: 0, tzoom: 0.85 });
  const pulsesRef = useRef<Pulse[]>([]);
  const spriteCache = useRef(new Map<string, HTMLCanvasElement>());
  const pointerRef = useRef({ down: false, dragNode: null as SimNode | null, lastX: 0, lastY: 0, moved: false });
  const visibleRef = useRef(true);
  /** True once at least one frame has been painted — gates the idle short-circuit. */
  const paintedRef = useRef(false);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    hoverRef.current = hoverId;
  }, [hoverId]);

  // Rebuild the simulation whenever the visible node/edge set changes, and re-fit once it settles.
  const fittedRef = useRef(false);
  useEffect(() => {
    const sim = new GraphSimulation(nodes, edges);
    // Settle the layout BEFORE the first frame so arriving at the graph shows a finished
    // composition rather than a re-running simulation. Deterministic seeding means this is the
    // same layout the animated run would have produced.
    sim.prewarm();
    simRef.current = sim;
    pulsesRef.current = [];
    fittedRef.current = false;
    paintedRef.current = false;
  }, [nodes, edges]);

  /**
   * Frame the whole graph in the canvas. `inset` reserves the columns the attention panel and the
   * context panel occupy, so the graph centers in the space actually available to it rather than
   * behind the UI.
   */
  const fitView = useCallback((viewW: number, viewH: number) => {
    const sim = simRef.current;
    if (!sim || sim.nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of sim.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const insetLeft = viewW >= 1024 ? 330 : 24;
    const insetRight = 24;
    const insetY = 130;
    const availW = Math.max(200, viewW - insetLeft - insetRight);
    const availH = Math.max(200, viewH - insetY * 2);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availW / (maxX - minX || 1), availH / (maxY - minY || 1))));
    const cam = cameraRef.current;
    // Offset the focal point so the graph's centre lands in the middle of the AVAILABLE region.
    cam.tx = (minX + maxX) / 2 - (insetLeft - insetRight) / 2 / zoom;
    cam.ty = (minY + maxY) / 2;
    cam.tzoom = zoom * 0.94;
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.zoom = cam.tzoom;
  }, []);

  // ── Real activity queue ──────────────────────────────────────────────────────────────────────
  // Real events are replayed on a slow cadence so each one is legible. They are the ONLY source of
  // accent multi-hop pulses; ambient activity can never enter this queue.
  const activityRef = useRef({ index: 0, timer: 0 });

  // ── Glow sprite cache (no shadowBlur in the loop) ─────────────────────────────────────────────
  const sprite = useCallback((color: string, radius: number): HTMLCanvasElement => {
    const key = `${color}:${Math.round(radius)}`;
    const cached = spriteCache.current.get(key);
    if (cached) return cached;

    const size = Math.ceil(radius * 6);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    if (g) {
      // Explicit rgba stops — canvas gradient stops must be literal colors, not color-mix()/var().
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, rgba(color, 0.95));
      grad.addColorStop(0.3, rgba(color, 0.34));
      grad.addColorStop(0.62, rgba(color, 0.08));
      grad.addColorStop(1, rgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    spriteCache.current.set(key, c);
    return c;
  }, []);

  // ── Hit testing ──────────────────────────────────────────────────────────────────────────────
  const nodeAt = useCallback((clientX: number, clientY: number): SimNode | null => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const wx = (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y;

    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of sim.nodes) {
      const dx = wx - (n.x + n.bx);
      const dy = wy - (n.y + n.by);
      const d = Math.hypot(dx, dy);
      const threshold = Math.max(n.r + 6, 10 / cam.zoom);
      if (d < threshold && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }, []);

  // ── Camera: ease toward the selected node ────────────────────────────────────────────────────
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !selectedId) return;
    const target = sim.get(selectedId);
    if (!target) return;
    const cam = cameraRef.current;
    cam.tx = target.x;
    cam.ty = target.y;
    cam.tzoom = Math.max(cam.zoom, 1.25);
    if (reducedMotion) {
      cam.x = cam.tx;
      cam.y = cam.ty;
      cam.zoom = cam.tzoom;
    }
  }, [selectedId, reducedMotion]);

  // ── Visibility: stop animating what nobody can see ───────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
    });
    io.observe(wrap);
    const onVis = () => {
      visibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ── The render loop ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    let ambientTimer = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = wrap;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const sim = simRef.current;
      if (!sim) return;

      // Off-screen or hidden tab: advance nothing.
      if (!visibleRef.current) return;

      // Idle short-circuit. It must come AFTER the first successful draw, otherwise a simulation
      // that is ALREADY settled (the normal case now that prewarm() runs before the first frame)
      // would return here forever and never paint. `paintedRef` is what makes that safe.
      const idle =
        sim.cooled && pulsesRef.current.length === 0 && !pointerRef.current.down && reducedMotion;
      if (idle && paintedRef.current) return;

      elapsed += dt;
      sim.step(dt, elapsed, !reducedMotion);

      // Frame the graph once the layout settles, so it fills the canvas instead of drifting
      // off-centre. Only once — after this the camera belongs to the operator.
      //
      // If the operator arrived from an entity view (`/?focus=<node id>`), a node is already
      // selected: fly to IT rather than framing the whole graph, so returning to the overview
      // preserves the context they came from.
      if (!fittedRef.current && sim.cooled) {
        fittedRef.current = true;
        const preselected = selectedRef.current ? sim.get(selectedRef.current) : null;
        if (preselected) {
          const cam = cameraRef.current;
          cam.tx = preselected.x;
          cam.ty = preselected.y;
          cam.tzoom = 1.3;
          cam.x = cam.tx;
          cam.y = cam.ty;
          cam.zoom = cam.tzoom;
        } else {
          fitView(wrap.clientWidth, wrap.clientHeight);
        }
      }

      // ── Ambient activity — teal, single-edge, never illuminates a node ──────────────────────
      if (!reducedMotion && sim.cooled) {
        ambientTimer += dt;
        if (ambientTimer >= AMBIENT_INTERVAL && pulsesRef.current.filter((p) => p.kind === "ambient").length < 1) {
          ambientTimer = 0;
          const pulse = makeAmbientPulse(sim, Math.floor(elapsed * 1000));
          if (pulse) pulsesRef.current.push(pulse);
        }
      }

      // ── Real activity — accent, multi-hop, illuminates, logs to the ticker ──────────────────
      if (sim.cooled && model.activity.length > 0) {
        activityRef.current.timer += dt;
        if (activityRef.current.timer >= 7) {
          activityRef.current.timer = 0;
          const event = model.activity[activityRef.current.index % model.activity.length];
          activityRef.current.index++;
          const pulse = makeRealPulse(sim, event.nodeId, event.summary, activityRef.current.index * 7);
          if (pulse) {
            if (reducedMotion) {
              // Reduced motion: no travel. The node still illuminates and the ticker still logs —
              // information is preserved, only the motion is removed.
              const origin = sim.get(event.nodeId);
              if (origin) origin.glow = 1;
            } else {
              pulsesRef.current.push(pulse);
            }
            onRealPulse(event.summary);
          }
        }
      }

      pulsesRef.current = pulsesRef.current.filter((p) => stepPulse(p, sim, dt));

      // Camera easing.
      const cam = cameraRef.current;
      if (!reducedMotion) {
        cam.x += (cam.tx - cam.x) * 0.09;
        cam.y += (cam.ty - cam.y) * 0.09;
        cam.zoom += (cam.tzoom - cam.zoom) * 0.09;
      }

      draw(ctx, wrap.clientWidth, wrap.clientHeight, sim, cam);
      paintedRef.current = true;
    };

    const draw = (
      g: CanvasRenderingContext2D,
      w: number,
      h: number,
      sim: GraphSimulation,
      cam: { x: number; y: number; zoom: number }
    ) => {
      g.clearRect(0, 0, w, h);
      g.save();
      g.translate(w / 2, h / 2);
      g.scale(cam.zoom, cam.zoom);
      g.translate(-cam.x, -cam.y);

      const focusId = selectedRef.current ?? hoverRef.current;
      const related = new Set<string>();
      if (focusId) {
        related.add(focusId);
        for (const id of sim.neighbors(focusId)) related.add(id);
      }
      const dimmed = focusId !== null;
      const labelQueue: {
        n: SimNode;
        x: number;
        y: number;
        r: number;
        inFocus: boolean;
        isSelected: boolean;
      }[] = [];

      // ── Edges ────────────────────────────────────────────────────────────────────────────
      for (const e of sim.edges) {
        const visual = EDGE_VISUAL[e.edge.type];
        const inFocus = !dimmed || (related.has(e.a.node.id) && related.has(e.b.node.id));
        // Base structural edges read as quiet grey scaffolding; focus and pulses brighten them.
        let alpha = visual.alpha * 0.5 * (inFocus ? 1 : 0.16);
        let color: string = "#3a424b";

        if (e.glow > 0.01) {
          // Teal for ambient traffic, accent for real. Hue used to carry this alone (the accent was
          // amber, 138° from teal); the accent is now Ascend green and only 24° away, so the
          // distinction moved to LUMINANCE — and got stronger doing it: 1.80:1 against teal where
          // amber managed 1.08:1. Reinforced by behaviour, below: real pulses are multi-hop, they
          // illuminate each node they reach, and they log to the ticker.
          const hot = pulsesRef.current.some((p) => p.kind === "real");
          color = hot ? SEMANTIC.accent : SEMANTIC.neural;
          alpha = Math.min(0.85, alpha + e.glow * 0.7);
        } else if (inFocus && dimmed) {
          color = SEMANTIC.text3;
          alpha = Math.min(0.9, alpha * 2.4);
        }

        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = visual.width / cam.zoom + (e.glow > 0.01 ? e.glow * 1.2 : 0);
        g.beginPath();
        g.moveTo(e.a.x + e.a.bx, e.a.y + e.a.by);
        g.lineTo(e.b.x + e.b.bx, e.b.y + e.b.by);
        g.stroke();
      }

      // ── Pulses ───────────────────────────────────────────────────────────────────────────
      for (const pulse of pulsesRef.current) {
        const from = sim.get(pulse.path[pulse.hop]);
        const to = sim.get(pulse.path[pulse.hop + 1]);
        if (!from || !to) continue;
        // Ease so the particle accelerates out and decelerates in — organic, not linear.
        const t = pulse.progress * pulse.progress * (3 - 2 * pulse.progress);
        const px = from.x + from.bx + (to.x + to.bx - from.x - from.bx) * t;
        const py = from.y + from.by + (to.y + to.by - from.y - from.by) * t;
        const isReal = pulse.kind === "real";
        const color = isReal ? SEMANTIC.accentHi : SEMANTIC.neural;
        const radius = (isReal ? 3.4 : 1.7) / cam.zoom;

        g.globalAlpha = isReal ? 0.95 : 0.4;
        const s = sprite(color, radius * 3);
        g.drawImage(s, px - (radius * 3) / 1, py - (radius * 3) / 1, radius * 6, radius * 6);
        g.globalAlpha = 1;
        g.fillStyle = color;
        g.beginPath();
        g.arc(px, py, radius, 0, Math.PI * 2);
        g.fill();
      }

      // ── Nodes ────────────────────────────────────────────────────────────────────────────
      for (const n of sim.nodes) {
        const visual = NODE_VISUAL[n.node.type];
        const inFocus = !dimmed || related.has(n.node.id);
        const isSelected = selectedRef.current === n.node.id;
        const x = n.x + n.bx;
        const y = n.y + n.by;
        const r = n.r;

        g.globalAlpha = inFocus ? 1 : 0.16;

        // Illumination: only attention-flagged nodes and pulse-lit nodes glow. Not everything.
        const glowStrength = Math.max(n.glow, n.node.state.attention ? 0.32 : 0, isSelected ? 0.55 : 0);
        if (glowStrength > 0.02 && inFocus) {
          const glowColor = n.glow > 0.02 ? SEMANTIC.accentHi : n.node.state.attention ? SEMANTIC.accent : visual.color;
          const gr = r * 4.5;
          g.globalAlpha = glowStrength * 0.55 * (inFocus ? 1 : 0.2);
          g.drawImage(sprite(glowColor, gr), x - gr, y - gr, gr * 2, gr * 2);
          g.globalAlpha = inFocus ? 1 : 0.16;
        }

        drawShape(g, visual.shape, x, y, r, visual.color);

        // State ring — health as a second, non-color channel (thickness) plus hue.
        const ring = healthColor(n.node.state.health);
        if (ring) {
          g.strokeStyle = ring;
          g.lineWidth = (n.node.state.health === "at_risk" ? 2 : 1.1) / cam.zoom + 0.6;
          g.beginPath();
          g.arc(x, y, r + 3.5, 0, Math.PI * 2);
          g.stroke();
        }

        // Selection ring — accent, the operator's own focus.
        if (isSelected) {
          g.strokeStyle = SEMANTIC.accent;
          g.lineWidth = 1.6 / cam.zoom + 0.5;
          g.beginPath();
          g.arc(x, y, r + 7, 0, Math.PI * 2);
          g.stroke();
        }

        labelQueue.push({ n, x, y, r, inFocus, isSelected });
      }

      // ── Labels, drawn last so nodes never occlude them ───────────────────────────────────
      // Two rules keep the graph readable instead of a wall of overlapping text:
      //   1. Only structurally significant nodes are labelled at rest (client · project ·
      //      prospect); everything else reveals its label on hover or selection.
      //   2. Collision avoidance — a label that would overlap one already drawn is skipped.
      const drawn: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const fontPx = 11 / cam.zoom;
      g.font = `500 ${fontPx}px Geist, ui-sans-serif, system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "top";

      // Focused labels first so they always win the collision contest.
      labelQueue.sort((a, b) => Number(b.isSelected) - Number(a.isSelected) || b.n.node.weight - a.n.node.weight);

      for (const item of labelQueue) {
        const { n, x, y, r, inFocus, isSelected } = item;
        const hovered = hoverRef.current === n.node.id;
        const significant = n.node.weight >= 0.68; // client · project · prospect
        if (!inFocus) continue;
        // Labels are drawn at a CONSTANT screen size (font is divided by zoom), so structurally
        // significant nodes stay labelled at any zoom — collision avoidance below is what prevents
        // clutter. The zoom gate applies only to the long tail of minor nodes.
        if (!significant && !hovered && !isSelected && cam.zoom <= LABEL_ZOOM) continue;
        if (!significant && !hovered && !isSelected) continue;

        const raw = displayLabel(n.node.label);
        const text = raw.length > 30 ? `${raw.slice(0, 29)}…` : raw;
        const w = g.measureText(text).width;
        const lx = x - w / 2;
        const ly = y + r + 5;
        const box = { x0: lx - 2, y0: ly - 1, x1: lx + w + 2, y1: ly + fontPx + 1 };

        const collides = drawn.some((d) => !(box.x1 < d.x0 || box.x0 > d.x1 || box.y1 < d.y0 || box.y0 > d.y1));
        if (collides && !hovered && !isSelected) continue;
        drawn.push(box);

        // A short dark plate keeps text legible where it crosses an edge.
        g.globalAlpha = 0.72;
        g.fillStyle = "#070809";
        g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);

        g.globalAlpha = isSelected || hovered ? 1 : 0.82;
        g.fillStyle = isSelected || hovered ? SEMANTIC.text1 : SEMANTIC.text2;
        g.fillText(text, x, ly);
      }

      g.restore();
      g.globalAlpha = 1;
    };

    // "Fit view" is requested by the UI (button or the `f` key) via a window event, which keeps
    // GraphCanvas free of an imperative handle.
    const onFit = () => fitView(wrap.clientWidth, wrap.clientHeight);
    window.addEventListener("ascend:fit-graph", onFit);

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("ascend:fit-graph", onFit);
    };
  }, [model, reducedMotion, sprite, onRealPulse, fitView]);

  // ── Pointer interaction ──────────────────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const hit = nodeAt(e.clientX, e.clientY);
    pointerRef.current = {
      down: true,
      dragNode: hit,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointerRef.current;
    const cam = cameraRef.current;

    if (!p.down) {
      const hit = nodeAt(e.clientX, e.clientY);
      const id = hit?.node.id ?? null;
      if (id !== hoverRef.current) setHoverId(id);
      return;
    }

    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) p.moved = true;
    p.lastX = e.clientX;
    p.lastY = e.clientY;

    if (p.dragNode) {
      // Dragging a node pins it — the operator's arrangement outranks the simulation.
      p.dragNode.pinned = true;
      p.dragNode.x += dx / cam.zoom;
      p.dragNode.y += dy / cam.zoom;
      p.dragNode.vx = 0;
      p.dragNode.vy = 0;
    } else {
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      cam.tx = cam.x;
      cam.ty = cam.y;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointerRef.current;
    if (!p.moved) {
      const hit = nodeAt(e.clientX, e.clientY);
      onSelect(hit ? hit.node.id : null);
    }
    pointerRef.current = { down: false, dragNode: null, lastX: 0, lastY: 0, moved: false };
  };

  const onWheel = (e: React.WheelEvent) => {
    const cam = cameraRef.current;
    const next = cam.tzoom * (e.deltaY < 0 ? 1.12 : 0.89);
    cam.tzoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (reducedMotion) cam.zoom = cam.tzoom;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = nodeAt(e.clientX, e.clientY);
    if (hit) hit.pinned = false; // release back to the simulation
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 touch-none">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        className="size-full cursor-grab active:cursor-grabbing"
        aria-hidden
      />
    </div>
  );
}

/** `#rrggbb` + alpha → `rgba(...)`. Canvas gradient stops must be literal colors. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ─── Shapes — type identity that survives the removal of color ────────────────────────────────

function drawShape(
  g: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  r: number,
  color: string
): void {
  g.fillStyle = color;
  g.beginPath();
  switch (shape) {
    case "ring":
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.arc(x, y, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      return;
    case "square":
      g.rect(x - r * 0.82, y - r * 0.82, r * 1.64, r * 1.64);
      break;
    case "diamond":
      g.moveTo(x, y - r);
      g.lineTo(x + r, y);
      g.lineTo(x, y + r);
      g.lineTo(x - r, y);
      g.closePath();
      break;
    case "tri":
      g.moveTo(x, y - r);
      g.lineTo(x + r * 0.92, y + r * 0.7);
      g.lineTo(x - r * 0.92, y + r * 0.7);
      g.closePath();
      break;
    case "hex": {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      break;
    }
    default:
      g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
}

export type { GraphNode };