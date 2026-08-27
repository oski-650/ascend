// identity-backfill/holds — PROSPECTS THE BACKFILL MAY NOT ANCHOR, declared as data.
//
// Mirrors `migration/evidence.ts`'s DECLARED_EXCLUSIONS, and for the same reason: an absence that
// lives only in someone's head is indistinguishable from an oversight. Naming it makes it legible,
// and the fitness rule makes it durable.
//
// WHY A HOLD EXISTS AT ALL — the ambiguity this prevents.
//
// Assigning an identity is not a neutral act. Giving two files two different `prospect_id`s asserts
// something: THESE ARE TWO BUSINESSES. When the two files are in fact one business recorded twice,
// that assertion is false, and it is false in a way that gets harder to undo over time — every
// research finding, source row and event keyed to the losing id has to be re-pointed at a merge
// that nobody has yet decided the direction of.
//
// So the rule is: WHERE THE DETECTOR SAYS TWO RECORDS MAY BE ONE BUSINESS, ASSIGN NEITHER.
// Not "pick one", not "assign both and reconcile later". An unanchored prospect is a known,
// reported, blocking state; a wrongly-anchored pair is a silent false claim.

import "server-only";

export type DeclaredHold = {
  slug: string;
  /** Why a human, not the detector, must resolve this before it can be anchored. */
  reason: string;
};

/**
 * The Tapia pair, held by decision rather than by heuristic.
 *
 * Both files carry `website: "https://tapiatilemarbleco.com/"`, and a client folder
 * `tapia-tile-marble` already exists for the same company — so this is a three-way identity
 * question, not a two-way one. Both filenames also contain `-amp-`, the HTML-entity leak D-4 fixed
 * at source; renaming them is a separate vault decision and is explicitly NOT part of this stage.
 *
 * The detector would flag this pair on its own (shared website). It is declared here as well so the
 * hold survives any future change to the detector's heuristics — belt and braces, exactly as
 * DECLARED_EXCLUSIONS is belt and braces against the migration's classifier.
 */
export const DECLARED_HOLDS: readonly DeclaredHold[] = [
  {
    slug: "tapia-tile-amp-marble-co",
    reason:
      "Same business as tile-amp-marble-installation-in-bay-area (shared website) and as the existing " +
      "CRM client tapia-tile-marble. Which record survives, and whether it merges into the client, is a " +
      "human decision. Anchoring it would assert it is an independent business.",
  },
  {
    slug: "tile-amp-marble-installation-in-bay-area",
    reason:
      "Same business as tapia-tile-amp-marble-co (shared website) and as the existing CRM client " +
      "tapia-tile-marble. Held for the same reason: assigning an identity here would assert independence " +
      "that the evidence contradicts.",
  },
];

export function declaredHoldFor(slug: string): DeclaredHold | undefined {
  return DECLARED_HOLDS.find((h) => h.slug === slug);
}