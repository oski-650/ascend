// graph-view/taxonomy — PRESENTATION mapping: contract vocabulary → visual identity.
//
// PERMANENT, and independent of where the data came from. It is keyed entirely by GraphNodeType /
// GraphEdgeType — both contract vocabulary — so replacing the projection with the real indexer
// changes nothing here.
//
// Node identity is NOT "a different color per type". Each type combines FOUR channels — shape,
// base radius, glyph, and hue — so the graph stays readable when color is removed and legible at
// both zoomed-out and selected-node scales.
//
// Pure: no fs, no React, no DOM. Safe in a client bundle.

import type { GraphEdgeType, GraphNode, GraphNodeType } from "./contract";

/** Node silhouettes. Shape carries type identity independently of hue (accessibility §17). */
export type NodeShape = "disc" | "ring" | "diamond" | "square" | "hex" | "tri";

export type NodeVisual = {
  /** CSS color — resolved to a literal at draw time (canvas cannot read CSS custom properties). */
  color: string;
  shape: NodeShape;
  /** Base radius in world units before `weight` scaling. */
  radius: number;
  /** One-character mark drawn inside the node above a zoom threshold. Never the only identifier. */
  glyph: string;
  label: string;
};

/**
 * Literal hex values, mirroring the --color-n-* tokens in globals.css.
 * Canvas 2D cannot resolve `var()`, so the palette is duplicated here BY NECESSITY. Any change must
 * be made in both places; the tokens remain the design source of truth.
 */
// ─── THE BASE RADII AGREE WITH CELESTIAL_ROLE, AND THEY HAD TO BE MADE TO ──────────────────────
//
// These were tuned for the 2D painter, where they were the ONLY size signal. Once a type also
// declares a body kind below, the two multiply — and they were fighting: a task (a PLANET) had a
// base of 3.2 while a SOP (a MOON) had 5, so a moon came out larger than the planet it is meant to
// orbit. Measured: a ratio of 1.15 where the vocabulary calls for four or five.
//
// The base is the SILHOUETTE and the role is the CLASS, and a type's two visual declarations must
// not contradict each other. `galaxy-celestial.test.ts` asserts the resulting gaps rather than the
// numbers here, so retuning either one stays free as long as they keep agreeing.
// ─── THE PALETTE IS LUMINOUS, AND IT USED TO BE MUTED ──────────────────────────────────────────
//
// These were "low chroma, matched luminance, no neon" — a sound rule for small chips on a panel,
// where a saturated colour shouts. The Galaxy is a different medium: emissive bodies on pure black,
// every one of them run through an additive bloom. A mid-luminance, low-chroma colour there does not
// read as restrained, it reads as GREY — and with three thousand of them the whole field went flat.
//
// The hues are unchanged in MEANING and spread deliberately around the wheel so the four types that
// carry the business — client, project, phase, task — sit nowhere near the amber that three thousand
// prospects paint the field with. `task` was the worst offender and is the clearest case: it was
// #7d858d, a literal grey, which is not a colour a viewer can identify anything by.
//
// ONE PALETTE, NOT TWO. `app/globals.css` mirrors these for the rest of the console and was moved
// with them. A second, prettier palette owned by the renderer would be a second answer to "what
// colour is a client", and the two would drift the first time either was touched.
export const NODE_VISUAL: Record<GraphNodeType, NodeVisual> = {
  client: { color: "#5ac8ff", shape: "disc", radius: 9.5, glyph: "C", label: "Client" },
  project: { color: "#ffdf72", shape: "hex", radius: 8, glyph: "P", label: "Project" },
  phase: { color: "#3dffb0", shape: "diamond", radius: 5, glyph: "", label: "Phase" },
  task: { color: "#9fabff", shape: "tri", radius: 4.2, glyph: "", label: "Task" },
  // ─── THE SMALLEST BODY IN THE GRAPH, AND IT HAS TO BE ────────────────────────────────────────
  // Prospects arrive by CSV import in bulk — thousands of them, against a few dozen clients. At
  // radius 7 they were the second-largest silhouette here, so the graph would have become a picture
  // of the prospect list with the business hidden inside it. Size is a SILHOUETTE, not a ranking:
  // making the most numerous type the smallest is what lets the eye find the rare ones, and the
  // colour still says what each is. Reduced twice: 7 -> 2.2 when the bulk import was announced, and
  // 2.2 -> 1.3 once the astronomical hierarchy below made a sun five times a planet — at which point
  // the field bodies had to come down with it or they would have read as planets themselves.
  prospect: { color: "#ffb35e", shape: "ring", radius: 0.9, glyph: "◦", label: "Prospect" },
  invoice: { color: "#c78cff", shape: "square", radius: 2.2, glyph: "$", label: "Invoice" },
  document: { color: "#5ef0ff", shape: "square", radius: 2.0, glyph: "▤", label: "Document" },
  approval: { color: "#ff8090", shape: "diamond", radius: 5.8, glyph: "✓", label: "Approval" },
  audit: { color: "#c8fb60", shape: "tri", radius: 5.6, glyph: "", label: "Audit" },
  care_plan: { color: "#2eecd8", shape: "ring", radius: 2.1, glyph: "↻", label: "Care plan" },
  opportunity: { color: "#ff74d6", shape: "diamond", radius: 2.6, glyph: "!", label: "Opportunity" },
  sop: { color: "#dccbff", shape: "square", radius: 2.0, glyph: "§", label: "SOP" },
};

/**
 * Edge weight/strength. Structural containment reads stronger than lateral association, which is
 * what gives the layout legible hierarchy instead of a hairball.
 */
export const EDGE_VISUAL: Record<GraphEdgeType, { width: number; alpha: number; length: number; label: string }> = {
  has_project: { width: 1.4, alpha: 0.85, length: 90, label: "has project" },
  has_phase: { width: 1.0, alpha: 0.6, length: 62, label: "has phase" },
  has_task: { width: 0.8, alpha: 0.4, length: 44, label: "has task" },
  billed: { width: 1.0, alpha: 0.5, length: 130, label: "billed" },
  owns_document: { width: 1.0, alpha: 0.5, length: 130, label: "owns document" },
  supersedes: { width: 1.1, alpha: 0.65, length: 52, label: "supersedes" },
  awaits_approval: { width: 1.0, alpha: 0.5, length: 120, label: "awaits approval" },
  measured_by: { width: 0.8, alpha: 0.34, length: 150, label: "measured by" },
  subscribes: { width: 1.0, alpha: 0.55, length: 110, label: "subscribes" },
  promoted_to: { width: 1.3, alpha: 0.75, length: 180, label: "promoted to" },
  flags: { width: 1.2, alpha: 0.7, length: 140, label: "flags" },
  wikilink: { width: 0.9, alpha: 0.4, length: 200, label: "links to" },
};

/**
 * Type → radial band, in world units.
 *
 * MOVED FROM components/graph/simulation.ts, values unchanged. It lives here for the same reason
 * EDGE_VISUAL's rest lengths do: it is a per-type layout constant, and two layers now need it —
 * the existing 2D force simulation, which seeds placement from it, and graph-view/galaxy, which
 * treats it as an orbital radius. A copy in each would be two answers to "where does a project sit".
 *
 * The original comment, preserved because it explains the one value that looks wrong: clients sit
 * on a RING rather than at the origin, so multiple client hubs distribute around the canvas instead
 * of piling on top of each other. Everything else is pulled outward from there, but only weakly —
 * in the force simulation the edge springs are what actually gather satellites onto their own client.
 */
/**
 * What KIND OF BODY each type is drawn as. A per-type visual decision, like colour and shape.
 *
 * ─── THIS USED TO BE DERIVED FROM CONTAINMENT DEPTH, AND THAT WAS WRONG ────────────────────────
 *
 * The celestial model read depth: no parent with children was a sun, depth 1 a planet, depth 2 a
 * moon. It was elegant and it produced the wrong picture, because it answered a question nobody had
 * asked. The question is not "how deep is this in the tree", it is **"what does a project look
 * like"** — and that is a statement about the TYPE, which is exactly what this file is for.
 *
 * A project is a SUN. A task is a PLANET. A SOP is a MOON. Those are decisions about the vocabulary
 * of the picture, and no arrangement of foreign keys can be expected to produce them: a SOP has no
 * parent at all, so no depth rule could ever have made it a moon.
 *
 * ─── IT IS A SIZE AND A BRIGHTNESS, NOT AN ORBIT ───────────────────────────────────────────────
 *
 * This decides how a body LOOKS. It does not decide what orbits what — that stays with containment,
 * where it belongs, and a SOP drawn as a moon still orbits the galactic centre like every other
 * parentless object rather than acquiring an invented parent to justify the word. Keeping the two
 * apart is what lets the vocabulary be chosen freely without any of it becoming a claim about the
 * business.
 *
 * Nothing downstream may read "is a sun" as a fact. It is a silhouette.
 */
export type CelestialRole = "cluster" | "sun" | "planet" | "moon" | "star";

export const CELESTIAL_ROLE: Record<GraphNodeType, CelestialRole> = {
  client: "cluster",       // a customer: the several solar systems it owns
  project: "sun",          // a project IS a solar system, and this is its star
  phase: "planet",
  task: "planet",
  sop: "moon",
  document: "moon",
  invoice: "moon",
  // ─── AUDITS AND APPROVALS ARE PLANETS, NOT MOONS ─────────────────────────────────────────────
  // They gained an orbital anchor (see ATTACHMENT in graph-view/spatial), so they are no longer
  // specks adrift in the field — they are the satellites of the client whose work they describe,
  // and they are the two artifact types an operator actually acts on. A moon's silhouette made
  // them the smallest thing in a system they are the point of.
  approval: "planet",
  audit: "planet",
  care_plan: "moon",
  prospect: "star",        // the field: thousands of them, the dust of the galaxy
  opportunity: "star",
};

export const ORBITAL_BAND: Record<GraphNodeType, number> = {
  client: 240,
  project: 300,
  prospect: 120,   // innermost: a dense swarm around the core — see graph-view/galaxy's disc
  opportunity: 380,
  care_plan: 380,
  phase: 380,
  invoice: 470,
  document: 470,
  approval: 165,   // attaches to its client — a tight inner satellite, not an outer artifact
  sop: 560,
  audit: 190,      // attaches to the client it measured; see ATTACHMENT in graph-view/spatial
  task: 460,
};

/** Semantic colors — mirrors of the globals.css tokens, for canvas use. */
export const SEMANTIC = {
  accent: "#00ff88",
  accentHi: "#6bffb8",
  neural: "#3fb8b0",
  neuralHi: "#6fdcd4",
  good: "#4fa88b",
  risk: "#e06c5a",
  text1: "#e9ebee",
  text2: "#9aa2ab",
  text3: "#6d757e",
  line: "#1e2227",
} as const;

/**
 * Decode the handful of HTML entities that reach us from scraped vault frontmatter (one real
 * example: a prospect whose `name:` is literally `Tapia Tile &amp; Marble Co.`). This is display
 * formatting at the presentation boundary — the vault is NOT rewritten, and no other transform is
 * applied to the label.
 */
export function displayLabel(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Health band → the color used for a node's state ring. `null` health draws no ring. */
export function healthColor(health: GraphNode["state"]["health"]): string | null {
  if (health === "healthy") return SEMANTIC.good;
  if (health === "at_risk") return SEMANTIC.risk;
  if (health === "on_track") return SEMANTIC.text2; // deliberately unalarming — see docs §2.4
  return null;
}

/** Rendered radius: base silhouette scaled by structural weight. Pure. */
export function nodeRadius(node: GraphNode): number {
  const base = NODE_VISUAL[node.type].radius;
  return base * (0.72 + node.weight * 0.42);
}

/**
 * Detail levels. 30 of 86 nodes in the real vault are checklist tasks, so density is a control
 * rather than an assumption — this is one of the things the prototype exists to measure.
 */
export type DetailLevel = "core" | "artifacts" | "full";

// ─── PROSPECTS ARE AN "EVERYTHING" TYPE, AND THE COUNT IS WHY ──────────────────────────────────
//
// They sat in every level including the default. That was right when there were six of them and
// wrong the moment a CSV import made them 3,106 against roughly 28 of everything else — the default
// view became a field of amber specks with the business buried inside it, and the specks were
// mistaken for decoration because nothing that numerous reads as an object.
//
// The levels exist to control DENSITY, so the densest type in the graph belongs at the densest
// level. `Everything` still shows all of them, which is where the galaxy gets its field.
//
// This is a decision about the DEFAULT VIEW, not about the data: nothing is filtered, nothing is
// hidden from search, the list, or any reader. One click restores them.
const DETAIL_TYPES: Record<DetailLevel, GraphNodeType[]> = {
  core: ["client", "project", "opportunity"],
  artifacts: [
    "client",
    "project",
    "opportunity",
    "invoice",
    "document",
    "approval",
    "care_plan",
    "sop",
    "audit",
  ],
  full: [
    "client",
    "project",
    "phase",
    "task",
    "prospect",
    "invoice",
    "document",
    "approval",
    "audit",
    "care_plan",
    "opportunity",
    "sop",
  ],
};

export function isVisibleAt(type: GraphNodeType, level: DetailLevel): boolean {
  return DETAIL_TYPES[level].includes(type);
}

export const DETAIL_LABEL: Record<DetailLevel, string> = {
  core: "Core",
  artifacts: "Artifacts",
  full: "Everything",
};