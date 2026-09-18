import { describe, expect, it } from "vitest";
import type { GraphNode, GraphProjection, GraphEdgeType } from "@/graph-view/contract";
import { toSpatialModel } from "@/graph-view/spatial";
import { buildSystemMap, recordPath, visibleSystemBodies, systemExtent, systemOverviewScale, SYSTEM_CLEARANCE } from "@/graph-view/field/systems";
import { GALAXY_RADIUS, PROSPECT_BELT, STAR_ORBIT_BAND } from "@/graph-view/field/scale";

function node(type: "client" | "project" | "document" | "invoice" | "prospect" | "approval" | "audit" | "care_plan", id: string): GraphNode {
  return { id: `${type}:${id}`, entityId: id, entity: type, type, label: id, weight: 0.5,
    state: { health: null, status: null, attention: false }, meta: [] };
}
function graph(nodes: GraphNode[], relations: [GraphEdgeType, string, string][]): GraphProjection {
  return { nodes, edges: relations.map(([type, source, target]) => ({ id: `${type}:${source}:${target}`, type, source, target })),
    activity: [], source: { name: "test", builtAt: "", nodeCount: nodes.length, edgeCount: relations.length } };
}
const build = (g: GraphProjection) => buildSystemMap(g, toSpatialModel(g));
const fixture = () => graph([
  node("client", "a"), node("client", "b"), node("project", "a"), node("project", "b"),
  node("document", "contract"), node("invoice", "deposit"), node("prospect", "lead"),
], [
  ["has_project", "client:a", "project:a"], ["has_project", "client:b", "project:b"],
  ["owns_document", "client:a", "document:contract"], ["billed", "client:a", "invoice:deposit"],
]);

describe("The business galaxy", () => {
  it("keeps complete moving systems apart, including a crowded galaxy that must expand", () => {
    const g = fixture();
    for (let i = 0; i < 18; i++) {
      g.nodes.push(node("client", `crowded-${i}`));
      for (let p = 0; p < 5; p++) {
        const id = `crowded-${i}-${p}`;
        g.nodes.push(node("project", id));
        g.edges.push({ id, type: "has_project", source: `client:crowded-${i}`, target: `project:${id}` });
      }
    }
    const map = build(g);
    const suns = map.bodies.filter((b) => b.role === "sun");
    for (let i = 0; i < suns.length; i++) {
      expect(suns[i].tilt).toBe(0);
      for (let j = i + 1; j < suns.length; j++) {
        const a = suns[i], b = suns[j];
        const separation = Math.hypot(...a.position.map((value, axis) => value - b.position[axis]));
        expect(separation + 1e-8).toBeGreaterThanOrEqual(
          systemExtent(map.bodies, a.id) + systemExtent(map.bodies, b.id) + SYSTEM_CLEARANCE,
        );
      }
    }
    const outer = Math.max(...suns.map((sun) => sun.track + systemExtent(map.bodies, sun.id)));
    expect(map.bodies.find((b) => b.role === "asteroid")!.track).toBeGreaterThan(outer);
    expect(systemOverviewScale(map)).toBeGreaterThan(1);
    expect(build({ ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() }).bodies).toEqual(map.bodies);
  });
  it("turns real client/project/record relationships into suns, planets and satellites", () => {
    const map = build(fixture());
    expect(map.bodies.find((b) => b.id === "client:a")?.role).toBe("sun");
    expect(map.bodies.find((b) => b.id === "project:a")?.parentId).toBe("client:a");
    expect(map.bodies.find((b) => b.id === "invoice:deposit")?.parentId).toBe("project:a");
    expect(map.records.find((r) => r.id === "invoice:deposit")?.ownerId).toBe("client:a");
    expect(map.records.find((r) => r.id === "invoice:deposit")?.placementNote).toContain("No project ownership is inferred");
    expect(map.records.find((r) => r.id === "document:contract")?.href).toBe("/documents/contract");
  });

  it("renders client-owned operational records as satellites without inventing project ownership", () => {
    const g = fixture();
    g.nodes.push(
      node("approval", "approval"),
      node("audit", "audit"),
      node("care_plan", "care"),
    );
    g.edges.push(
      { id: "approval", type: "awaits_approval", source: "client:a", target: "approval:approval" },
      { id: "audit", type: "measured_by", source: "client:a", target: "audit:audit" },
      { id: "care", type: "subscribes", source: "client:a", target: "care_plan:care" },
    );
    const map = build(g);
    for (const id of ["approval:approval", "audit:audit", "care_plan:care"]) {
      expect(map.bodies.find((body) => body.id === id)?.role).toBe("moon");
      expect(map.bodies.find((body) => body.id === id)?.parentId).toBe("client:a");
      expect(map.records.find((record) => record.id === id)?.placementNote).toContain("stored relationship");
    }
  });
  it("does not invent a project association for a client with multiple projects", () => {
    const g = fixture();
    g.nodes.push(node("project", "a-two"));
    g.edges.push({ id: "second", type: "has_project", source: "client:a", target: "project:a-two" });
    expect(build(g).records.find((r) => r.id === "invoice:deposit")?.parentId).toBe("client:a");
  });
  it("keeps unowned records in the directory without assigning them a nearby client", () => {
    const g = fixture(); g.edges = g.edges.filter((e) => e.type !== "owns_document");
    const map = build(g);
    expect(map.records.find((r) => r.id === "document:contract")?.parentId).toBeNull();
    expect(map.bodies.some((r) => r.id === "document:contract")).toBe(false);
  });
  it("mounts only the selected client system's nested bodies", () => {
    const map = build(fixture());
    expect(visibleSystemBodies(map, null).map((b) => b.role)).toEqual(["sun", "sun", "asteroid"]);
    const visible = visibleSystemBodies(map, "invoice:deposit").map((b) => b.id);
    expect(visible).toContain("project:a"); expect(visible).toContain("invoice:deposit");
    expect(visible).not.toContain("project:b");
    expect(recordPath(map, "invoice:deposit").map((r) => r.id)).toEqual(["client:a", "project:a", "invoice:deposit"]);
  });
  it("places every prospect in the outer belt and every client inside the galaxy", () => {
    const map = build(fixture());
    const prospect = map.bodies.find((body) => body.role === "asteroid")!;
    const clients = map.bodies.filter((body) => body.role === "sun");
    expect(prospect.track).toBeGreaterThanOrEqual(PROSPECT_BELT.min);
    expect(prospect.track).toBeLessThanOrEqual(PROSPECT_BELT.max);
    expect(prospect.track).toBeGreaterThan(GALAXY_RADIUS);
    for (const client of clients) {
      expect(client.track).toBeGreaterThanOrEqual(STAR_ORBIT_BAND.min);
      expect(client.track).toBeLessThanOrEqual(STAR_ORBIT_BAND.max);
    }
  });
  it("replaces a converted asteroid only when its actual client exists in this graph", () => {
    const g = fixture();
    g.edges.push({ id: "promotion", type: "promoted_to", source: "prospect:lead", target: "client:a" });
    const map = build(g);
    expect(map.bodies.some((b) => b.id === "prospect:lead")).toBe(false);
    expect(map.records.find((r) => r.id === "prospect:lead")?.promotedToId).toBe("client:a");
    g.nodes = g.nodes.filter((r) => r.id !== "client:a");
    expect(build(g).bodies.some((b) => b.id === "prospect:lead")).toBe(true);
  });
  it("does not leak dangling relations or mutate inputs; shuffled data yields the same layout", () => {
    const g = fixture(); const before = structuredClone(g);
    const map = build(g);
    const shuffled = build({ ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() });
    expect(shuffled.bodies).toEqual(map.bodies); expect(g).toEqual(before);
    expect(build(graph([], [["owns_document", "client:secret", "document:secret"]])).records).toEqual([]);
  });
  it("terminates ancestry traversal for a malformed cycle", () => {
    const map = build(fixture());
    map.records.find((r) => r.id === "client:a")!.parentId = "project:a";
    expect(recordPath(map, "project:a")).toHaveLength(2);
  });
});
