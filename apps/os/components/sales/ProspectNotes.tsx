// components/sales/ProspectNotes — the note composer and log, as a client component.
//
// It decides nothing. The page reads the log server-side through `listNotes` (guarded by
// `prospects:read` inside `withProspectDb`) and hands it down; this posts to a route that
// authorizes `prospects:write` independently. No capability check lives here, and no prospect data
// is fetched from the client.
//
// ─── THE AUTHOR IS NEVER SENT ──────────────────────────────────────────────────────────────────
//
// The body carries the note text and nothing else. Who wrote it is decided by the resolved
// principal on the server and enforced again by 008's INSERT policy. There is deliberately no
// author field in this form for a caller to tamper with.
//
// ─── AFTER POSTING, THE SERVER RE-READS ────────────────────────────────────────────────────────
//
// `router.refresh()` re-runs the page's own guarded read rather than this component appending the
// new note to local state. Slightly slower, and correct: the list on screen is then the list the
// database holds, not this component's optimistic guess about it.

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

export type NoteView = {
  noteId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
};

/** Absolute, and in the reader's own timezone — a note log is read by date, not by "3h ago". */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function ProspectNotes({ prospect, notes }: { prospect: string; notes: readonly NoteView[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 2A.0-C · ONE ID PER NOTE, reused on every retry of that note. `busy` below is a courtesy — it
  // cannot help once a response is LOST, because by then the request has ended. The id is what makes
  // the retry the same request: the server converges on the note it already wrote. It is kept until
  // the server confirms the note, and replaced only if the text changes — the same id for different
  // text is a different note, which the server rightly refuses.
  const pending = useRef<{ id: string; text: string } | null>(null);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const text = body.trim();
    if (!pending.current || pending.current.text !== text) pending.current = { id: crypto.randomUUID(), text };
    try {
      const res = await fetch(`/api/prospects/${encodeURIComponent(prospect)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, noteId: pending.current.id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Could not save the note");
        return;
      }
      pending.current = null;
      setBody("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          // ⌘/Ctrl+Enter submits. A plain Enter must insert a newline: these are call notes, and a
          // form that posts half a sentence the moment someone breaks a line is unusable for them.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="What happened? Who did you speak to, what did they say, what's next…"
          rows={3}
          className="t-body w-full max-w-[68ch] rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-bg)] p-3 text-[var(--color-t1)] outline-none transition-colors placeholder:text-[var(--color-t3)] focus:border-[var(--color-accent)]/60"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" onClick={() => void submit()}
                  disabled={busy || !body.trim()}>
            {busy ? "Saving…" : "Add note"}
          </Button>
          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">⌘↵ to save</span>
          {err && <span className="font-mono text-[11px] text-[var(--color-danger)]">{err}</span>}
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="flex max-w-[68ch] flex-col gap-3">
          {notes.map((n) => (
            <li
              key={n.noteId}
              className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-3"
            >
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                {n.authorName ?? "unknown author"} · {when(n.createdAt)}
              </p>
              {/* Plain text, deliberately. `prospects.notes` is rendered as markdown because it came
                  from a markdown file; a note typed into this box is prose, and running it through a
                  renderer would turn an operator's asterisks into formatting they did not ask for. */}
              <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
