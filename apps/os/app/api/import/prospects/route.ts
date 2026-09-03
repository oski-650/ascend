// app/api/import/prospects — bulk prospect intake from a pasted CSV.
//
// ─── THIS HANDLER DECIDES NOTHING ABOUT WHAT A ROW MEANS ───────────────────────────────────────
//
// It validates its input, authorizes, calls ONE function, and reports. Every rule the import obeys
// — verbatim evidence (§1.3), §1.4's blank-cell semantics, §2.1's five identity outcomes, and which
// store receives the write — lives below, in `core/crm` and `core/intake`.
//
// It used to own 76 lines of that: `slugify`, `parseBool`, the three closed vocabularies and
// `buildMarkdown` were this route's own copy of what a sheet column means. They moved to
// `core/crm/sheet-import` UNCHANGED. A route holding a second vocabulary beside the domain's is how
// the two drift apart.
//
// ─── AND IT DOES NOT ASK WHICH STORE IS DEPLOYED ───────────────────────────────────────────────
//
// An earlier draft of this slice branched on `resolveProspectSource()` here, and F43 caught it:
// *"the store is chosen in exactly one place … Only the canonical reader asks. Everyone else
// inherits the answer."* `importProspectSheet` asks; this route inherits, like every other consumer.

import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { parseCsv } from "@/lib/csv";
import { importProspectSheet } from "@/core/crm/prospect";
import type { SheetColumnMap } from "@/core/crm/sheet-import";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return authorize(req, "import:run", async (principal) => {
    try {
      const body = (await req.json()) as {
        csv?: string;
        column_map?: SheetColumnMap;
        dry_run?: boolean;
        overwrite?: boolean;
        label?: string;
        source_name?: string;
      };
      if (!body.csv) return NextResponse.json({ error: "csv required" }, { status: 400 });
      if (!body.column_map?.name) {
        return NextResponse.json({ error: "column_map.name is required" }, { status: 400 });
      }

      // Header validation uses the NORMALISING parser deliberately: it answers "did the operator map
      // a column that exists", which is a question about the MAPPING. The intake re-reads the same
      // bytes verbatim for the evidence, because that is a question about the RECORD (§1.3).
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

      // DRY RUN IS COMPLETELY NON-MUTATING, and now in a stronger sense than before. It returns
      // ahead of the intake, so no file is written, no prospect row is created — AND NO EVIDENCE IS
      // APPENDED. A preview that wrote to the append-only spine would change the thing it previewed,
      // and the spine offers no way to take it back.
      if (body.dry_run) {
        return NextResponse.json({
          ok: true, dry_run: true, total_rows: parsed.rows.length, headers: parsed.headers,
          results: parsed.rows.map((row) => ({
            slug: "", name: row[body.column_map!.name]?.trim() || "(blank)",
            written: false, reason: "dry run",
          })),
        });
      }

      const outcome = await importProspectSheet(parsed.rows, {
        csv: body.csv,
        columnMap: body.column_map,
        label: body.label,
        sourceName: body.source_name,
        overwrite: body.overwrite,
        organizationId: principal.organizationId,
        createdBy: principal.userId,
      });

      if (outcome.store === "postgres") {
        return NextResponse.json({
          ok: true, dry_run: false, store: "postgres",
          batch_id: outcome.result.batch.batch_id,
          file_sha256: outcome.result.batch.file_sha256,
          total_rows: parsed.rows.length, headers: parsed.headers,
          outcomes: outcome.result.outcomes,
        });
      }

      return NextResponse.json({
        ok: true, dry_run: false, store: "vault",
        total_rows: parsed.rows.length, headers: parsed.headers,
        results: outcome.created,
      });
    } catch (e) {
      return serverErrorResponse("import/prospects", e);
    }
  });
}
