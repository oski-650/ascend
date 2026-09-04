// SLICE 9 — FOLLOWING A RELATIONSHIP.
//
// The traversal authority is pure, so its rules are values. Every rule here exists to stop the
// Galaxy asserting a connection the projection never recorded.
//
// The fixture is built so the dangerous shortcuts would give WRONG answers rather than no answer:
// two nodes share a label, two sit at identical coordinates, and one pair shares an id prefix while
// having no edge between them. A neighbour derived from resemblance, from position, or from an id
// would be visible as an extra relationship in these tests.

import { describe, expect, it } from "vitest";
import { relationshipsOf } from "@/components/galaxy/traversal";
import type { SceneEdge } from "@/components/galaxy/scene";

const edge = (
  id: string, kind: SceneEdge["kind"], source: string, target: string, containment: boolean
): SceneEdge => ({
  id, kind, source, target, containment,
  // Geometry is present and deliberately misleading — see the proximity witness below.
  x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0, width: 1, alpha: 1,
});

const NODES = [
  "client:acme", "project:rebuild", "phase:discovery", "task:alpha",
  "invoice:inv-1", "client:acme-holdings",
];
const PRESENT = new Set(NODES);

const EDGES: SceneEdge[] = [
  edge("has_project:client:acme->project:rebuild", "has_project", "client:acme", "project:rebuild", true),
  edge("has_phase:project:rebuild->phase:discovery", "has_phase", "project:rebuild", "phase:discovery", true),
  edge("has_task:phase:discovery->task:alpha", "has_task", "phase:discovery", "task:alpha", true),
  edge("billed:client:acme->invoice:inv-1", "billed", "client:acme", "invoice:inv-1", false),
  // Dangling: the far endpoint is not in the scene.
  edge("owns_document:client:acme->document:ghost", "owns_document", "client:acme", "document:ghost", false),
];

describe("DIRECTION · stored source → target, reported both ways, reversed never", () => {
  it("from the SOURCE the relationship reads forward", () => {
    const out = relationshipsOf("client:acme", EDGES, PRESENT);
    const rel = out.find((r) => r.targetId === "project:rebuild")!;
    expect(rel.outgoing, "the stored direction was lost").toBe(true);
    expect(rel.kind).toBe("has_project");
  });

  it("from the TARGET the same relationship reads backward — and still points at the source", () => {
    const out = relationshipsOf("project:rebuild", EDGES, PRESENT);
    const rel = out.find((r) => r.edgeId.startsWith("has_project"))!;
    expect(rel.outgoing, "walking an edge backwards was reported as forwards").toBe(false);
    expect(rel.targetId, "the traversal target is not the other end").toBe("client:acme");
  });

  it("the two directions are the SAME edge, never two different relationships", () => {
    const fromSource = relationshipsOf("client:acme", EDGES, PRESENT)
      .find((r) => r.targetId === "project:rebuild")!;
    const fromTarget = relationshipsOf("project:rebuild", EDGES, PRESENT)
      .find((r) => r.targetId === "client:acme")!;
    expect(fromSource.edgeId).toBe(fromTarget.edgeId);
    expect(fromSource.outgoing).not.toBe(fromTarget.outgoing);
  });
});

describe("CLASSIFICATION · containment and lateral are copied, never re-decided", () => {
  it("a containment edge stays containment in both directions", () => {
    expect(relationshipsOf("client:acme", EDGES, PRESENT)
      .find((r) => r.targetId === "project:rebuild")?.containment).toBe(true);
    expect(relationshipsOf("project:rebuild", EDGES, PRESENT)
      .find((r) => r.targetId === "client:acme")?.containment).toBe(true);
  });

  it("a lateral edge stays lateral", () => {
    expect(relationshipsOf("client:acme", EDGES, PRESENT)
      .find((r) => r.targetId === "invoice:inv-1")?.containment,
      "a lateral relationship was promoted to containment").toBe(false);
  });

  it("the fixture holds BOTH classes — otherwise the two rules above are untestable", () => {
    const out = relationshipsOf("client:acme", EDGES, PRESENT);
    expect(out.some((r) => r.containment)).toBe(true);
    expect(out.some((r) => !r.containment)).toBe(true);
  });
});

describe("A TARGET MUST BE ON SCREEN · drop, never fabricate", () => {
  it("a DANGLING endpoint offers no relationship", () => {
    const out = relationshipsOf("client:acme", EDGES, PRESENT);
    expect(out.map((r) => r.targetId), "a traversal into a non-existent object was offered")
      .not.toContain("document:ghost");
  });

  it("an endpoint hidden by the detail level offers no relationship", () => {
    // Same mechanism, stated as the case that matters. `present` is the SCENE's node set.
    const coarse = new Set(["client:acme", "project:rebuild"]);
    const out = relationshipsOf("project:rebuild", EDGES, coarse);
    expect(out.map((r) => r.targetId), "traversal reached past the detail level")
      .toEqual(["client:acme"]);
  });

  it("an object that is not itself in the scene offers nothing at all", () => {
    expect(relationshipsOf("client:acme", EDGES, new Set(["project:rebuild"]))).toEqual([]);
  });

  it("every offered target is present in the scene", () => {
    for (const id of NODES) {
      for (const rel of relationshipsOf(id, EDGES, PRESENT)) {
        expect(PRESENT.has(rel.targetId), `${id} offered an absent target`).toBe(true);
      }
    }
  });
});

describe("IT INFERS NOTHING · relationships come from edges and from nowhere else", () => {
  it("no edges means no relationships, however many objects exist", () => {
    expect(relationshipsOf("client:acme", [], PRESENT)).toEqual([]);
  });

  it("SHARED LABELS AND ID PREFIXES DO NOT CONNECT · client:acme and client:acme-holdings", () => {
    // `client:acme-holdings` shares a type, a label stem and an id prefix with `client:acme`, and no
    // edge joins them. Any implementation that matched on names or id prefixes would connect them.
    const out = relationshipsOf("client:acme", EDGES, PRESENT);
    expect(out.map((r) => r.targetId), "two objects were connected by their names")
      .not.toContain("client:acme-holdings");
    expect(relationshipsOf("client:acme-holdings", EDGES, PRESENT),
      "an unconnected object acquired relationships").toEqual([]);
  });

  it("PROXIMITY DOES NOT CONNECT · every edge in the fixture is drawn at the same coordinates", () => {
    // All five edges have identical geometry (0,0)→(0,0). If position influenced the answer, every
    // object would appear connected to every other. The counts below are exactly the stored ones.
    expect(relationshipsOf("client:acme", EDGES, PRESENT)).toHaveLength(2);
    expect(relationshipsOf("task:alpha", EDGES, PRESENT)).toHaveLength(1);
    expect(relationshipsOf("invoice:inv-1", EDGES, PRESENT)).toHaveLength(1);
  });
});

// `relationshipAlong` was removed as a redundant round trip (see traversal.ts). The properties it
// was tested for are asserted here against `relationshipsOf`, which is where they actually live: the
// set of edges an object offers IS the set that may be followed from it, so "this edge is not
// followable" is exactly "this edge id is absent from that set".
describe("WHICH EDGES AN OBJECT OFFERS · the followable set is the whole answer", () => {
  const offered = (nodeId: string) =>
    relationshipsOf(nodeId, EDGES, PRESENT).map((r) => r.edgeId);

  it("an edge that touches the object is offered, with its stored meaning", () => {
    const rel = relationshipsOf("client:acme", EDGES, PRESENT)
      .find((r) => r.edgeId === "billed:client:acme->invoice:inv-1");
    expect(rel?.targetId).toBe("invoice:inv-1");
    expect(rel?.containment).toBe(false);
  });

  it("AN EDGE BETWEEN TWO OTHER OBJECTS IS NOT OFFERED", () => {
    // The rule the canvas depends on: it may only follow lines drawn from this set, so an edge
    // belonging to somebody else can never become a traversal.
    expect(offered("client:acme"), "an unrelated edge was followable")
      .not.toContain("has_task:phase:discovery->task:alpha");
  });

  it("a dangling edge is not offered, even though it touches the object", () => {
    expect(offered("client:acme"))
      .not.toContain("owns_document:client:acme->document:ghost");
  });

  it("the offered set contains only real edge ids", () => {
    for (const id of NODES) {
      for (const edgeId of offered(id)) {
        expect(EDGES.some((e) => e.id === edgeId), `${edgeId} is not a real edge`).toBe(true);
      }
    }
  });
});

describe("PURE · deterministic, order-stable, and it mutates nothing", () => {
  it("the same inputs give the same relationships, in the scene's edge order", () => {
    expect(relationshipsOf("client:acme", EDGES, PRESENT))
      .toEqual(relationshipsOf("client:acme", EDGES, PRESENT));
  });

  it("does not mutate the edges it is given", () => {
    const before = JSON.stringify(EDGES);
    relationshipsOf("client:acme", EDGES, PRESENT);
    expect(JSON.stringify(EDGES)).toBe(before);
  });

  it("carries the edge id, so a traversal can be traced to the relationship that caused it", () => {
    for (const rel of relationshipsOf("client:acme", EDGES, PRESENT)) {
      expect(EDGES.some((e) => e.id === rel.edgeId), "an invented edge id").toBe(true);
    }
  });
});
