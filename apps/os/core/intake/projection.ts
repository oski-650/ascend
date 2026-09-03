// core/intake/projection — a verbatim row becomes ASCEND FOUND, or it does not (§1.4, §7.3(c)).
//
// ─── THIS FILE DERIVES. IT DOES NOT STORE, AND IT DOES NOT JUDGE. ──────────────────────────────
//
// The evidence (`./evidence`) records what the sheet SAID. This decides what, if anything, that row
// supports as a claim about a business — and hands it to the EXISTING writer. It opens no
// connection, writes no row, and emits no event.
//
// ─── A HUMAN JUDGED IS UNREACHABLE FROM HERE, BY TYPE ──────────────────────────────────────────
//
// `CreateProspectInput` has no `websiteOpportunity`, no `assessedBy`, no `assessedAt`. Not omitted
// by this module's discipline — ABSENT FROM THE WRITER'S INPUT TYPE, so no import path can write a
// judgment even by mistake. The database says the same thing one layer down: `ascend_automation`
// holds no grant on those three columns, and `assessment_has_provenance` requires all three
// together or none. Three independent barriers, and this file relies on the strongest of them.
//
// ─── §1.4 IS THE WHOLE OF THE MAPPING RULE ─────────────────────────────────────────────────────
//
//     column absent from the sheet   →  field NOT written
//     column present, cell empty     →  field NOT WRITTEN        ← the one that gets collapsed
//     column present, cell has value →  field written
//
// > **An empty cell is a fact about the sheet, never a value on the prospect.**
//
// `""` in a website column means the sheet had the column and left it blank. It does NOT mean the
// business has no website, and it must never reach `website_quality: none`. Collapsing the middle
// row into either neighbour "is the D-1/D-2 failure returning".
//
// ─── TRIMMING IS CORRECT HERE AND FORBIDDEN IN THE EVIDENCE ────────────────────────────────────
//
// The projection may trim: `"  Acme  "` should not become a different slug from `"Acme"`. The
// evidence may not, because "what did the sheet say" must remain answerable. Both are true at once,
// which is why `parseSheetVerbatim` and `lib/csv` coexist rather than one calling the other.

import "server-only";
import type { CreateProspectInput } from "@/core/db";
import type { SourceCells } from "./batch";

/** Which sheet column feeds which prospect field. The batch stores the map it used (§1.2). */
export type ColumnMap = Readonly<Record<string, string>>;

/**
 * What a row supports.
 *
 * `skipped` is not a failure — it is the honest outcome for a row that names nothing. §1.3 keeps
 * such rows in the evidence regardless, which is why this type carries a reason rather than
 * throwing: the caller must still record what arrived.
 */
export type Projection =
  | { readonly kind: "project"; readonly input: CreateProspectInput }
  | { readonly kind: "skipped"; readonly reason: "no name" };

/** Present AND non-blank after trimming. Absent, `""` and `"   "` are all "the sheet said nothing". */
function stated(cells: SourceCells, column: string | undefined): string | undefined {
  if (!column) return undefined;
  if (!(column in cells)) return undefined;          // §1.4 row 1 — column absent
  const trimmed = cells[column].trim();
  return trimmed === "" ? undefined : trimmed;       // §1.4 row 2 — present but blank
}

/**
 * A row's claim about a business, or nothing.
 *
 * Only fields the sheet actually STATED are set. Everything else is left absent so the column keeps
 * its NULL — and a NULL here means "unstated", which is the distinction 001's schema comment calls
 * the D-1/D-2 repair: "an unstated status is not a status, and an unstated website quality is not
 * `none`". This function therefore writes no `false` and no `"none"` it was not given.
 */
export function projectRow(cells: SourceCells, map: ColumnMap): Projection {
  const name = stated(cells, map.name);
  // A prospect with no name is not a prospect. The row is still evidence; it is not a business.
  if (!name) return { kind: "skipped", reason: "no name" };

  const input: CreateProspectInput = { name };
  const put = <K extends keyof CreateProspectInput>(key: K, value: CreateProspectInput[K] | undefined) => {
    if (value !== undefined) (input as Record<string, unknown>)[key as string] = value;
  };

  put("website", stated(cells, map.website));
  put("businessType", stated(cells, map.business_type));
  put("location", stated(cells, map.location));
  put("contactName", stated(cells, map.contact_name));
  put("contactPhone", stated(cells, map.contact_phone));
  put("contactEmail", stated(cells, map.contact_email));
  put("source", stated(cells, map.source));
  put("notes", stated(cells, map.notes));

  // CLOSED VOCABULARIES ARE VALIDATED, NEVER COERCED. A sheet saying "Lead" or "prospecting" has
  // not stated one of the five statuses, and guessing which one it meant would be Ascend inventing
  // a fact. An unrecognised value leaves the field unstated — the same answer as a blank cell,
  // because in both cases the sheet gave us nothing we may act on.
  const status = stated(cells, map.status)?.toLowerCase();
  if (status && (["lead", "contacted", "proposal", "closed-won", "closed-lost"] as const)
        .includes(status as never)) {
    put("status", status as CreateProspectInput["status"]);
  }

  const quality = stated(cells, map.website_quality)?.toLowerCase();
  if (quality && (["none", "outdated", "acceptable", "modern"] as const).includes(quality as never)) {
    put("websiteQuality", quality as CreateProspectInput["websiteQuality"]);
  }

  const urgency = stated(cells, map.project_urgency)?.toLowerCase();
  if (urgency && (["low", "medium", "high"] as const).includes(urgency as never)) {
    put("projectUrgency", urgency as CreateProspectInput["projectUrgency"]);
  }

  put("decisionMakerAccess", bool(stated(cells, map.decision_maker_access)));
  put("nicheAlignment", bool(stated(cells, map.niche_alignment)));

  return { kind: "project", input };
}

/**
 * A stated boolean, or nothing.
 *
 * `undefined` for anything unrecognised — NOT `false`. "`false` here would be a positive claim that
 * we checked" (001, one field over), and a sheet that wrote "maybe" has not checked.
 */
function bool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.toLowerCase();
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return undefined;
}
