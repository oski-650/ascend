// The functional galaxy's closed-form layout. It consumes the already-scoped graph and spatial
// identities; every parent remains traceable to a stored edge. Presentation placement is explicit.
import type { GraphNode, GraphProjection } from "../contract";
import type { SpatialModel } from "../spatial";
import { spatialSeed } from "../spatial";
import { routeForEntity } from "../../navigation/routing";
import { PROSPECT_BELT, STAR_ORBIT_BAND } from "./scale";
import { DISK_OUTER } from "./blackhole";

export const SYSTEM_CLEARANCE = 110;

export type BodyRole = "sun" | "planet" | "moon" | "asteroid";
export type SystemRecord = GraphNode & {
  href: string | null;
  parentId: string | null;
  ownerId: string | null;
  role: BodyRole | null;
  placementNote: string | null;
  promotedToId: string | null;
  relatedIds: string[];
};
export type OrbitBody = {
  id: string; parentId: string | null; role: BodyRole;
  position: [number, number, number]; radius: number;
  track: number; speed: number; tilt: number; color: string;
};
export type SystemMap = {
  records: SystemRecord[]; bodies: OrbitBody[];
  source: GraphProjection["source"];
};

const ROLE: Partial<Record<GraphNode["type"], BodyRole>> = {
  client: "sun",
  project: "planet",
  document: "moon",
  invoice: "moon",
  approval: "moon",
  audit: "moon",
  care_plan: "moon",
  prospect: "asteroid",
};

const CLIENT_OWNED_EDGE_KINDS = new Set([
  "owns_document", "billed", "awaits_approval", "measured_by", "subscribes",
]);

export function buildSystemMap(projection: GraphProjection, spatial: SpatialModel): SystemMap {
  const identities = new Map(spatial.nodes.map((n) => [n.id, n]));
  const nodes = new Map(projection.nodes.filter((n) => identities.has(n.id)).map((n) => [n.id, n]));
  const edges = spatial.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  const related = new Map<string, Set<string>>();
  const owners = new Map<string, string[]>();
  const projects = new Map<string, string[]>();
  const promotions = new Map<string, string>();
  for (const e of edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      if (!related.has(a)) related.set(a, new Set());
      related.get(a)!.add(b);
    }
    if (e.kind === "has_project" && nodes.get(e.source)?.type === "client" && nodes.get(e.target)?.type === "project") {
      projects.set(e.source, [...(projects.get(e.source) ?? []), e.target]);
    }
    if (CLIENT_OWNED_EDGE_KINDS.has(e.kind)) {
      owners.set(e.target, [...(owners.get(e.target) ?? []), e.source]);
    }
    if (e.kind === "promoted_to" && nodes.get(e.source)?.type === "prospect" && nodes.get(e.target)?.type === "client") {
      promotions.set(e.source, e.target);
    }
  }
  const records = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)).map((n): SystemRecord => {
    const ownerIds = [...new Set(owners.get(n.id) ?? [])].sort();
    const ownerId = ownerIds.length === 1 ? ownerIds[0] : null;
    let parentId = identities.get(n.id)?.parent ?? null;
    let placementNote: string | null = null;
    if (n.type === "document" || n.type === "invoice" || n.type === "approval" ||
        n.type === "audit" || n.type === "care_plan") {
      parentId = ownerId;
      if ((n.type === "document" || n.type === "invoice") && ownerId && nodes.get(ownerId)?.type === "client") {
        const children = [...new Set(projects.get(ownerId) ?? [])];
        if (children.length === 1) {
          parentId = children[0];
          placementNote = "Client-owned record, displayed beside the client's only project. No project ownership is inferred.";
        } else {
          placementNote = "Client-owned satellite. No specific project is linked to this record.";
        }
      }
      if (!ownerId) placementNote = ownerIds.length > 1
        ? "Multiple owners are linked; no orbital parent has been chosen."
        : "No owner is linked. Available in the directory until a relationship is recorded.";
      else if (!placementNote && n.type !== "document" && n.type !== "invoice") {
        placementNote = "Client-owned operational satellite, linked by its stored relationship.";
      }
    }
    return { ...n, href: routeForEntity(n.entity, n.entityId), parentId, ownerId,
      role: ROLE[n.type] ?? null, placementNote, promotedToId: promotions.get(n.id) ?? null,
      relatedIds: [...(related.get(n.id) ?? [])].sort() };
  });
  const recordById = new Map(records.map((r) => [r.id, r]));
  const candidates = records.filter((r) => r.role && !r.promotedToId);
  const siblings = new Map<string, SystemRecord[]>();
  for (const r of candidates) {
    if (r.parentId) siblings.set(r.parentId, [...(siblings.get(r.parentId) ?? []), r]);
  }
  const bodies: OrbitBody[] = [];
  for (const r of candidates) {
    const seed = spatialSeed(r.id);
    const role = r.role!;
    let position: [number, number, number];
    let track = 0;
    let radius = role === "sun" ? 22 : role === "planet" ? 10 : role === "moon" ? 3.6 : 2.5;
    let speed = 0;
    const tilt = (spatialSeed(`${r.id}:tilt`) - 0.5) * 0.32;
    let parentId = r.parentId;
    if (role === "sun" || role === "asteroid") {
      parentId = null;
      const band = role === "sun" ? STAR_ORBIT_BAND : PROSPECT_BELT;
      track = band.min + seed * (band.max - band.min);
      const a = spatialSeed(`${r.id}:phase`) * Math.PI * 2;
      position = [Math.cos(a) * track, (spatialSeed(`${r.id}:height`) - 0.5) * 75, Math.sin(a) * track];
      if (role === "asteroid") radius = 2 + spatialSeed(`${r.id}:size`) * 2;
    } else {
      // Never attach an orphan to whichever client happens to be nearest in space.
      const parent = parentId ? recordById.get(parentId) : null;
      if (!parent || !parent.role) continue;
      const peers = siblings.get(parentId!) ?? [];
      const index = peers.findIndex((peer) => peer.id === r.id);
      track = parent.role === "sun" ? 65 + index * 42 : 20 + index * 12;
      const phase = seed * Math.PI * 2;
      position = [Math.cos(phase) * track, 0, Math.sin(phase) * track];
      speed = (0.45 + seed * 0.3) / Math.sqrt(track / 20);
    }
    const color = role === "sun" ? "#ffcf83" : role === "planet" ? "#79b1db"
      : role === "asteroid" ? "#8f7b9d" : r.type === "invoice" ? "#d8b981"
        : r.type === "approval" ? "#d8a1c4" : r.type === "audit" ? "#8cc8bd"
          : r.type === "care_plan" ? "#9aadd9" : "#b2bfca";
    bodies.push({ id: r.id, parentId, role, position, radius, track, speed, tilt, color });
  }
  // Reserve enough clearance for each project's complete satellite system, not just its sphere.
  for (const sun of bodies.filter((b) => b.role === "sun")) {
    let clearance = sun.radius + 35;
    for (const child of bodies.filter((b) => b.parentId === sun.id)) {
      const extent = Math.max(child.radius, ...bodies.filter((b) => b.parentId === child.id).map((b) => b.track + b.radius));
      child.track = clearance + extent;
      const phase = spatialSeed(child.id) * Math.PI * 2;
      child.position = [Math.cos(phase) * child.track, 0, Math.sin(phase) * child.track];
      clearance = child.track + extent + 30;
    }
  }
  spaceClientSystems(bodies);
  return { records, bodies, source: { ...projection.source } };
}

/** A sphere enclosing every possible orbital phase, including nested satellites. */
export function systemExtent(bodies: OrbitBody[], id: string, seen = new Set<string>()): number {
  const body = bodies.find((b) => b.id === id);
  if (!body || seen.has(id)) return 0;
  const path = new Set([...seen, id]);
  return Math.max(body.radius * 1.56, ...bodies.filter((b) => b.parentId === id)
    .map((child) => child.track + systemExtent(bodies, child.id, path)));
}

function spaceClientSystems(bodies: OrbitBody[]) {
  const suns = bodies.filter((b) => b.role === "sun");
  const placed: { body: OrbitBody; extent: number }[] = [];
  for (const sun of suns) {
    const extent = systemExtent(bodies, sun.id);
    const inner = Math.max(STAR_ORBIT_BAND.min, DISK_OUTER + extent + SYSTEM_CLEARANCE);
    const outer = Math.max(inner, STAR_ORBIT_BAND.max - extent);
    let chosen: [number, number, number] | null = null;
    // Seeded candidates keep the galaxy organic while reserving each system's full swept volume.
    for (let attempt = 0; attempt < 512; attempt++) {
      const radius = inner + spatialSeed(`${sun.id}:spacing:${attempt}:radius`) * (outer - inner);
      const phase = spatialSeed(`${sun.id}:spacing:${attempt}:phase`) * Math.PI * 2;
      const candidate: [number, number, number] = [Math.cos(phase) * radius, 0, Math.sin(phase) * radius];
      if (placed.every((other) => Math.hypot(candidate[0] - other.body.position[0], candidate[2] - other.body.position[2])
        >= extent + other.extent + SYSTEM_CLEARANCE)) { chosen = candidate; break; }
    }
    // A crowded galaxy expands instead of silently accepting a collision.
    if (!chosen) {
      const edge = Math.max(DISK_OUTER, ...placed.map(({ body, extent: size }) => Math.hypot(...body.position) + size));
      const radius = edge + extent + SYSTEM_CLEARANCE;
      const phase = spatialSeed(`${sun.id}:spacing:overflow`) * Math.PI * 2;
      chosen = [Math.cos(phase) * radius, 0, Math.sin(phase) * radius];
    }
    sun.position = chosen;
    sun.track = Math.hypot(...chosen);
    // Root positions share a single galactic rotation. Independent root tilts would change the
    // measured separation; child orbital planes can still tilt within their reserved volumes.
    sun.tilt = 0;
    placed.push({ body: sun, extent });
  }
  const outerEdge = Math.max(0, ...placed.map(({ body, extent }) => body.track + extent));
  const beltShift = Math.max(0, outerEdge + SYSTEM_CLEARANCE - PROSPECT_BELT.min);
  for (const body of bodies.filter((b) => b.role === "asteroid")) {
    const factor = (body.track + beltShift) / body.track;
    body.position = [body.position[0] * factor, body.position[1], body.position[2] * factor];
    body.track += beltShift;
  }
}

export function systemOverviewScale(map?: SystemMap): number {
  if (!map) return 1;
  const extent = Math.max(PROSPECT_BELT.max, ...map.bodies.filter((b) => !b.parentId)
    .map((body) => body.track + (body.role === "sun" ? systemExtent(map.bodies, body.id) : body.radius)));
  return extent / PROSPECT_BELT.max;
}

/** Resolve selection ancestry defensively, including malformed cycles in legacy records. */
export function recordPath(map: SystemMap, id: string | null): SystemRecord[] {
  const records = new Map(map.records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const path: SystemRecord[] = [];
  while (id && !seen.has(id)) {
    seen.add(id);
    const r = records.get(id);
    if (!r) break;
    path.unshift(r);
    id = r.parentId;
  }
  return path;
}

export function visibleSystemBodies(map: SystemMap, selectedId: string | null): OrbitBody[] {
  const path = recordPath(map, selectedId);
  const root = path.find((r) => r.role === "sun") ?? path[0];
  const visible = new Set<string>();
  for (const body of map.bodies) if (body.role === "sun" || body.role === "asteroid") visible.add(body.id);
  if (root) {
    visible.add(root.id);
    // Traverse only this system, not thousands of unrelated descendants.
    const children = new Map<string, string[]>();
    for (const b of map.bodies) if (b.parentId) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b.id]);
    const queue = [root.id];
    for (let i = 0; i < queue.length; i++) {
      for (const id of children.get(queue[i]) ?? []) if (!visible.has(id)) { visible.add(id); queue.push(id); }
    }
  }
  return map.bodies.filter((b) => visible.has(b.id));
}

/** A project's moons need to fit too. Distances are presentation, not business measurements. */
export function focusDistance(map: SystemMap, id: string): number {
  const body = map.bodies.find((b) => b.id === id);
  const children = map.bodies.filter((b) => b.parentId === id);
  const extent = Math.max(body?.radius ?? 10, ...children.map((b) => b.track + Math.max(b.radius,
    ...map.bodies.filter((moon) => moon.parentId === b.id).map((moon) => moon.track + moon.radius))));
  return Math.max(body?.role === "sun" ? 340 : body?.role === "planet" ? 150 : 90, extent * 3.4);
}

export function orbitTrackPoints(track: number): [number, number, number][] {
  return Array.from({ length: 129 }, (_, i) => {
    const angle = i / 128 * Math.PI * 2;
    return [Math.cos(angle) * track, 0, Math.sin(angle) * track];
  });
}
