// app/api/prospects/[slug]/notes — append to a prospect's note log, and read it back.
//
// ─── THIS HANDLER DECIDES NOTHING ABOUT WHAT A NOTE IS ─────────────────────────────────────────
//
// It validates its input, authorizes, calls ONE function per verb, and reports. Who may write
// (`prospects:write`), who the author is (the resolved principal, never an argument), what a blank
// note means, and how a slug resolves to a row all live in `core/crm/notes` and `core/db` — the same
// division `app/api/import/prospects` follows and for the same reason: a route holding a second
// copy of a domain rule is how the two drift apart.
//
// ─── THE AUTHOR IS NOT ACCEPTED FROM THE BODY, EVER ────────────────────────────────────────────
//
// There is no `author` field parsed here and no way to supply one. `addNote` takes the principal
// `requireCapability` resolved, and 008's sales INSERT policy independently requires
// `author_user_id = current_user_id()`. A request that tried to attribute a note to a colleague
// would have nowhere to put the claim, and would be refused by the database if it did.

// ─── POST ONLY, AND THAT IS AN ARCHITECTURAL CONSTRAINT RATHER THAN AN OMISSION ────────────────
//
// A GET returning the log was written and removed. F46's second rule requires the capability a
// route CHECKS to be the single one the map ASSIGNS, and reading a note log is `prospects:read`
// while appending to it is `prospects:write` — two capabilities in one file, which that rule
// refuses. Collapsing them would have meant either a read that demands write (a boundary loosened
// for a reader) or a write that demands only read (a boundary lost for a writer).
//
// So the log is READ where every other page reads its data: server-side, through `listNotes` inside
// the page's own guarded render. The surface posts here and calls `router.refresh()`, which re-runs
// that read. One capability per file, and no client-side fetch of prospect data at all.

import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { addNote, NoteIdConflict, ProspectNotFound } from "@/core/crm/notes";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

/** Notes are prose typed into a textarea; this bounds it well above any real note. */
const MAX_NOTE = 10_000;
/** Any RFC 4122 UUID. The client uses `crypto.randomUUID()`; the server does not care which version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:write", async () => {
    try {
      const { slug } = await params;
      const body = (await req.json()) as { body?: unknown; noteId?: unknown };

      // 2A.0-C · THE CLIENT'S ID IS REQUIRED. It is what makes a retry after a lost response converge
      // on the note already written instead of writing it twice. A request without one is refused
      // rather than given a server id, because a server id is exactly the non-idempotent path this
      // replaces — and an optional key is a key some future caller forgets.
      if (typeof body.noteId !== "string" || !UUID.test(body.noteId)) {
        return NextResponse.json(
          { error: "noteId is required: a client-generated UUID, reused unchanged on every retry of this note" },
          { status: 400 });
      }

      // A blank note is refused HERE as well as by 008's CHECK. The constraint is the guarantee;
      // this is so the operator gets "write something first" instead of a 500 from the database.
      if (typeof body.body !== "string" || body.body.trim() === "") {
        return NextResponse.json({ error: "a note needs some text" }, { status: 400 });
      }
      if (body.body.length > MAX_NOTE) {
        return NextResponse.json(
          { error: `a note may be at most ${MAX_NOTE} characters` },
          { status: 400 }
        );
      }

      const { note, replayed } = await addNote(slug, body.body, body.noteId.toLowerCase());
      // 201 when this request wrote the note; 200 when it was already written under this id — the
      // retry of a request whose response was lost. Both return the SAME note.
      return NextResponse.json({ ok: true, note, replayed }, { status: replayed ? 200 : 201 });
    } catch (e) {
      if (e instanceof NoteIdConflict) {
        // Says only that the id is taken. Never what it holds.
        return NextResponse.json(
          { error: "this note id is already used for a different note; nothing was written" }, { status: 409 });
      }
      if (e instanceof ProspectNotFound) {
        return NextResponse.json({ error: "no such prospect" }, { status: 404 });
      }
      return serverErrorResponse("prospects/[slug]/notes", e);
    }
  });
}
