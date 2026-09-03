// core/crm/sheet-import — the VAULT half of sheet intake (legacy store).
//
// Lifted verbatim out of `app/api/import/prospects/route.ts`, where it was route-local business
// logic: what a CSV column MEANS is a domain question, not an HTTP one. Nothing about it changed in
// the move — the same slug rules, the same closed vocabularies, the same "an omitted column is not
// evidence" semantics `tests/engines/authority-repair.test.ts` proves.
//
// IT SERVES THE `vault` STORE ONLY. When `resolveProspectSource()` answers `postgres` — the
// deployed configuration and the one §7.3(c) decided — `core/intake` handles the import instead,
// with verbatim evidence and §2.1's identity outcomes. Which of the two runs is decided in
// `core/crm/prospect.ts`, because F43 rules that the store is chosen in exactly one place.

import "server-only";

export type SheetColumnMap = {
  name: string;
  business_type?: string;
  location?: string;
  status?: string;
  website?: string;
  website_quality?: string;
  decision_maker_access?: string;
  project_urgency?: string;
  niche_alignment?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  source?: string;
  notes?: string;
};

const VALID_STATUSES = new Set(["lead", "contacted", "proposal", "closed-won", "closed-lost"]);
const VALID_QUALITY = new Set(["none", "outdated", "acceptable", "modern"]);
const VALID_URGENCY = new Set(["low", "medium", "high"]);

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "prospect";
}

function parseBool(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

function normalizedStatus(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim().replace(/\s+/g, "-");
  return VALID_STATUSES.has(s) ? s : undefined;
}

function normalizedQuality(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  return VALID_QUALITY.has(s) ? s : undefined;
}

function normalizedUrgency(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  return VALID_URGENCY.has(s) ? s : undefined;
}

export function buildMarkdown(row: Record<string, string>, col: SheetColumnMap): string {
  const name = row[col.name];
  const fields: string[] = [];
  fields.push(`name: ${JSON.stringify(name)}`);
  fields.push(`business_type: ${JSON.stringify(col.business_type ? row[col.business_type] ?? "" : "")}`);
  fields.push(`location: ${JSON.stringify(col.location ? row[col.location] ?? "" : "")}`);
  // ABSENCE STAYS ABSENCE (docs/STEP5-AUTHORITY-REPAIR.md §5). Neither field is defaulted, and
  // neither gains an `unknown` enum member to satisfy a type — an omitted prospect status is not a
  // prospect status. Downstream already handles both correctly: the reconciler skips a prospect
  // with no status rather than observing one, pipeline-engine buckets it as "unknown", and
  // lib/forecast excludes an unmodelled status from the weighted pipeline.
  const status = normalizedStatus(col.status ? row[col.status] : undefined);
  if (status) fields.push(`status: ${status}`);
  fields.push(`website: ${JSON.stringify(col.website ? row[col.website] ?? "" : "")}`);
  // `?? "none"` here was worth +30 in computeScore ("No website / outdated layout"). An omitted
  // CSV column became evidence that the prospect has no site — the one scoring default that failed
  // toward a STRONGER claim. Its three siblings below award zero points when absent, so they fail
  // toward fewer claims and are left as they are, now deliberately rather than accidentally.
  const quality = normalizedQuality(col.website_quality ? row[col.website_quality] : undefined);
  if (quality) fields.push(`website_quality: ${quality}`);
  const dm = parseBool(col.decision_maker_access ? row[col.decision_maker_access] : undefined);
  fields.push(`decision_maker_access: ${dm ?? false}`);
  const urg = normalizedUrgency(col.project_urgency ? row[col.project_urgency] : undefined);
  fields.push(`project_urgency: ${urg ?? "low"}`);
  const niche = parseBool(col.niche_alignment ? row[col.niche_alignment] : undefined);
  fields.push(`niche_alignment: ${niche ?? false}`);
  fields.push(`contact_name: ${JSON.stringify(col.contact_name ? row[col.contact_name] ?? "" : "")}`);
  fields.push(`contact_phone: ${JSON.stringify(col.contact_phone ? row[col.contact_phone] ?? "" : "")}`);
  fields.push(`contact_email: ${JSON.stringify(col.contact_email ? row[col.contact_email] ?? "" : "")}`);
  fields.push(`source: ${JSON.stringify(col.source ? row[col.source] ?? "CSV import" : "CSV import")}`);
  fields.push(`first_contact: ""`);
  fields.push(`last_contact: ""`);

  const notes = col.notes ? row[col.notes] ?? "" : "";

  return `---\n${fields.join("\n")}\n---\n\n## Call Log\n- ${new Date().toISOString().slice(0, 10)} — imported via CSV.\n\n## Friction / Notes\n${notes || "_(none yet)_"}\n`;
}

