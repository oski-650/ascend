// core/crm/import — WHAT THE CSV IMPORT SURFACE MAY KNOW (2G.4.7).
//
// ─── WHY THIS MOVED OUT OF `core/admin` ────────────────────────────────────────────────────────
//
// It was `listImportFields` in `core/admin/tools.ts`, guarded by `admin:*`, because 2G.4.4 found the
// whole `/admin` surface unguarded and fixed all three pages together. That was right for the
// disclosure and wrong for this one: bulk prospect import is not administration. It creates
// prospects — `app/api/import/prospects/route.ts` calls `createProspect` and nothing else — and its
// route has always been mapped to `import:run`, never to `admin:*`.
//
// 2G.4.7 granted the sales partner `import:run`. Leaving the page behind `admin:*` would have left a
// business capability stranded: reachable through the API, invisible in the product. So the reader
// moved to the layer that owns prospects, and its capability boundary is the one its own route
// already used.
//
// ─── THE BOUNDARY IS `import:run`, NOT `prospects:write` ───────────────────────────────────────
//
// Deliberate, and unchanged by the move. Writing one prospect and importing a thousand are different
// acts with different blast radii, and §8 named them separately. A future narrower role could hold
// `prospects:write` and be denied this without anyone revisiting the question — the same reason
// `core/auth/routes.ts` maps prospect DELETION to `prospects:identity` rather than folding it in.

import "server-only";
import { requireCapability } from "@/core/auth/authority";

/** One mappable column on the CSV import surface. */
export type ImportField = {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly required?: boolean;
};

const IMPORT_FIELDS: readonly ImportField[] = [
  { key: "name", label: "Business name", hint: "Required. Becomes the prospect filename slug.", required: true },
  { key: "business_type", label: "Business type", hint: "e.g. Roofing, HVAC, Cleaning" },
  { key: "location", label: "Location", hint: "City, state, region" },
  { key: "status", label: "Status", hint: "lead, contacted, proposal, closed-won, closed-lost" },
  { key: "website", label: "Website URL", hint: "" },
  { key: "website_quality", label: "Website quality", hint: "none, outdated, acceptable, modern" },
  { key: "decision_maker_access", label: "DM access (bool)", hint: "true/yes/1 or false/no/0" },
  { key: "project_urgency", label: "Project urgency", hint: "low / medium / high" },
  { key: "niche_alignment", label: "Niche alignment (bool)", hint: "true/yes/1" },
  { key: "contact_name", label: "Contact name", hint: "" },
  { key: "contact_phone", label: "Contact phone", hint: "" },
  { key: "contact_email", label: "Contact email", hint: "" },
  { key: "source", label: "Source", hint: "How you found them" },
  { key: "notes", label: "Notes / friction", hint: "Free-text notes for the markdown body" },
];

/**
 * The CSV import field map, for a caller holding `import:run`.
 *
 * No connection is leased — the catalogue is compiled in. `requireCapability` is still the whole
 * boundary: it resolves the caller through `core/auth/authority`, which for a page render reaches
 * `pageAuthority()` → `resolvePrincipal` → the database, so a revoked account fails HERE rather than
 * rendering. Same shape and the same reasoning as `core/admin/tools`; only the capability differs.
 */
export async function listImportFields(): Promise<readonly ImportField[]> {
  await requireCapability("import:run");
  return IMPORT_FIELDS;
}
