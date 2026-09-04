// app/galaxy — THE ISOLATED RENDERER SURFACE (Renderer Slice 4, decision A2).
//
// A Server Component that gathers and injects, exactly like app/page. It exists to prove one thing
// end to end, with a real principal and real vault data:
//
//     authorized canonical readers → GraphProjection → SpatialModel → GalaxyLayout → Renderer
//
// ─── WHY A SEPARATE PAGE RATHER THAN A FLAG INSIDE THE NEURAL CORE ─────────────────────────────
//
// A flag inside NeuralCore would have put the new pipeline inside the file that renders the live
// graph, where a mistake regresses the surface the operator actually uses. A separate route shares
// nothing with it: this page imports no `components/graph/*` module, and deleting the two files in
// `components/galaxy/` plus this one removes the slice completely. The legacy GraphCanvas and its
// simulation are untouched and remain the production graph.
//
// NOT IN NAVIGATION. It is reachable by typing the URL and by nothing else, which is what "isolated"
// means here — it is a proving surface, not a product surface. It is NOT a security boundary: the
// route authorizes exactly like every other page, through the data-access layer below it, and being
// unlisted grants no one anything. F56 governs destinations, not pages, so an unlisted page is a
// declaration of intent rather than a gap.
//
// AUTHORIZATION IS UNCHANGED AND UNTOUCHED. This page decides nothing: `graphSource()` reaches the
// guarded readers, which is where `requireCapability` answers, and `renderOrDenied` turns a refusal
// into the denial surface instead of an error page. The renderer below receives a value that was
// already scoped and cannot widen it — it never sees a principal at all.

import { projectGraph as graphSource } from "@/graph-view/projection";
import { EMPTY_GRAPH } from "@/graph-view/contract";
import { toSpatialModel } from "@/graph-view/spatial";
import { computeGalaxyLayout } from "@/graph-view/galaxy";
import { GalaxyView } from "@/components/galaxy/GalaxyView";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

async function GalaxyPageContent({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  // A malformed vault record degrades to an honest empty graph, never a crashed page — the same
  // posture app/page takes, for the same reason.
  const projection = await graphSource().catch(() => EMPTY_GRAPH);

  // The pipeline, in the order the architecture names. Both steps are pure and deterministic, so
  // running them here is a choice about where the work happens, not about who is allowed to see it.
  const spatial = toSpatialModel(projection);
  const layout = computeGalaxyLayout(spatial);

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
    <main style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <GalaxyView
        projection={projection}
        spatial={spatial}
        layout={layout}
        initialDetail="artifacts"
        initialFocusId={initialFocusId}
      />
    </main>
  );
}

export default async function GalaxyPage(...props: Parameters<typeof GalaxyPageContent>) {
  return renderOrDenied("Galaxy renderer", () => GalaxyPageContent(...props));
}
