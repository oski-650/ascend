// core/crm/notes — READING AND APPENDING A PROSPECT'S NOTE LOG.
//
// ─── WHY THIS SITS BESIDE `core/crm/prospect` RATHER THAN INSIDE IT ────────────────────────────
//
// `prospect.ts` is the canonical prospect reader and the single place that asks which STORE owns
// prospects (F43). Notes have no such question: `prospect_notes` is a Postgres table introduced by
// 008 and there is no vault equivalent to choose between. Folding them into the canonical reader
// would put a store-independent concern behind a store-selection seam and invite the next reader to
// think there is a vault path to maintain. There is not.
//
// It still goes THROUGH `withProspectDb`, because that is where authority and the connection come
// from — a render leases one, a route reuses the one its request holds, and neither may invent a
// principal. What this module adds on top is the second capability check.
//
// ─── TWO CAPABILITIES, NOT ONE ─────────────────────────────────────────────────────────────────
//
//   reading a log    `prospects:read`   — `withProspectDb` already demands it
//   appending a note `prospects:write`  — demanded HERE, additionally
//
// `core/auth/routes.ts` records §8's definition of `prospects:write` as *"notes, contacts, status,
// follow-ups"*, so notes are not a new boundary being invented — they are the first entry in that
// list finally acquiring a writer.
//
// ─── THE AUTHOR IS THE CALLER. IT IS NOT AN ARGUMENT. ──────────────────────────────────────────
//
// `addNote` takes no author. It uses the principal `requireCapability` resolved, so a caller cannot
// post a note as somebody else by passing a different id — the same reasoning `assessWebsiteOpportunity`
// relies on for a judgment's author, and the same thing 008's sales INSERT policy enforces one
// layer down with `author_user_id = current_user_id()`.

import "server-only";
import { requireCapability } from "@/core/auth/authority";
import {
  writeProspectNote, deleteProspectNote, findProspectRef, listProspectNotes, type ProspectNote, type NoteWrite,
} from "@/core/db";
import { withProspectDb } from "./source";

export type { ProspectNote, NoteWrite };
export { NoteIdConflict } from "@/core/db";

/** No prospect answers to that slug or id. The caller turns this into a 404. */
export class ProspectNotFound extends Error {}

/**
 * One prospect's notes, newest first, for a caller holding `prospects:read`.
 *
 * `ref` is what the URL carries — a slug or a row id, see `findProspectRef`. An unknown ref returns
 * an EMPTY LIST rather than throwing: a prospect page that renders for a reader should not fail
 * because it has no notes yet, and "no such prospect" is a question the page itself already answered
 * before it got here.
 */
export async function listNotes(ref: string): Promise<readonly ProspectNote[]> {
  return withProspectDb(async (tx) => {
    const prospect = await findProspectRef(tx, ref);
    return prospect === null ? [] : listProspectNotes(tx, prospect);
  });
}

/**
 * Append a note as the calling operator.
 *
 * The capability is demanded BEFORE the connection is leased, so a denied caller never opens one.
 * An unknown `ref` THROWS here, unlike the reader — writing a note that names no prospect is a
 * request that cannot be satisfied, and silently discarding it would tell the operator their note
 * was saved.
 */
export async function addNote(ref: string, body: string, noteId: string): Promise<NoteWrite> {
  const principal = await requireCapability("prospects:write");
  return withProspectDb(async (tx) => {
    const prospect = await findProspectRef(tx, ref);
    if (prospect === null) throw new ProspectNotFound(ref);
    // IDEMPOTENT (2A.0-C): the caller's `noteId` is the key, so a retry after a lost response
    // converges on the note it already wrote instead of writing it twice. The author is still the
    // resolved principal — never anything the request says.
    return writeProspectNote(tx, principal.organizationId, {
      noteId,
      prospect,
      body,
      authorUserId: principal.userId,
    });
  });
}

/**
 * Remove a note.
 *
 * Guarded by `prospects:write` here and by the DELETE grant below — `ascend_sales` holds none, so a
 * sales principal passing this check still fails at the database. That is deliberate layering, not
 * redundancy: the capability says who may manage notes, the grant says who may destroy one.
 */
export async function removeNote(noteId: string): Promise<boolean> {
  await requireCapability("prospects:write");
  return withProspectDb((tx) => deleteProspectNote(tx, noteId));
}
