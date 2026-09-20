// core/crm/archive.ts — removing a prospect from the hit list, against the store that owns it (D1b).
//
// ─── WHY THIS IS AN ARCHIVE AND NOT A DELETE ───────────────────────────────────────────────────
//
// `prospect_notes.prospect` carries `ON DELETE CASCADE` (008_prospect_notes_log.sql). So
// `DELETE FROM prospects` does not merely remove a row from a list — it destroys every note a human
// wrote about that business, silently, as a side effect. D1a saw this coming and refused Postgres
// deletion outright with a 409 naming this dependency, rather than taking the short path that also
// destroys sales history.
//
// Archival is the operation that was actually wanted. An UPDATE cannot cascade, so the row, its
// identity anchor, its notes column, its `prospect_notes` log, its events and the client's
// `promoted_from_prospect_id` back-reference all survive. What changes is one column pair, and what
// that column pair changes is which READERS see the row (core/db/prospects.ts).
//
// ─── THE STORE IS CHOSEN HERE, ONCE (F43) ──────────────────────────────────────────────────────
//
// Postgres mode archives and never touches the vault. Vault mode delegates to the existing unlink,
// which emits `prospect.deleted` — a genuinely different fact, with its own event type. The route
// inherits the answer and does not branch on the store itself.

import "server-only";
import { uuidv7 } from "@/domain";
import {
  archiveProspect as archiveRow, resolveProspectForMutation, type ArchiveOutcome,
} from "@/core/db";
import { deleteVaultProspect } from "./prospect";
import { resolveProspectSource, withProspectDb, type ProspectSource } from "./source";

export type ArchivalRefusalCode =
  | "prospect_not_found"
  | "ambiguous_prospect"
  /** Held rows are not archivable by a sales principal — owner decision 2, and P3 carried forward. */
  | "held_prospect"
  | "archival_refused";

/**
 * WHAT ACTUALLY HAPPENED, PER EFFECT — never a boolean.
 *
 * `changed` is present on EVERY outcome, including the refusals, and that is deliberate: D1a's
 * pre-flight found a deletion that reported success while the row and its notes survived, and the
 * repair is that a mutation states what it touched even when the answer is "nothing".
 */
export type ArchivalOutcome = {
  /**
   * `archived`          the row left the active set in this call
   * `already_archived`  it had already left — a safe, idempotent repeat
   * `deleted`           vault mode: the file was unlinked and `prospect.deleted` emitted
   * `not_found`         nothing answers to this reference
   * `refused`           nothing was written anywhere; `refusal` says why
   */
  outcome: "archived" | "already_archived" | "deleted" | "not_found" | "refused";
  store: ProspectSource;
  prospect: { state: ArchivalOutcome["outcome"]; archivedAt?: string | null; reason?: string };
  changed: {
    prospect: "archived" | "deleted" | "none";
    /** Never anything but "none" in Postgres mode. Archival cannot cascade; that is its purpose. */
    notes: "none";
    events: "appended" | "none";
    vault: "deleted" | "none";
  };
  operation: { prospectId: string | null; correlationId: string; store: ProspectSource };
  refusal?: { code: ArchivalRefusalCode; message: string };
};

const untouched = { prospect: "none", notes: "none", events: "none", vault: "none" } as const;

const refused = (
  code: ArchivalRefusalCode, message: string, correlationId: string,
  store: ProspectSource, prospectId: string | null = null
): ArchivalOutcome => ({
  outcome: code === "prospect_not_found" ? "not_found" : "refused",
  store,
  prospect: { state: code === "prospect_not_found" ? "not_found" : "refused", reason: message },
  changed: untouched,
  operation: { prospectId, correlationId, store },
  refusal: { code, message },
});

/**
 * Archive a Postgres-owned prospect: the row update and `prospect.archived` in ONE transaction.
 *
 * No advisory lock, and that is not an oversight. Promotion needs one because its critical section
 * LEAVES the database to write the client's files, so two racing promotions can both create one.
 * Archival never leaves the database: the compare-and-set on `archived_at IS NULL` is evaluated by
 * the same row lock both writers contend for, so the second writer re-checks the updated row
 * (EvalPlanQual), matches nothing, and converges on `already_archived` with no extra mechanism.
 */
async function archiveInPostgres(reference: string, reason: string | undefined, correlationId: string): Promise<ArchivalOutcome> {
  const store: ProspectSource = "postgres";

  return withProspectDb(async (tx, principal) => {
    const resolution = await resolveProspectForMutation(tx, reference);
    if (!resolution.ok) {
      if (resolution.reason === "not_found") {
        return refused("prospect_not_found", `no prospect answers to "${reference}"`, correlationId, store);
      }
      if (resolution.reason === "ambiguous") {
        return refused("ambiguous_prospect",
          `"${reference}" names ${resolution.matches} prospects; archival needs exactly one. ` +
          "Nothing was changed.", correlationId, store);
      }
      // HELD, AND SAID SO. Never collapsed into `already_archived` or `not_found`: telling an
      // operator their held prospect is gone when it is still on the list is the precise untruth
      // D1a removed from the delete path.
      return refused("held_prospect",
        `"${reference}" is a HELD prospect — a record whose identity could not be resolved. Held ` +
        "prospects are protected from the ordinary sales workflow and are not archivable here. " +
        "Nothing was changed.", correlationId, store);
    }

    const target = resolution.target;
    const result: ArchiveOutcome = await archiveRow(tx, principal.organizationId, {
      target, actorUserId: principal.userId, correlationId, ...(reason ? { reason } : {}),
    });

    if (result.state === "refused") {
      return refused("archival_refused", result.reason, correlationId, store, target.prospectId);
    }
    if (result.state === "already_archived") {
      return {
        outcome: "already_archived",
        store,
        prospect: { state: "already_archived", archivedAt: result.archivedAt },
        changed: untouched,
        operation: { prospectId: target.prospectId, correlationId, store },
      };
    }
    return {
      outcome: "archived",
      store,
      prospect: { state: "archived", archivedAt: result.archivedAt },
      changed: { prospect: "archived", notes: "none", events: "appended", vault: "none" },
      operation: { prospectId: target.prospectId, correlationId, store },
    };
  }, "prospects:identity");
}

/** Remove a prospect from the hit list, against whichever store owns prospects. */
export async function archiveProspectRecord(
  reference: string, opts: { reason?: string } = {}
): Promise<ArchivalOutcome> {
  const correlationId = uuidv7();
  if (resolveProspectSource() === "postgres") {
    return archiveInPostgres(reference, opts.reason, correlationId);
  }

  const store: ProspectSource = "vault";
  const result = await deleteVaultProspect(reference);
  if (result.outcome === "not_found") {
    return {
      outcome: "not_found",
      store,
      prospect: { state: "not_found", reason: `no prospect file answers to "${reference}"` },
      changed: untouched,
      operation: { prospectId: null, correlationId, store },
    };
  }
  return {
    outcome: "deleted",
    store,
    prospect: { state: "deleted" },
    changed: { prospect: "deleted", notes: "none", events: "appended", vault: "deleted" },
    operation: { prospectId: null, correlationId, store },
  };
}
