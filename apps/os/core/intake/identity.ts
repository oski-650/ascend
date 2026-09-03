// core/intake/identity — WHICH OF §2's FIVE OUTCOMES A ROW REACHES (§2.1, §2.2).
//
// ─── NO NEW IDENTITY SYSTEM. THE NORMALISERS ARE STAGE 1'S. ────────────────────────────────────
//
// `normalizeWebsiteKey`, `normalizePhoneKey` and `normalizeNameKey` come from
// `core/vault/identity` unchanged — §2.2: *"Reuses `findDuplicateCandidates`' normalisers — one
// definition of what a duplicate is, not two."* This module adds an ORDER of evaluation and a
// vocabulary of outcomes. It does not add a notion of sameness.
//
// ─── ORDER IS THE SAFETY ARGUMENT (§2.1) ───────────────────────────────────────────────────────
//
//     1  blocked        corroborates a HELD prospect       create nothing; name the blocker
//     2  matched        corroborates exactly one ANCHORED  do not create; report the match
//     3  ambiguous      corroborates two or more anchored  create nothing; human review
//     4  new            corroborates nothing               create, mint an anchor
//
// **`blocked` IS FIRST, and §2.1 calls it "the single most important line in this document".**
// A held prospect is invisible to assignment and must stay visible to MATCHING. Collapsing
// `blocked` into `new` creates a third Tapia record — *"the quarantine manufacturing the duplicate
// it exists to prevent"*. That is P4 of STAGE1-GATING, and the ordering below is what enforces it.
//
// §2.1's `client_match` is NOT implemented here and is not silently dropped: clients live in the
// vault, this resolver reads the Postgres prospect universe, and reaching across that boundary is a
// larger question than an ordering. It is recorded in §7.3 follow-ups rather than approximated —
// an outcome that answered "no client matched" without having looked would be worse than one that
// says it did not look.
//
// ─── NAME ALONE IS NOT CORROBORATION (§2.2) ────────────────────────────────────────────────────
//
// *"normalised name match ALONE — not sufficient — dozens of businesses share one."* Name counts
// only WITH locality. Website, phone and email each corroborate on their own.

import "server-only";
import { normalizeNameKey, normalizePhoneKey, normalizeWebsiteKey } from "@/core/vault/identity";
import type { ProspectRow } from "@/core/db";
import type { CreateProspectInput } from "@/core/db";

export type IdentityOutcome =
  | { readonly kind: "blocked"; readonly blockers: readonly string[] }
  | { readonly kind: "matched"; readonly rowId: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] }
  | { readonly kind: "new" };

/** Email is compared lowercased and trimmed — the same rule `findDuplicateCandidates` applies. */
function emailKey(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

function localityKey(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

/**
 * Does this row corroborate that stored prospect? (§2.2)
 *
 * Strong on its own: website host+path, last-10 phone digits, email. Name only in combination with
 * locality. Anything else is not corroboration, and "not corroborated" is the honest answer rather
 * than a weak yes.
 */
export function corroborates(input: CreateProspectInput, stored: ProspectRow): boolean {
  const w = normalizeWebsiteKey(input.website);
  if (w && w === normalizeWebsiteKey(stored.website)) return true;

  const p = normalizePhoneKey(input.contactPhone);
  if (p && p === normalizePhoneKey(stored.contactPhone)) return true;

  const e = emailKey(input.contactEmail);
  if (e && e === emailKey(stored.contactEmail)) return true;

  // NAME + LOCALITY, never name alone.
  const n = normalizeNameKey(input.name);
  const l = localityKey(input.location);
  if (n && l && n === normalizeNameKey(stored.name) && l === localityKey(stored.location)) return true;

  return false;
}

/**
 * Resolve one row against the stored universe, in §2.1's order.
 *
 * `universe` is every prospect the caller may see — held AND anchored. Passing only the anchored
 * ones would make `blocked` unreachable, which is the precise failure §2.1 exists to prevent, so
 * the caller's query is part of this contract rather than an implementation detail.
 */
export function resolveIdentity(
  input: CreateProspectInput,
  universe: readonly ProspectRow[]
): IdentityOutcome {
  const corroborated = universe.filter((row) => corroborates(input, row));

  // 1 — BLOCKED. Checked FIRST, before any anchored match, and before `new`.
  const held = corroborated.filter((r) => r.identityState === "held");
  if (held.length > 0) {
    return { kind: "blocked", blockers: held.map((r) => r.id) };
  }

  const anchored = corroborated.filter((r) => r.identityState === "anchored");
  // 2 — MATCHED, exactly one.
  if (anchored.length === 1) return { kind: "matched", rowId: anchored[0].id };
  // 3 — AMBIGUOUS, two or more. Creating would manufacture a duplicate; a human decides.
  if (anchored.length > 1) return { kind: "ambiguous", candidates: anchored.map((r) => r.id) };
  // 4 — NEW. Corroborates nothing.
  return { kind: "new" };
}
