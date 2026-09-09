// core/db/prospect-notes — the operator's note log, as rows (008).
//
// ─── THIS MODULE HAS NO `system` PATH, AND THAT IS THE POINT ───────────────────────────────────
//
// Every other writer in `core/db` takes an actor that may be `{ kind: "system" }`. This one takes a
// `UserId` and nothing else, so a research runner or an importer cannot append here even by
// mistake — there is no argument it could pass. 003 stated the rule for the vault body (*"Automation
// must never write here … prose in the operator's voice is not a finding"*) and 008 makes it a
// grant; this signature is the third barrier, at the layer where a caller would actually try.
//
// The database says the same thing twice more: `ascend_automation` holds no privilege on
// `prospect_notes`, and the sales INSERT policy requires `author_user_id = current_user_id()`, so a
// note cannot be posted under someone else's name even by a principal that may post.
//
// ─── NO UPDATE FUNCTION EXISTS ─────────────────────────────────────────────────────────────────
//
// Not an omission. 008 grants UPDATE to no APPLICATION role, so an edit function could only fail;
// and a log whose entries can be rewritten stops being a log. `deleteNote` exists for the owner,
// because removing a mistaken note is different from silently changing what it said.
//
// ─── THE APPEND-ONLY CLAIM, STATED PRECISELY ───────────────────────────────────────────────────
//
// 008's header says "no UPDATE grant exists on this table for anyone". Measured against the
// deployed database that is too strong, and the qualification belongs here rather than there
// because the migration has been applied and its checksum is recorded — editing the file now would
// make the ledger disagree with it, which is the divergence 004 exists to catch.
//
// What is actually true: on the Supabase project, `anon`, `authenticated` and `service_role` hold
// blanket privileges on every table in `public`, UPDATE included, from that project's DEFAULT
// PRIVILEGES rather than from any migration here. `prospects`, `events` and `invitations` all carry
// exactly the same set — verified, not assumed — so this table is no weaker than the ones already
// deployed and adds no new exposure.
//
// So the guarantee binds `ascend_owner`, `ascend_sales` and `ascend_automation` — every role this
// application ever connects as — and nothing beyond them. `events` needed more than a grant for the
// same reason and got `events_are_append_only`, a TRIGGER. If this log ever needs that strength,
// the fix is the same trigger, not a longer REVOKE list.

import "server-only";
import type { OrganizationId, UserId } from "@/domain";
import { uuidv7 } from "@/domain";
import type { SqlClient } from "./client";
import { appendEvent } from "./events";

export type ProspectNote = {
  readonly noteId: string;
  /** The annotated prospect ROW (`prospects.id`) — see 008's header on why not the anchor. */
  readonly prospect: string;
  readonly authorUserId: UserId;
  readonly authorName: string | null;
  readonly body: string;
  readonly createdAt: string;
};

type Raw = {
  note_id: string;
  prospect: string;
  author_user_id: string;
  author_name: string | null;
  body: string;
  created_at: Date | string;
};

const toNote = (r: Raw): ProspectNote => ({
  noteId: r.note_id,
  prospect: r.prospect,
  authorUserId: r.author_user_id as UserId,
  authorName: r.author_name,
  body: r.body,
  createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
});

/**
 * Resolve the URL segment the surface uses into the prospect ROW it names.
 *
 * ─── THE SURFACE ADDRESSES A PROSPECT TWO WAYS, AND THIS IS NOT A CHOICE IT MADE ──────────────
 *
 * `core/crm/prospect.ts` builds its identifier as `r.slug ?? r.id`, so a prospect WITH a slug is
 * addressed by it and one WITHOUT is addressed by its row id. That is not hypothetical: every one
 * of the 3,102 rows the 2026-09 lead-list import created has a NULL slug, because the intake
 * projection states only what the sheet said and a sheet does not state slugs. The six
 * vault-originated prospects have real ones.
 *
 * So a link that works in the UI carries either form, and this resolves either. Slug is tried
 * FIRST: a slug is the more specific claim, and trying the id first would let a row whose id
 * happened to be spelled like another row's slug shadow it.
 *
 * Returns null for anything that names no row — the caller turns that into a 404 rather than
 * creating a note attached to nothing.
 */
export async function findProspectRef(tx: SqlClient, ref: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM prospects WHERE slug = $1
      UNION ALL
     SELECT id FROM prospects WHERE slug IS NULL AND id::text = $1
      LIMIT 1`,
    [ref]
  );
  return rows[0]?.id ?? null;
}

/**
 * One prospect's notes, newest first.
 *
 * The author's NAME is joined here rather than resolved by the caller: a log that renders a raw
 * uuid where a person's name belongs is not a log anyone reads. `users` is readable within the
 * organization by `users_same_org`, so the join adds no privilege — and it stays a LEFT join
 * because a note must remain readable if its author's user record is ever removed.
 */
export async function listProspectNotes(
  tx: SqlClient,
  prospect: string
): Promise<readonly ProspectNote[]> {
  const { rows } = await tx.query<Raw>(
    `SELECT n.note_id, n.prospect, n.author_user_id, u.display_name AS author_name, n.body, n.created_at
       FROM prospect_notes n
       LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.prospect = $1
      ORDER BY n.created_at DESC, n.note_id DESC`,
    [prospect]
  );
  return rows.map(toNote);
}

/**
 * Append a note, and record that a person did.
 *
 * ONE TRANSACTION, for the reason `createProspect` gives one file over: the row and its provenance
 * commit together or neither does.
 *
 * `actor: "operator"` — deliberately, and it is the one place in the prospect pipeline where that
 * is the honest answer. §19 counts operator-caused events per weekday, and a human writing prose is
 * exactly what it means to count. The note's TEXT is not copied into the event: `prospect_notes` is
 * the record, and duplicating prose into an append-only spine would leave a full copy behind after
 * an owner deleted the note.
 */
export async function addProspectNote(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: { prospect: string; body: string; authorUserId: UserId }
): Promise<ProspectNote> {
  // Trimmed here as well as CHECKed in the schema. The constraint refuses a blank note; this stops
  // a note whose body merely happens to be padded from being STORED padded and rendering ragged.
  const body = input.body.trim();

  const { rows } = await tx.query<Raw>(
    `INSERT INTO prospect_notes (note_id, organization_id, prospect, author_user_id, body)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING note_id, prospect, author_user_id,
               (SELECT display_name FROM users WHERE id = $4) AS author_name,
               body, created_at`,
    [uuidv7(), organizationId, input.prospect, input.authorUserId, body]
  );
  const note = toNote(rows[0]);

  await appendEvent(tx, organizationId, {
    type: "prospect.note_added",
    subject: { entity: "prospect", entity_id: input.prospect },
    actor: "operator",
    actor_user_id: input.authorUserId,
    data: { note_id: note.noteId },
  });

  return note;
}

/**
 * Remove a note. OWNER-ONLY BY GRANT — `ascend_sales` holds no DELETE privilege, so a sales
 * principal calling this fails at the database rather than at a check this module could forget.
 */
export async function deleteProspectNote(tx: SqlClient, noteId: string): Promise<boolean> {
  const { affected } = await tx.query(`DELETE FROM prospect_notes WHERE note_id = $1`, [noteId]);
  return affected > 0;
}
