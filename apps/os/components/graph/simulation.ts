// components/graph/simulation — deterministic force layout + neural activity model.
//
// PURE + framework-free: no React, no DOM, no canvas. It is the physics only; drawing lives in
// GraphCanvas. Every random-looking quantity is derived from a hash of a stable node id, so the
// same vault always produces the same layout and the same breathing phases across reloads.
//
// Why hand-written: at the measured n = 86 nodes / 79 edges, O(n²) repulsion is ~7,400 pair ops per
// frame — trivial — and d3-force would be a 30KB dependency for ~90 lines of arithmetic. Above
// SPATIAL_THRESHOLD nodes the repulsion pass switches to a uniform grid so this stays honest at scale.

import type { GraphEdge, GraphNode } from "@/graph-view/contract";
import { EDGE_VISUAL, nodeRadius } from "@/graph-view/taxonomy";

/** Above this node count, swap O(n²) repulsion for grid-bucketed neighbor search. */
const SPATIAL_THRESHOLD = 400;

export type SimNode = {
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rendered radius in world units. */
  r: number;
  /** Per-node breathing phase + period, both derived from the id hash (deterministic). */
  phase: number;
  period: number;
  /** Breathing offset applied at draw time. Written only by step(); never integrated into x/y. */
  bx: number;
  by: number;
  /** Operator-pinned via drag. Pinned nodes are excluded from integration. */
  pinned: boolean;
  /** 0–1 illumination from an arriving pulse; decays every frame. */
  glow: number;
  degree: number;
};

export type SimEdge = {
  edge: GraphEdge;
  a: SimNode;
  b: SimNode;
  restLength: number;
  /** 0–1 illumination from a pulse currently traversing this edge. */
  glow: number;
};

/** FNV-1a — a stable, well-distributed string hash. Deterministic across runs and machines. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic 0–1 value for `key`, so "random" placement is reproducible. */
function rand(key: string): number {
  return hash(key) / 0xffffffff;
}

/**
 * Type → radial band. Clients sit near the core and artifacts sit further out, which is what turns
 * the layout into legible structure instead of a hairball.
 */
const BAND: Record<string, number> = {
  // Clients sit on a ring rather than at the origin, so multiple client hubs distribute around the
  // canvas instead of piling on top of each other. Everything else is pulled outward from there,
  // but only weakly — the edge springs are what actually gather satellites onto their own client.
  client: 240,
  project: 300,
  prospect: 560,
  opportunity: 380,
  care_plan: 380,
  phase: 380,
  invoice: 470,
  document: 470,
  approval: 470,
  sop: 560,
  audit: 540,
  task: 460,
};

export class GraphSimulation {
  nodes: SimNode[] = [];
  edges: SimEdge[] = [];
  private byId = new Map<string, SimNode>();
  /** Simulation temperature: 1 → hot (laying out), 0 → cooled (breathing only). */
  alpha = 1;
  private tick = 0;

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    // Deterministic seeding — a golden-angle spiral inside each type's radial band.
    this.nodes = nodes.map((node) => {
      const seed = rand(node.id);
      const band = BAND[node.type] ?? 260;
      const angle = seed * Math.PI * 2;
      const radius = band + (rand(node.id + "r") - 0.5) * 90;
      return {
        node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        r: nodeRadius(node),
        phase: rand(node.id + "p") * Math.PI * 2,
        period: 4 + rand(node.id + "t") * 5, // 4–9s
        bx: 0,
        by: 0,
        pinned: false,
        glow: 0,
        degree: 0,
      };
    });

    for (const simNode of this.nodes) this.byId.set(simNode.node.id, simNode);

    for (const edge of edges) {
      const a = this.byId.get(edge.source);
      const b = this.byId.get(edge.target);
      if (!a || !b) continue; // dangling — skip, never fabricate
      a.degree++;
      b.degree++;
      this.edges.push({ edge, a, b, restLength: EDGE_VISUAL[edge.type].length, glow: 0 });
    }
  }

  /**
   * Run the layout to rest BEFORE the first frame is drawn.
   *
   * Without this the operator watches the graph re-settle for ~1.5s on every visit, which makes
   * returning from an entity view read as a rebuild rather than a return. Because seeding is
   * deterministic, pre-warming lands on exactly the layout the animated run would have reached —
   * the motion is removed, not the result. ~90 nodes × 220 iterations is a few ms, once per mount.
   */
  prewarm(iterations = 220): void {
    for (let i = 0; i < iterations; i++) {
      this.applyForces();
      for (const n of this.nodes) {
        if (n.pinned) continue;
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= 0.82;
        n.vy *= 0.82;
      }
      this.alpha *= 0.985;
    }
    this.alpha = 0; // settled: the render loop starts in its breathing-only path
  }

  get(id: string): SimNode | undefined {
    return this.byId.get(id);
  }

  /** Neighbor ids in either direction — used for highlighting and pulse propagation. */
  neighbors(id: string): string[] {
    const out: string[] = [];
    for (const e of this.edges) {
      if (e.a.node.id === id) out.push(e.b.node.id);
      else if (e.b.node.id === id) out.push(e.a.node.id);
    }
    return out;
  }

  edgesOf(id: string): SimEdge[] {
    return this.edges.filter((e) => e.a.node.id === id || e.b.node.id === id);
  }

  /** True once the layout has settled and only breathing remains. */
  get cooled(): boolean {
    return this.alpha < 0.02;
  }

  /**
   * Advance the simulation one frame.
   * `dt` is in seconds; `elapsed` drives breathing. When cooled, the force integration is skipped
   * entirely and only the (very cheap) breathing offset is applied — this is what lets the render
   * loop idle at near-zero cost.
   */
  step(dt: number, elapsed: number, breathe: boolean): void {
    this.tick++;

    if (!this.cooled) {
      this.applyForces();
      this.alpha *= 0.985;
    }

    for (const n of this.nodes) {
      if (!this.cooled && !n.pinned) {
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
        n.vx *= 0.82;
        n.vy *= 0.82;
      }
      // Breathing: ±1.2px on the node's own sinusoid. Relationships are preserved exactly —
      // nothing re-flows, the graph simply is not static.
      if (breathe) {
        const t = (elapsed / n.period) * Math.PI * 2 + n.phase;
        n.bx = Math.cos(t) * 1.2;
        n.by = Math.sin(t * 0.8) * 1.2;
      } else {
        n.bx = 0;
        n.by = 0;
      }
      n.glow *= 0.94;
      if (n.glow < 0.001) n.glow = 0;
    }

    for (const e of this.edges) {
      e.glow *= 0.93;
      if (e.glow < 0.001) e.glow = 0;
    }
  }

  /** Alpha is driven to 0 by prewarm(), so `cooled` gates on the same threshold either way. */
  private applyForces(): void {
    const n = this.nodes.length;

    // 1. Repulsion.
    if (n <= SPATIAL_THRESHOLD) {
      for (let i = 0; i < n; i++) {
        const a = this.nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = this.nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            // Coincident: separate deterministically rather than randomly.
            dx = (hash(a.node.id) % 100) / 100 - 0.5;
            dy = (hash(b.node.id) % 100) / 100 - 0.5;
            d2 = 0.01;
          }
          const d = Math.sqrt(d2);
          // Repulsion strength is tuned so ~90 nodes fill a laptop viewport rather than knotting
          // into one dense clump. Scaled by the pair's radii so big nodes claim more space.
          const force = (this.alpha * 2600 * (1 + (a.r + b.r) * 0.03)) / d2;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    } else {
      this.gridRepulsion();
    }

    // 2. Edge springs — the dominant force, so satellites gather onto their own client hub.
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const force = ((d - e.restLength) / d) * this.alpha * 0.16;
      const fx = dx * force;
      const fy = dy * force;
      e.a.vx += fx;
      e.a.vy += fy;
      e.b.vx -= fx;
      e.b.vy -= fy;
    }

    // 3. Radial banding toward the type's home ring. Weak on purpose: it supplies the overall
    //    "clients inward, artifacts outward" grammar while the springs do the clustering.
    for (const node of this.nodes) {
      const band = BAND[node.node.type] ?? 320;
      const d = Math.hypot(node.x, node.y) || 0.01;
      const pull = (band - d) * this.alpha * 0.004;
      node.vx += (node.x / d) * pull;
      node.vy += (node.y / d) * pull;
    }
  }

  /** Uniform-grid repulsion — only neighboring buckets interact. Used above SPATIAL_THRESHOLD. */
  private gridRepulsion(): void {
    const cell = 80;
    const buckets = new Map<string, SimNode[]>();
    for (const node of this.nodes) {
      const key = `${Math.floor(node.x / cell)},${Math.floor(node.y / cell)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(node);
      else buckets.set(key, [node]);
    }
    for (const node of this.nodes) {
      const cx = Math.floor(node.x / cell);
      const cy = Math.floor(node.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (const other of buckets.get(`${cx + ox},${cy + oy}`) ?? []) {
            if (other === node) continue;
            const dx = other.x - node.x;
            const dy = other.y - node.y;
            const d2 = dx * dx + dy * dy || 0.01;
            const d = Math.sqrt(d2);
            const force = (this.alpha * 900) / d2;
            node.vx -= (dx / d) * force;
            node.vy -= (dy / d) * force;
          }
        }
      }
    }
  }
}

// ─── Neural activity ───────────────────────────────────────────────────────────────────────────

/**
 * The two classes of activity are STRUCTURALLY different, not merely styled differently
 * (docs/UI-REDESIGN-PROPOSAL.md §2.8):
 *
 *   AMBIENT  — teal, one edge, NEVER illuminates a node, NEVER writes to the ticker or live region.
 *   REAL     — amber, 2–4 hops along real relationships, illuminates each node it reaches, and
 *              always logs to the ticker + aria-live.
 *
 * An ambient pulse is incapable of doing what a real pulse does, so the two cannot be confused.
 */
export type PulseKind = "ambient" | "real";

export type Pulse = {
  kind: PulseKind;
  /** Node ids along the path. Ambient is always length 2; real is 3–5. */
  path: string[];
  /** Index of the hop currently being traversed. */
  hop: number;
  /** 0–1 progress along the current hop. */
  progress: number;
  speed: number;
  /** Populated for real pulses only — surfaced in the ticker and announced. */
  label?: string;
};

/** Build an ambient pulse along ONE real edge. Returns null when the graph has no edges. */
export function makeAmbientPulse(sim: GraphSimulation, seed: number): Pulse | null {
  if (sim.edges.length === 0) return null;
  const edge = sim.edges[seed % sim.edges.length];
  return {
    kind: "ambient",
    path: [edge.a.node.id, edge.b.node.id],
    hop: 0,
    progress: 0,
    speed: 0.55 + (seed % 7) / 20,
  };
}

/**
 * Build a REAL pulse propagating outward from the node an event actually landed on, walking 2–4
 * hops along edges that already exist. Path selection is deterministic given (origin, seed): it
 * never invents a relationship, and where the origin has no edges it returns a single-node pulse
 * that illuminates only that node.
 */
export function makeRealPulse(sim: GraphSimulation, originId: string, label: string, seed: number): Pulse | null {
  const origin = sim.get(originId);
  if (!origin) return null;

  const path = [originId];
  const visited = new Set(path);
  let current = originId;
  const hops = 2 + (seed % 3); // 2–4 hops

  for (let i = 0; i < hops; i++) {
    const candidates = sim.neighbors(current).filter((id) => !visited.has(id));
    if (candidates.length === 0) break;
    // Deterministic choice — stable for a given event id.
    const next = candidates[(seed + i * 31) % candidates.length];
    path.push(next);
    visited.add(next);
    current = next;
  }

  return { kind: "real", path, hop: 0, progress: 0, speed: 0.9, label };
}

/**
 * Advance a pulse. Returns false when it has finished and should be removed.
 * Illumination is applied HERE, and only real pulses illuminate nodes — the single line of code
 * that enforces the ambient/real distinction.
 */
export function stepPulse(pulse: Pulse, sim: GraphSimulation, dt: number): boolean {
  pulse.progress += dt * pulse.speed;

  // Edge illumination applies to both classes (an ambient pulse may brighten its own edge faintly).
  const from = sim.get(pulse.path[pulse.hop]);
  const to = sim.get(pulse.path[pulse.hop + 1]);
  if (from && to) {
    for (const e of sim.edges) {
      const matches =
        (e.a === from && e.b === to) || (e.a === to && e.b === from);
      if (matches) e.glow = Math.max(e.glow, pulse.kind === "real" ? 1 : 0.35);
    }
  }

  if (pulse.progress >= 1) {
    pulse.progress = 0;
    pulse.hop++;
    // ── The structural distinction: ONLY a real pulse illuminates the node it reaches. ──
    if (pulse.kind === "real") {
      const arrived = sim.get(pulse.path[pulse.hop]);
      if (arrived) arrived.glow = 1;
    }
    if (pulse.hop >= pulse.path.length - 1) return false;
  }

  return true;
}