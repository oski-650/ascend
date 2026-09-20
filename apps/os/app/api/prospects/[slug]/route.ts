import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { archiveProspectRecord } from "@/core/crm";

export const dynamic = "force-dynamic";

/**
 * Remove a prospect from the hit list — by ARCHIVING it, in the store that owns prospects (D1b).
 *
 * ─── WHAT THIS USED TO DO ──────────────────────────────────────────────────────────────────────
 *
 * Before D1a it unlinked a vault hit-list file and answered `{ ok: true }`, whatever the configured
 * store was. With Postgres selected — the deployed configuration — that meant a 404 for a prospect
 * plainly visible on screen, or the destruction of the 2E rollback copy while the authoritative row
 * and its notes survived and the operator was told it was deleted (pre-flight P4, P5).
 *
 * D1a replaced that with an honest 409: archival needed migration 009, and a hard
 * `DELETE FROM prospects` would cascade-delete every `prospect_notes` row for that prospect, so the
 * shortest path to "deletion works again" was also the one that destroys sales history.
 *
 * ─── WHAT IT DOES NOW ──────────────────────────────────────────────────────────────────────────
 *
 * In Postgres mode it ARCHIVES: one transaction sets `archived_at`/`archived_by` and appends
 * `prospect.archived`. The prospect leaves the active readers; its identity, notes, log and events
 * all stay. A repeat is idempotent — 200 `already_archived` — because the compare-and-set keys on
 * the state itself. In vault mode it still unlinks and emits `prospect.deleted`, a different fact.
 *
 * THE VERB STAYS `DELETE`, and the body says what really happened. The resource leaves the
 * collection; archival is how. A separate `POST /archive` would need its own capability mapping and
 * would leave `DELETE` as a route that only ever refuses.
 *
 * ─── STATUS CODES ──────────────────────────────────────────────────────────────────────────────
 *
 *   200 archived | already_archived | deleted   404 not_found   409 ambiguous | held | refused
 *
 * `already_archived` is 200, not 409: an idempotent success is a success, and answering 409 would
 * make the retry path — the one an operator hits after a dropped connection — look like a failure.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:identity", async () => {
    try {
      const { slug } = await params;
      if (!slug || slug.startsWith(".") || slug.includes("/") || slug.includes("\\")) {
        return NextResponse.json({ error: "invalid slug" }, { status: 400 });
      }

      const result = await archiveProspectRecord(slug);

      if (result.outcome === "not_found") {
        return NextResponse.json({ ...result, error: result.prospect.reason ?? "not found" }, { status: 404 });
      }
      if (result.outcome === "refused") {
        // 409, and the message is the database's or the resolver's own — never a generic failure.
        return NextResponse.json({ ...result, error: result.refusal?.message }, { status: 409 });
      }
      // `ok` is kept for the vault arm's existing consumers. It is only ever true here, because
      // every non-success path returned above.
      return NextResponse.json({ ...result, ok: true });
    } catch (e) {
      return serverErrorResponse("prospects/[slug]", e);
    }
  });
}
