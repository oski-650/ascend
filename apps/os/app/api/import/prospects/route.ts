import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { parseCsv } from "@/lib/csv";
import { importSheet } from "@/core/intake/import";
import { withProspectDb } from "@/core/crm/source";
import { authorize } from "@/lib/route-guard";

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

// ─── THE MARKDOWN BUILDER AND ITS VALIDATORS LIVED HERE, AND ARE GONE ──────────────────────────
//
// `slugify`, `parseBool`, `VALID_STATUSES`/`VALID_QUALITY`/`VALID_URGENCY` and `buildMarkdown` were
// this route's own copy of what a sheet row MEANS — a second vocabulary beside the one the domain
// already owns. They are deleted rather than left unused: the closed-vocabulary checks now live in
// `core/intake/projection` (validated, never guessed) and the write goes to Postgres through the
// canonical writer, so a markdown builder here would be a third prospect representation.
//
// The route now validates its input, authorizes, calls ONE function, and reports.

export async function POST(req: Request) {
  return authorize(req, "import:run", async (principal) => {
    try {
      const body = (await req.json()) as {
        csv?: string;
        column_map?: ColumnMap;
        dry_run?: boolean;
        label?: string;
        source_name?: string;
      };
      if (!body.csv) return NextResponse.json({ error: "csv required" }, { status: 400 });
      if (!body.column_map?.name) {
        return NextResponse.json({ error: "column_map.name is required" }, { status: 400 });
      }

      // Header validation uses the NORMALISING parser deliberately: it answers "did the operator
      // map a column that exists", which is a question about the mapping, not about the record.
      // The intake re-reads the same bytes verbatim for the evidence (§1.3).
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

      // DRY RUN REMAINS COMPLETELY NON-MUTATING: it returns before the intake is reached, so no
      // prospect is written and NO EVIDENCE IS RECORDED. A dry run that appended to the event spine
      // would be a preview that changed the thing it previewed.
      if (body.dry_run) {
        return NextResponse.json({
          ok: true, dry_run: true, total_rows: parsed.rows.length, headers: parsed.headers,
          outcomes: [],
        });
      }

      // ONE CALL. Every rule — verbatim evidence, §1.4's blank-cell semantics, §2.1's five
      // outcomes, the prospect write — lives in core/intake and core/db. This handler validates its
      // input, authorizes, and reports; it decides nothing about what a row means. Duplicating any
      // of that here is what F-rules on the route surface exist to prevent.
      const result = await withProspectDb((tx) =>
        importSheet(tx, principal.organizationId, {
          csv: body.csv!,
          label: body.label ?? "CSV import",
          sourceKind: "csv_paste",
          sourceName: body.source_name ?? "paste",
          columnMap: body.column_map!,
          createdBy: principal.userId,
        })
      );

      return NextResponse.json({
        ok: true,
        dry_run: false,
        batch_id: result.batch.batch_id,
        file_sha256: result.batch.file_sha256,
        total_rows: parsed.rows.length,
        headers: parsed.headers,
        outcomes: result.outcomes,
      });
    } catch (e) {
      return serverErrorResponse("import/prospects", e);
    }
  });
}
