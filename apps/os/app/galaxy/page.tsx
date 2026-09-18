// Authorized Ascend OS galaxy: client stars, project planets and record satellites.
// Guarded readers scope the projection before the pure spatial adapter runs.
// The renderer receives records and canonical links; it cannot widen access.

import { projectGraph as graphSource } from "@/graph-view/projection";
import { toSpatialModel } from "@/graph-view/spatial";
import { GalaxyClient } from "./GalaxyClient";
import { buildSystemMap } from "@/graph-view/field/systems";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

async function GalaxyPageContent({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  // Denial and read errors must reach their boundaries; an outage is not an empty business.
  const projection = await graphSource();

  // The pipeline, in the order the architecture names. Both steps are pure and deterministic, so
  // running them here is a choice about where the work happens, not about who is allowed to see it.
  const spatial = toSpatialModel(projection);
  const systemMap = buildSystemMap(projection, spatial);

  // ROUTE ADDRESSABILITY. `?focus=<GraphNode.id>` opens on one object, so a view can be reloaded,
  // bookmarked or handed to somebody rather than being lost the moment the page reloads.
  //
  // The value is UNTRUSTED URL INPUT and is honoured only when the ALREADY-AUTHORIZED projection
  // contains that exact id — the rule app/page has carried since the Neural Core shipped: "Only
  // honor a focus id the model actually contains — never trust a URL to name a node." Exact
  // identity, never a prefix, never parsed for its parts, never looked up anywhere else.
  //
  // It is also not an oracle: a valid id names an object this principal can already see in the
  // list, and an invalid one is indistinguishable from no focus at all — no error, no message, just
  // the ordinary unfocused Galaxy.
  const { focus } = await searchParams;
  const initialFocusId = focus && projection.nodes.some((node) => node.id === focus) ? focus : null;

  return (
    <div data-fullbleed className="galaxy-page">
      <GalaxyClient systemMap={systemMap} initialFocusId={initialFocusId} />
    </div>
  );
}

export default async function GalaxyPage(...props: Parameters<typeof GalaxyPageContent>) {
  return renderOrDenied("Galaxy renderer", () => GalaxyPageContent(...props));
}
