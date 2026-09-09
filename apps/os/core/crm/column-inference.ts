// core/crm/column-inference — WHAT A SPREADSHEET HEADER MEANS (2026-09-04).
//
// ─── WHY THIS IS A DOMAIN QUESTION AND NOT A UI ONE ────────────────────────────────────────────
//
// A weaker version of this lived in `components/sales/ImportProspectsPanel` as a "smart-guess"
// block: nine regexes in a client component, run against a header line the component split on ","
// itself. That is the shape `core/crm/sheet-import`'s header already condemns one layer up — *"what
// a CSV column MEANS is a domain question, not an HTTP one"* — and the consequences were the two
// this module exists to remove.
//
// First, the guess was ADVISORY. It pre-filled fourteen `<select>` elements the operator still had
// to read and approve, so a wrong guess was indistinguishable from a right one at a glance, and the
// approval was theatre. Second, the component's own comma-split meant the guess ran against
// headers that did not exist when the sheet was tab-separated.
//
// The mapping now happens once, on the server, from the headers the real parser found. The surface
// displays the answer; it does not compute one. There is no second vocabulary to drift.
//
// ─── IT NAMES COLUMNS. IT NEVER INVENTS VALUES. ────────────────────────────────────────────────
//
// This module's entire output is a `header → field` map. It does not read a single cell, so it
// cannot state anything about a business — §1.4's "an empty cell is a fact about the sheet, never a
// value on the prospect" is untouched by it, and `core/intake/projection` remains the only thing
// that decides what a row supports. A column this module fails to recognise is simply unmapped:
// absent from the map, and therefore unstated by every rule already written. Guessing wrong here
// costs a field, never a fabricated fact.

import "server-only";

/** The prospect fields a sheet column may feed. Mirrors `core/crm/import`'s catalogue. */
const FIELDS = [
  "name",
  "business_type",
  "location",
  "status",
  "website",
  "website_quality",
  "decision_maker_access",
  "project_urgency",
  "niche_alignment",
  "contact_name",
  "contact_phone",
  "contact_email",
  "source",
  "notes",
] as const;

export type InferredField = (typeof FIELDS)[number];

export type InferredColumnMap = {
  /** `field → the header, exactly as the sheet spelled it`. Only confident matches appear. */
  readonly map: Readonly<Record<string, string>>;
  /** Headers this module did not recognise. Shown to the operator; never silently dropped. */
  readonly unmapped: readonly string[];
};

/**
 * Header spellings, normalised.
 *
 * `exact` wins outright and is tried for every field before any `loose` pattern is tried for any
 * field — so a sheet with both `Company` and `Contact Name` binds each to the right side rather
 * than letting whichever field is checked first take both. `loose` is a substring test, used only
 * to place headers no exact rule claimed.
 *
 * ─── THE ORDERING BUG THIS SHAPE EXISTS TO PREVENT ───────────────────────────────────────────
 *
 * The old UI guess tested `/(contact|owner)/` for `contact_name` BEFORE anything looked at
 * `contact_email`, so a sheet whose only matching header was `Contact Email` bound the email column
 * to the contact's NAME and left the email unmapped. Two passes plus one-header-one-field is what
 * makes that unrepresentable: `Contact Email` matches `contact_email` exactly in pass one and is
 * claimed before `contact_name`'s loose `contact` is ever consulted.
 */
const RULES: Readonly<Record<InferredField, { exact: readonly string[]; loose: readonly string[] }>> = {
  // BARE `name` IS THE BUSINESS, not the contact. The field catalogue calls this column "Business
  // name" and the import surface's own example sheet heads it `name`, so a one-word `Name` in a
  // hit list means the company. It is listed LAST: a sheet carrying both `Company` and `Name` binds
  // the company, and leaves `Name` unmapped rather than guessing which person it describes.
  name: {
    exact: ["business name", "company name", "company", "business", "organization", "organisation",
            "account name", "account", "dba", "practice name", "firm", "firm name", "name"],
    loose: ["company", "business name", "organization"],
  },
  business_type: {
    exact: ["industry", "business type", "category", "type", "vertical", "niche", "sector", "trade"],
    loose: ["industry", "category", "vertical"],
  },
  location: {
    exact: ["location", "city", "address", "region", "market", "area", "city state", "town",
            "street address", "full address"],
    // `address` is deliberately NOT loose: it is a substring of "email address", and pass 2 would
    // hand the email column to `location` on any sheet where `contact_email` was already bound to a
    // different header.
    loose: ["location", "city"],
  },
  status: {
    exact: ["status", "stage", "lead status", "pipeline status", "pipeline stage"],
    loose: ["status", "stage"],
  },
  website: {
    exact: ["website", "web site", "url", "domain", "site", "homepage", "web address", "website url"],
    loose: ["website", "url", "domain"],
  },
  website_quality: {
    exact: ["website quality", "site quality", "web quality"],
    loose: ["website quality", "site quality"],
  },
  decision_maker_access: {
    exact: ["decision maker access", "dm access", "decision maker", "decision maker contact"],
    loose: ["decision maker"],
  },
  project_urgency: {
    exact: ["project urgency", "urgency", "priority"],
    loose: ["urgency", "priority"],
  },
  niche_alignment: {
    // Bare `fit` is omitted: too generic to claim a column on, and a wrong boolean here feeds
    // `computeScore` directly.
    exact: ["niche alignment", "niche fit", "icp fit"],
    loose: ["niche alignment", "icp fit"],
  },
  contact_name: {
    exact: ["contact name", "contact", "owner", "owner name", "full name", "first name",
            "contact person", "primary contact", "point of contact"],
    loose: ["contact name", "owner", "first name"],
  },
  contact_phone: {
    exact: ["phone", "phone number", "telephone", "mobile", "cell", "contact phone",
            "business phone", "primary phone", "tel"],
    loose: ["phone", "mobile", "telephone"],
  },
  contact_email: {
    exact: ["email", "email address", "e mail", "contact email", "business email", "primary email"],
    loose: ["email", "e mail"],
  },
  source: {
    exact: ["source", "lead source", "origin", "referrer", "channel"],
    loose: ["source", "referrer"],
  },
  notes: {
    exact: ["notes", "note", "comments", "comment", "details", "description", "friction", "remarks"],
    loose: ["notes", "comment", "description"],
  },
};

/**
 * Case, punctuation and spacing folded away — `"Business Name"`, `"business_name"` and
 * `"BUSINESS-NAME"` are the same header spelling to the matcher.
 *
 * Only the MATCHER sees this form. The map returned always carries the header as the sheet spelled
 * it, because `core/intake/projection` looks cells up by the original key and §1.3 keeps the
 * evidence's headers verbatim. Normalising the stored map would break both.
 */
function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Bind each prospect field to at most one header, and each header to at most one field.
 *
 * `name` is not defaulted to the first column. The old UI did that (`if (!guess.name) guess.name =
 * headers[0]`), which is how a sheet whose first column is a numeric record id produced 3,193
 * prospects named after row ids. A sheet this module cannot find a business name in gets NO name
 * mapping, and the route refuses the import rather than inventing one — see its handler.
 */
export function inferColumnMap(headers: readonly string[]): InferredColumnMap {
  const map: Record<string, string> = {};
  const claimed = new Set<string>();

  // A header is matched by its normalised spelling; blank headers are unmatchable and stay unmapped.
  const normalized = headers.map((h) => ({ raw: h, norm: normalize(h) }));

  // PASS 1 — exact spellings, every field, before any loose pattern runs anywhere.
  for (const field of FIELDS) {
    for (const spelling of RULES[field].exact) {
      const hit = normalized.find((h) => h.norm === spelling && !claimed.has(h.raw));
      if (hit) {
        map[field] = hit.raw;
        claimed.add(hit.raw);
        break;
      }
    }
  }

  // PASS 2 — substring patterns, only for fields still unbound and headers still unclaimed.
  for (const field of FIELDS) {
    if (map[field]) continue;
    for (const pattern of RULES[field].loose) {
      const hit = normalized.find((h) => h.norm.includes(pattern) && !claimed.has(h.raw));
      if (hit) {
        map[field] = hit.raw;
        claimed.add(hit.raw);
        break;
      }
    }
  }

  return {
    map,
    unmapped: headers.filter((h) => !claimed.has(h)),
  };
}
