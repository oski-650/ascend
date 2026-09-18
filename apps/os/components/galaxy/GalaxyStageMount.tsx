"use client";

// components/galaxy/GalaxyStageMount — the client seam that keeps WebGL off the server.
//
// `<Canvas>` measures a DOM node and asks for a GL context, neither of which exists during a server
// render. `ssr: false` is therefore not an optimisation, and the `loading` fallback is not optional
// either: `next/dynamic` with no fallback renders `null`, which is how the last rebuild spent a
// round on a blank page that was reporting no errors because nothing had gone wrong.

import dynamic from "next/dynamic";
import type { SystemMap } from "@/graph-view/field/systems";
import { SurfaceLoading } from "./SurfaceBoundary";

const GalaxyStage = dynamic(
  () => import("./GalaxyStage").then((m) => m.GalaxyStage),
  { ssr: false, loading: () => <SurfaceLoading label="Galaxy" /> },
);

export function GalaxyStageMount({ systemMap, initialFocusId, onRefresh }: { systemMap?: SystemMap; initialFocusId?: string | null; onRefresh?: () => void }) {
  return <GalaxyStage systemMap={systemMap} initialFocusId={initialFocusId} onRefresh={onRefresh} />;
}
