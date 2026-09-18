// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SystemExplorer } from "@/components/galaxy/SystemExplorer";
import { buildSystemMap, type SystemMap } from "@/graph-view/field/systems";
import { toSpatialModel } from "@/graph-view/spatial";
import type { GraphProjection, GraphNode, GraphEdgeType } from "@/graph-view/contract";

afterEach(cleanup);
function fixture(): SystemMap {
  const node = (type: "client" | "project" | "document" | "invoice" | "prospect", id: string, label: string): GraphNode => ({
    id: `${type}:${id}`, entityId: id, entity: type, type, label, weight: 0.5,
    state: { health: null, status: null, attention: false }, meta: [{ label: "Reference", value: id }],
  });
  const graph: GraphProjection = {
    nodes: [node("client", "acme", "Acme"), node("project", "acme", "Website"), node("invoice", "deposit", "Deposit"), node("document", "contract", "Agreement")],
    edges: ([ ["has_project", "client:acme", "project:acme"], ["billed", "client:acme", "invoice:deposit"],
      ["owns_document", "client:acme", "document:contract"] ] as [GraphEdgeType, string, string][])
      .map(([type, source, target]) => ({ id: type, type, source, target })),
    activity: [], source: { name: "fixture", builtAt: "", nodeCount: 4, edgeCount: 3 },
  };
  return buildSystemMap(graph, toSpatialModel(graph));
}
function Harness() {
  const [id, setId] = useState<string | null>(null);
  return createElement(SystemExplorer, { map: fixture(), selectedId: id, onSelect: setId, onOverview: () => setId(null) });
}

describe("Functional galaxy directory and inspector", () => {
  it("navigates client → project → invoice and uses the existing canonical routes", () => {
    render(createElement(Harness));
    fireEvent.click(screen.getByRole("button", { name: "Acme client" }));
    expect(screen.getByRole("link", { name: "Open client" }).getAttribute("href")).toBe("/clients/acme");
    fireEvent.click(screen.getByRole("button", { name: "Website project" }));
    expect(screen.getByRole("link", { name: "Open project" }).getAttribute("href")).toBe("/clients/acme/project");
    fireEvent.click(screen.getByRole("button", { name: "Deposit invoice" }));
    expect(screen.getByRole("link", { name: "Open finance" }).getAttribute("href")).toBe("/finance");
    expect(screen.getByText(/No project ownership is inferred/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Link to this view" }).getAttribute("href")).toBe("/?focus=invoice%3Adeposit");
  });
  it("searches documents through the same directory and opens their real document route", () => {
    render(createElement(Harness));
    fireEvent.click(screen.getByRole("button", { name: "Records" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search galaxy records" }), { target: { value: "agreement" } });
    fireEvent.click(screen.getByRole("button", { name: "Agreement document" }));
    expect(screen.getByRole("link", { name: "Open document" }).getAttribute("href")).toBe("/documents/contract");
    fireEvent.click(screen.getByRole("button", { name: "Directory" }));
    expect(screen.getByRole("textbox", { name: "Search galaxy records" })).toBeTruthy();
  });
  it("provides explicit empty and search-no-match states without sample business nodes", () => {
    const map = { records: [], bodies: [], source: { name: "empty", builtAt: "", nodeCount: 0, edgeCount: 0 } };
    render(createElement(SystemExplorer, { map, selectedId: null, onSelect: vi.fn(), onOverview: vi.fn() }));
    expect(screen.getByText("No business records to display")).toBeTruthy();
    expect(screen.getByText("No matching records.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open client" })).toBeNull();
  });
});
