// The frozen experimental corpus, shared by the N1 golden test and the N2 plasticity suite.
//
// It lives here rather than inside either suite so that both measure the SAME control. A duplicated
// copy could drift, and a control that drifts is not one.
//
// This is the exact retained activation stream from the live vault, measured 2026-08-19: 27 events
// in the spine, 17 of them emitted by the reconciler (actor "system") and therefore excluded, and
// these 10 remaining. It is deliberately a snapshot rather than a live read — a live-vault fixture
// would change the moment another client is onboarded, and a moving baseline cannot falsify
// anything.

import type { Activation, StructuralPair } from "@/cognition/contract";
import type { EntityKind } from "@/domain";

/** The injected `now` the baseline is measured at: two days after the last retained event. */
export const REAL_NOW = new Date("2026-08-19T12:00:00.000Z");

const at = (entity: EntityKind, entityId: string, when: string, ordinal: number): Activation => ({
  subject: { entity, entity_id: entityId },
  at: when,
  ordinal,
  intensity: 1,
  provenance: { source: "event", eventId: `e${ordinal}` },
});

export const REAL_STREAM: Activation[] = [
  at("project", "tapia-tile-marble", "2026-07-17T21:53:17.905Z", 0),
  at("project", "tapia-tile-marble", "2026-07-17T21:53:17.905Z", 1),
  at("project", "tapia-tile-marble", "2026-07-17T21:53:30.905Z", 2),
  at("project", "tapia-tile-marble", "2026-07-17T21:53:31.905Z", 3),
  at("project", "tapia-tile-marble", "2026-07-18T07:46:48.000Z", 4),
  at("project", "tapia-tile-marble", "2026-07-18T07:46:49.000Z", 5),
  at("project", "decoraciones-pilar", "2026-08-13T19:38:10.000Z", 6),
  at("project", "decoraciones-pilar", "2026-08-13T19:38:28.000Z", 7),
  at("client", "elite-vac-service", "2026-08-17T11:35:06.000Z", 8),
  at("project", "elite-vac-service", "2026-08-17T11:35:06.000Z", 9),
];

export const REAL_STRUCTURAL: StructuralPair[] = [
  { a: "client/tapia-tile-marble", b: "project/tapia-tile-marble" },
  { a: "client/decoraciones-pilar", b: "project/decoraciones-pilar" },
  { a: "client/elite-vac-service", b: "project/elite-vac-service" },
];
