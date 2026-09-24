"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { losAngelesWallClock } from "@/domain";
import type { ActionSummary, FollowUpAction } from "@/core/crm/sales";
import { ACTION_LABEL, ACTION_ORDER, formatDue, personName } from "./presentation";
import { NOTE_MAX, resolvePt } from "./record-draft";
import { useSalesCommand } from "./useSalesCommand";

type FollowUp = NonNullable<ActionSummary["openFollowUp"]>;
type Draft = { action: FollowUpAction; assignee: string; date: string; time: string; offset: string | null; note: string };

export function FollowUpEditor({ slug, rowId, followUp, names, fetchImpl, mintId }: {
  slug: string;
  rowId: string;
  followUp: FollowUp;
  names: Record<string, string>;
  fetchImpl?: typeof fetch;
  mintId?: () => string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const originalTime = followUp.dueAt ? losAngelesWallClock(new Date(followUp.dueAt)).slice(11) : "";
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(followUp.action as FollowUpAction);
  const [assignee, setAssignee] = useState(followUp.assignee);
  const [date, setDate] = useState(followUp.dueOn);
  const [time, setTime] = useState(originalTime);
  const [offset, setOffset] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [reconfirm, setReconfirm] = useState(false);
  const command = useSalesCommand<Draft>({
    prospectRowId: `${rowId}:followup:${followUp.followupId}`,
    url: `/api/prospects/${encodeURIComponent(slug)}/followups/${encodeURIComponent(followUp.followupId)}`,
    method: "PATCH", fetchImpl, mintId,
  });
  const sending = command.state.phase === "sending";
  const uncertain = command.state.phase === "uncertain";
  const locked = sending || uncertain;
  const dueChanged = date !== followUp.dueOn || time !== originalTime;
  const resolved = dueChanged ? resolvePt(date, time, offset) : null;
  const dueValid = !dueChanged || resolved?.kind === "day" || resolved?.kind === "instant";
  const hasChanges = action !== followUp.action || assignee !== followUp.assignee || dueChanged || note.trim() !== "";
  const canSave = hasChanges && dueValid && !reconfirm;
  const members = Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { if (el.showModal) el.showModal(); else el.setAttribute("open", ""); }
    if (!open && el.open) { if (el.close) el.close(); else el.removeAttribute("open"); }
  }, [open]);
  const close = () => {
    if (locked) return;
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async () => {
    if (!canSave || sending) return;
    const changes: Record<string, unknown> = {};
    if (action !== followUp.action) changes.action = action;
    if (assignee !== followUp.assignee) changes.assignee = assignee;
    if (dueChanged && resolved) {
      changes.dueOn = date;
      changes.dueAt = resolved.kind === "instant" ? { local: resolved.local, offset: resolved.offset } : null;
    }
    if (note.trim()) changes.note = note.trim();
    const body = { expected: { action: followUp.action, assignee: followUp.assignee, dueOn: followUp.dueOn, dueAt: followUp.dueAt }, changes };
    const result = await command.send(body, { action, assignee, date, time, offset, note });
    if (result.phase === "saved") {
      setOpen(false); setMessage(""); router.refresh();
      requestAnimationFrame(() => trigger.current?.focus());
    } else if (result.phase === "refused") {
      const code = result.refusal.code;
      if (code === "followup_conflict") {
        setReconfirm(true); router.refresh();
        setMessage("This follow-up changed while you were editing. Your edits are kept; review the current values, then confirm again.");
      } else {
        setMessage(code === "followup_not_open" || code === "followup_not_found" ? "This follow-up is no longer open. Refresh to see the current state."
          : code === "assignee_not_member" ? "That person cannot receive follow-ups. Choose another member."
          : code.startsWith("invalid_due") || code === "nonexistent_local_time" || code === "offset_required" || code === "offset_not_los_angeles"
            ? "That Pacific due date or time is invalid. Choose another one."
            : `The edit was refused (${code.replaceAll("_", " ")}). Your changes are kept.`);
        if (code === "followup_not_open" || code === "followup_not_found" || code === "held_prospect" || code === "archived_prospect") router.refresh();
      }
    } else if (result.phase === "uncertain") setMessage("The result is unknown. Retry the same request; your edits are kept.");
  };

  return (
    <>
      <button ref={trigger} type="button" onClick={() => { setAction(followUp.action as FollowUpAction); setAssignee(followUp.assignee); setDate(followUp.dueOn); setTime(originalTime); setOffset(null); setNote(""); setMessage(""); setReconfirm(false); command.reset(); setOpen(true); }}
        className="t-label inline-flex min-h-11 items-center self-start rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t1)]"
        aria-haspopup="dialog">Edit follow-up</button>
      <dialog ref={dialog} aria-labelledby="followup-edit-title" className="sales-sheet" onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="sales-sheet-panel">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <h2 id="followup-edit-title" className="t-h2 text-[var(--color-t1)]">Edit open follow-up</h2>
            <button type="button" onClick={close} disabled={locked} className="min-h-11 min-w-11 text-[var(--color-t1)]" aria-label="Close follow-up edit">✕</button>
          </header>
          <div className="sales-sheet-body flex flex-col gap-4 px-4 py-4">
            <p className="t-meta text-[var(--color-t2)]">Current: {ACTION_LABEL[followUp.action as FollowUpAction]} · {formatDue(followUp.dueOn, followUp.dueAt)} · {personName(followUp.assignee, names)}</p>
            <label className="flex flex-col gap-1.5"><span className="t-label">Action</span>
              <select value={action} onChange={(e) => setAction(e.target.value as FollowUpAction)} disabled={locked} className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base">
                {ACTION_ORDER.map((value) => <option key={value} value={value}>{ACTION_LABEL[value]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5"><span className="t-label">Assignee</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={locked} className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base">
                {members.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5"><span className="t-label">Due date · PT</span>
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setOffset(null); }} disabled={locked} className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base" />
              </label>
              <label className="flex flex-col gap-1.5"><span className="t-label">Time · PT (optional)</span>
                <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setOffset(null); }} disabled={locked} className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base" />
              </label>
            </div>
            {resolved && (resolved.kind === "gap" || resolved.kind === "invalid" || resolved.kind === "empty") && <p role="alert" className="t-meta text-[var(--color-risk)]">{resolved.kind === "empty" ? "Choose a due date." : resolved.message}</p>}
            {resolved?.kind === "ambiguous" && (
              <fieldset className="flex flex-col gap-2 border-0 p-0"><legend className="t-label">{resolved.message}</legend>
                {resolved.options.map((option) => <label key={option.offset} className="flex min-h-11 items-center gap-2"><input type="radio" name="followup-offset" checked={offset === option.offset} onChange={() => setOffset(option.offset)} />{option.label}</label>)}
              </fieldset>
            )}
            <label className="flex flex-col gap-1.5"><span className="t-label">New note (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} disabled={locked} className="min-h-24 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-base" />
            </label>
            {reconfirm && <button type="button" className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-left" onClick={() => { setReconfirm(false); setMessage(""); }}>I reviewed the current follow-up</button>}
            {message && <p role="status" className="t-meta text-[var(--color-risk)]">{message}</p>}
          </div>
          <footer className="sales-sheet-foot flex justify-end gap-2 border-t border-[var(--color-line)] px-4 py-3">
            <button type="button" onClick={close} disabled={locked} className="min-h-11 px-3">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!canSave || sending}
              className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 text-[var(--color-surface)] disabled:opacity-50">
              {uncertain ? "Retry" : sending ? "Saving…" : "Save follow-up"}
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
