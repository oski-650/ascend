"use client";

// components/galaxy/scene/Effects — THE POST CHAIN (brief §11).
//
// ─── ORDER MATTERS, AND SO DOES THE BUFFER FORMAT ──────────────────────────────────────────────
//
// `HalfFloatType` is the one setting here that is not a preference. Every bright thing in this scene
// is driven PAST 1.0 on purpose — the star cores at 2.2×, the photon ring at 4× — because values
// above 1.0 are what the bloom pass selects on and what ACES rolls off to white. An 8-bit buffer
// clips them flat before bloom ever sees them, and the result is the difference between a hot core
// and a white disc. It is also what stops the large dark areas banding.
//
// The chain is short by design at this phase: §11's depth-of-field belongs to the focused levels
// Phase 5 introduces, and the screen-space lensing pass belongs next to the black hole it distorts.
// Adding either now would mean tuning an effect against a scene that does not exist yet.
//
// No full-screen grain: empty space must remain black.

import { Bloom, ChromaticAberration, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { HalfFloatType } from "three";
import type { QualityTier } from "../camera/focusStore";
import { Lensing } from "./Lensing";

export function Effects({ quality }: { quality: QualityTier }) {
  return (
    <EffectComposer key={quality} multisampling={0} frameBufferType={HalfFloatType}>
      {/*
        The threshold is high — 0.62 — so bloom picks out the few genuinely hot things rather than
        smearing the whole field. A low threshold on a scene made of 160,000 points turns the galaxy
        into fog, which is the failure that looks like "atmosphere" until you compare it with a
        photograph.
      */}
      <Bloom
        intensity={0.85}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.28}
        mipmapBlur
        radius={0.62}
      />
      {/*
        AFTER bloom, so what gets bent is the bloomed image rather than the raw one — the glow
        around the photon ring bends with the ring. Full tier only: it samples the scene buffer per
        pixel and is by some distance the most expensive thing in this chain.
      */}
      {quality === "high" ? <Lensing /> : <></>}
      <ChromaticAberration offset={[0.0005, 0.0005]} radialModulation modulationOffset={0.15} />
      <Vignette offset={0.24} darkness={0.62} />
      <SMAA />
    </EffectComposer>
  );
}
