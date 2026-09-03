"use client";

// components/galaxy/GalaxyView — ONE SCENE, TWO SURFACES (Slice 5, decision B).
//
//     GraphProjection → SpatialModel → GalaxyLayout ──► Scene ──┬──► GalaxyCanvas  (pixels)
//                                                               └──► SceneList     (text)
//
// This component builds the `Scene` ONCE and hands the same value to both surfaces. That is the
// architectural requirement of the slice, not a convenience: an accessible list built from the
// projection while the canvas is built from the scene would be two data paths, and the non-visual
// one would drift first because nobody watches it. Here the two cannot disagree — they iterate the
// same array, and a witness asserts it.
//
// It also owns the interaction state, which is the correct home for it: selection and hover are
// neither business facts nor layout, and both surfaces need to agree on them. Selecting a row in the
// list focuses the same object on the canvas because there is one `selectedId`, not two.
//
// STATIC (decision C): no animation anywhere in this slice.

import { useMemo, useState } from "react";
import type { GraphProjection } from "@/graph-view/contract";
import type { LayoutModel } from "@/graph-view/galaxy";
import type { SpatialModel } from "@/graph-view/spatial";
import type { DetailLevel } from "@/graph-view/taxonomy";
import { buildScene } from "./scene";
import { GalaxyCanvas } from "./GalaxyCanvas";
import { SceneList } from "./SceneList";

type Props = {
  projection: GraphProjection;
  spatial: SpatialModel;
  layout: LayoutModel;
  detail: DetailLevel;
};

export function GalaxyView({ projection, spatial, layout, detail }: Props) {
  const scene = useMemo(
    () => buildScene({ projection, spatial, layout, detail }),
    [projection, spatial, layout, detail]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const empty = scene.nodes.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: "#0d0f11" }}>
      <div style={{ position: "relative", flex: "1 1 auto", minWidth: 0 }}>
        {empty ? (
          // An honest empty state. Never a placeholder object: a fabricated node would be a business
          // object the renderer invented, which is the one thing this layer must never do.
          <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                      margin: 0, color: "#9aa2ab" }}>
            Nothing to show. The graph is empty for this account.
          </p>
        ) : (
          <GalaxyCanvas
            scene={scene}
            selectedId={selectedId}
            hoverId={hoverId}
            onSelect={setSelectedId}
            onHover={setHoverId}
          />
        )}
      </div>

      {/*
        The non-visual surface. It is a real, keyboard-reachable representation of the same scene —
        not a summary and not an afterthought — which is why it sits in the layout rather than being
        hidden behind a screen-reader-only class. The canvas is aria-hidden; this is the accessible
        path to the same objects.
      */}
      <nav
        aria-label="Graph objects"
        style={{
          flex: "0 0 22rem", maxWidth: "40%", overflowY: "auto",
          padding: "1rem", borderLeft: "1px solid #1e2227", color: "#e9ebee",
          font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem", font: "600 13px/1.4 inherit", color: "#9aa2ab" }}>
          {scene.nodes.length} objects · {scene.edges.length} relationships
        </h2>
        <SceneList scene={scene} selectedId={selectedId} onSelect={setSelectedId} />
      </nav>
    </div>
  );
}
