import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { deleteVaultProspect } from "@/core/crm";
import { VaultProspectWriteRefused } from "@/core/crm/source";

export const dynamic = "force-dynamic";

/**
 * Delete a prospect — from the store that owns prospects, or not at all (D1a).
 *
 * ─── WHAT THIS USED TO DO ──────────────────────────────────────────────────────────────────────
 *
 * It unlinked a vault hit-list file and answered `{ ok: true }`, whatever the configured store was.
 * With Postgres selected — the deployed configuration — that meant: for the 3,102 prospects with no
 * vault file, a 404 for a prospect plainly visible on screen; and for the six with one, the 2E
 * rollback copy was destroyed, the authoritative row and its notes survived untouched, the prospect
 * stayed on `/sales`, and the operator was told it was deleted. Both measured (pre-flight P4, P5).
 *
 * ─── WHAT IT DOES NOW ──────────────────────────────────────────────────────────────────────────
 *
 * In Postgres mode it REFUSES, with a 409 that says why. That is a deliberate, temporary capability
 * gap: the correct Postgres operation is ARCHIVE (keep the notes, keep the identity, keep the event
 * evidence), and archival needs migration 009, which is D1b. A hard `DELETE FROM prospects` would
 * cascade-delete every `prospect_notes` row for that prospect (`008_prospect_notes_log.sql`), so the
 * shortest path to "deletion works again" is also the one that destroys sales history. It is not
 * taken, and the refusal never falls back to touching the vault.
 *
 * In vault mode it delegates to `core/crm.deleteVaultProspect`, which unlinks the file AND emits
 * `prospect.deleted`. F21 exempted this route from the emit-with-the-write rule because the domain
 * had no such type, with the standing instruction to retire the exemption once it did. D1a adds the
 * type, the write moves into core where every other durable write lives, and the exemption is gone.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:identity", async () => {
    try {
      const { slug } = await params;
      if (!slug || slug.startsWith(".") || slug.includes("/") || slug.includes("\\")) {
        return NextResponse.json({ error: "invalid slug" }, { status: 400 });
      }

      let result: { outcome: "deleted" | "not_found" };
      try {
        result = await deleteVaultProspect(slug);
      } catch (e) {
        if (!(e instanceof VaultProspectWriteRefused)) throw e;
        return NextResponse.json({
          outcome: "unsupported",
          store: "postgres",
          error:
            "Deleting a Postgres-owned prospect is not available yet. The supported operation is " +
            "ARCHIVE — which keeps this prospect's notes, history and identity — and it arrives with " +
            "Dependency D1b. Nothing was changed, and the vault mirror was not touched.",
          changed: { prospect: "none", notes: "none", vault: "none" },
        }, { status: 409 });
      }

      if (result.outcome === "not_found") {
        return NextResponse.json({ outcome: "not_found", error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ outcome: "deleted", store: "vault", ok: true, deleted: slug });
    } catch (e) {
      return serverErrorResponse("prospects/[slug]", e);
    }
  });
}
