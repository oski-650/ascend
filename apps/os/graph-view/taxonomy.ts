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
export const NODE_VISUAL: Record<GraphNodeType, NodeVisual> = {
  client: { color: "#7fa8d0", shape: "disc", radius: 9.5, glyph: "C", label: "Client" },
  project: { color: "#79b89a", shape: "hex", radius: 8, glyph: "P", label: "Project" },
  phase: { color: "#5f8f7d", shape: "diamond", radius: 5, glyph: "", label: "Phase" },
  task: { color: "#7d858d", shape: "tri", radius: 3.2, glyph: "", label: "Task" },
  prospect: { color: "#c9a15e", shape: "ring", radius: 7, glyph: "◦", label: "Prospect" },
  invoice: { color: "#a98ac0", shape: "square", radius: 5.5, glyph: "$", label: "Invoice" },
  document: { color: "#8e9aa6", shape: "square", radius: 5, glyph: "▤", label: "Document" },
  approval: { color: "#c98a8a", shape: "diamond", radius: 5, glyph: "✓", label: "Approval" },
  audit: { color: "#9aa37f", shape: "tri", radius: 4, glyph: "", label: "Audit" },
  care_plan: { color: "#6e9e9e", shape: "ring", radius: 5.5, glyph: "↻", label: "Care plan" },
  opportunity: { color: "#e5a02c", shape: "diamond", radius: 6.5, glyph: "!", label: "Opportunity" },
  sop: { color: "#6e8e9e", shape: "square", radius: 5, glyph: "§", label: "SOP" },
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

/** Semantic colors — mirrors of the globals.css tokens, for canvas use. */
export const SEMANTIC = {
  accent: "#e5a02c",
  accentHi: "#f5bc5a",
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

const DETAIL_TYPES: Record<DetailLevel, GraphNodeType[]> = {
  core: ["client", "project", "prospect", "opportunity"],
  artifacts: [
    "client",
    "project",
    "prospect",
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