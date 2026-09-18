// components/galaxy/data/types — THE ENTITY THE SCENE DRAWS (brief §3).
//
// ─── THIS IS AN ADAPTER, NOT A NEW DATA SOURCE ─────────────────────────────────────────────────
//
// The brief's §3 defines `GalaxyEntity` and says plainly that it "assumes a `useGalaxyData()` hook
// returning `GalaxyEntity[]` and doesn't specify its source". This repository has a source, it is
// authorized, and it is enforced end to end:
//
//     guarded readers → GraphProjection → SpatialModel → GalaxyLayout → Renderer
//
// So there is no hook that fetches. `GalaxyEntity` is a VIEW over `SpatialNode` that the mount
// produces and hands down, and the renderer cannot widen it — it never sees a principal, a reader,
// or anything it could ask a second question of. F65 holds that: nothing under `components/galaxy`
// may import a reader, an engine, or the projection.
//
// Every field is optional except identity, kind, parentage and label, and the defaults are neutral.
// A galaxy that renders only what it has been told is better than one that guesses: an unknown
// health is a sun-yellow star, not an alarming red one.

/**
 * What a thing IS, which decides what BODY it becomes.
 *
 * The mapping is the brief's §0 and it is a reassignment of the old one — a client is a star now,
 * where it used to be a cluster, and a project is a planet where it used to be a sun. Nothing in
 * this file encodes that mapping; it belongs to the taxonomy, which is the one authority on what a
 * node type means.
 */
export type EntityKind = "client" | "project" | "document" | "prospect";

/** What a document is, which decides its moon's colour. */
export type DocumentType = "invoice" | "contract" | "design" | "credential" | "note";

/** How far along a prospect is, which decides whether its planetesimal is ice, rock, or glowing. */
export type ProspectTemperature = "cold" | "warm" | "hot";

/** Lifecycle of a project, which decides its planet's surface archetype. */
export type ProjectStatus = "live" | "building" | "blocked" | "archived";

/**
 * The metrics that drive VISUAL ENCODING, and nothing else.
 *
 * Every one of these is optional on purpose. The encoding has to degrade to something neutral and
 * legible, because a partially-populated business is the normal case rather than the broken one —
 * and a scene that renders an absent metric as its most extreme value teaches the operator to
 * distrust the picture.
 */
export interface EntityMetrics {
  /** Client LTV or project budget. Drives body radius, log-scaled. */
  readonly value?: number;
  /** 0–1. Drives star colour temperature: 1 → blue-white, 0.5 → solar, 0 → red. */
  readonly health?: number;
  /** ISO timestamp. Recency drives the luminosity pulse rate. */
  readonly activityAt?: string;
  readonly status?: ProjectStatus;
  /** Drives a solar flare on a star, a red rim on a planet. Rare by design — it is an alarm. */
  readonly urgent?: boolean;
}

/**
 * One thing in the galaxy.
 *
 * `id` is STABLE and it is load-bearing: every orbital angle, inclination, phase offset and spacing
 * is derived from it through a seeded PRNG, never `Math.random()`. A client's star that moves to a
 * different arm on refresh destroys the spatial memory that makes this worth building at all.
 */
export interface GalaxyEntity {
  readonly id: string;
  readonly kind: EntityKind;
  /** project → client, document → project, client → null, prospect → null. */
  readonly parentId: string | null;
  readonly label: string;
  readonly sublabel?: string;
  readonly metrics?: EntityMetrics;

  /** Documents only. */
  readonly docType?: DocumentType;
  readonly paid?: boolean;
  readonly overdue?: boolean;

  /** Prospects only. */
  readonly temperature?: ProspectTemperature;
}
