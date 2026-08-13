import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hitListDir } from "@/lib/paths";
import { parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

type ColumnMap = {
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

function slugify(s: string): string {
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

function buildMarkdown(row: Record<string, string>, col: ColumnMap): string {
  const name = row[col.name];
  const fields: string[] = [];
  fields.push(`name: ${JSON.stringify(name)}`);
  fields.push(`business_type: ${JSON.stringify(col.business_type ? row[col.business_type] ?? "" : "")}`);
  fields.push(`location: ${JSON.stringify(col.location ? row[col.location] ?? "" : "")}`);
  const status = normalizedStatus(col.status ? row[col.status] : undefined) ?? "lead";
  fields.push(`status: ${status}`);
  fields.push(`website: ${JSON.stringify(col.website ? row[col.website] ?? "" : "")}`);
  const quality = normalizedQuality(col.website_quality ? row[col.website_quality] : undefined);
  fields.push(`website_quality: ${quality ?? "none"}`);
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      csv?: string;
      column_map?: ColumnMap;
      dry_run?: boolean;
      overwrite?: boolean;
    };
    if (!body.csv) return NextResponse.json({ error: "csv required" }, { status: 400 });
    if (!body.column_map?.name) {
      return NextResponse.json({ error: "column_map.name is required" }, { status: 400 });
    }

    const parsed = parseCsv(body.csv);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "no rows found in CSV" }, { status: 400 });
    }
    if (!parsed.headers.includes(body.column_map.name)) {
      return NextResponse.json(
        { error: `name column "${body.column_map.name}" not found in CSV headers` },
        { status: 400 }
      );
    }

    const dir = hitListDir();
    if (!body.dry_run) await fs.mkdir(dir, { recursive: true });

    const created: { slug: string; name: string; written: boolean; reason?: string }[] = [];
    for (const row of parsed.rows) {
      const name = row[body.column_map.name]?.trim();
      if (!name) {
        created.push({ slug: "", name: "(blank)", written: false, reason: "missing name" });
        continue;
      }
      const slug = slugify(name);
      const target = path.join(dir, `${slug}.md`);
      let exists = false;
      try {
        await fs.access(target);
        exists = true;
      } catch {
        /* doesn't exist */
      }
      if (exists && !body.overwrite) {
        created.push({ slug, name, written: false, reason: "exists (overwrite=false)" });
        continue;
      }
      if (body.dry_run) {
        created.push({ slug, name, written: false, reason: "dry run" });
        continue;
      }
      const md = buildMarkdown(row, body.column_map);
      await fs.writeFile(target, md, "utf8");
      created.push({ slug, name, written: true, reason: exists ? "overwritten" : "created" });
    }

    return NextResponse.json({
      ok: true,
      dry_run: !!body.dry_run,
      total_rows: parsed.rows.length,
      headers: parsed.headers,
      results: created,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
