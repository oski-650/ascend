"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionSummary } from "@/core/crm/sales";
import { personName } from "./presentation";
import { useSalesCommand } from "./useSalesCommand";

type Choice = "leave" | "transfer" | "cancel" | "";
type Draft = { to: string; choice: Choice };
type OpenFollowUp = NonNullable<ActionSummary["openFollowUp"]>;

export function AssignmentMenu({ slug, rowId, assignedTo, names, openFollowUp, fetchImpl, mintId }: {
  slug: string;
  rowId: string;
  assignedTo: string | null;
  names: Record<string, string>;
  openFollowUp: OpenFollowUp | null;
  fetchImpl?: typeof fetch;
  mintId?: () => string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(assignedTo ?? "");
  const [choice, setChoice] = useState<Choice>("");
  const [reconfirm, setReconfirm] = useState(false);
  const [message, setMessage] = useState("");
  const command = useSalesCommand<Draft>({
    prospectRowId: `${rowId}:assignment`, url: `/api/prospects/${encodeURIComponent(slug)}/assignment`,
    fetchImpl, mintId,
  });
  const busy = command.state.phase === "sending" || command.state.phase === "uncertain";
  const members = Object.entries(names).sort((a, b) => a[1].localeCompare(b[1]));
  const current = assignedTo === null ? "Unassigned" : personName(assignedTo, names);
  const changed = to !== (assignedTo ?? "");
  const canSave = changed && (!openFollowUp || choice !== "") && !(to === "" && choice === "transfer") && !reconfirm;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { if (el.showModal) el.showModal(); else el.setAttribute("open", ""); }
    if (!open && el.open) { if (el.close) el.close(); else el.removeAttribute("open"); }
  }, [open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async () => {
    if (!canSave || command.state.phase === "sending") return;
    const body = {
      mode: to ? "reassign" : "unassign", expectedAssignee: assignedTo,
      ...(to ? { to } : {}), ...(openFollowUp ? { openFollowUp: choice } : {}),
    };
    const result = await command.send(body, { to, choice });
    if (result.phase === "saved") {
      setMessage(""); setOpen(false); router.refresh();
      requestAnimationFrame(() => trigger.current?.focus());
    } else if (result.phase === "refused") {
      const code = result.refusal.code;
      if (code === "assignment_conflict" || code === "followup_choice_required") {
        setReconfirm(true); router.refresh();
        setMessage(code === "assignment_conflict"
          ? "The assignment changed since you opened this. Review the current assignee, then confirm again."
          : "An open follow-up now needs an explicit choice. Review the updated prospect, then confirm again.");
      } else {
        setMessage(code === "assignee_not_member" ? "That person cannot receive assignments. Choose another member."
          : code === "assignment_unchanged" ? "This assignment is already current."
          : code === "held_prospect" || code === "archived_prospect" ? "This prospect cannot be changed."
          : `Assignment was refused (${code.replaceAll("_", " ")}). Your choice is kept.`);
        if (code === "held_prospect" || code === "archived_prospect") router.refresh();
      }
    } else if (result.phase === "uncertain") setMessage("The result is unknown. Retry the same request; your choice is kept.");
  };

  return (
    <>
      <button ref={trigger} type="button" onClick={() => { setTo(assignedTo ?? ""); setChoice(""); setMessage(""); setReconfirm(false); command.reset(); setOpen(true); }}
        className="t-label inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t1)]"
        aria-haspopup="dialog">Reassign / unassign</button>
      <dialog ref={dialog} aria-labelledby="assignment-title" className="sales-sheet" onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="sales-sheet-panel">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <h2 id="assignment-title" className="t-h2 text-[var(--color-t1)]">Manage assignment</h2>
            <button type="button" onClick={close} disabled={busy} className="min-h-11 min-w-11 text-[var(--color-t1)]" aria-label="Close assignment">✕</button>
          </header>
          <div className="sales-sheet-body flex flex-col gap-4 px-4 py-4">
            <p className="t-meta text-[var(--color-t2)]">Currently: {current}</p>
            <label className="flex flex-col gap-1.5 text-[var(--color-t1)]">
              <span className="t-label">Assign to</span>
              <select value={to} onChange={(e) => { setTo(e.target.value); if (!e.target.value && choice === "transfer") setChoice(""); setMessage(""); }} disabled={busy}
                className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base">
                <option value="">Unassigned</option>
                {members.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            {openFollowUp && (
              <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={busy}>
                <legend className="t-label mb-2 text-[var(--color-t1)]">What happens to the open follow-up? Choose one.</legend>
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="assignment-followup" checked={choice === "leave"} onChange={() => setChoice("leave")} />Leave it with {personName(openFollowUp.assignee, names)}</label>
                {to && <label className="flex min-h-11 items-center gap-2"><input type="radio" name="assignment-followup" checked={choice === "transfer"} onChange={() => setChoice("transfer")} />Transfer it to {personName(to, names)}</label>}
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="assignment-followup" checked={choice === "cancel"} onChange={() => setChoice("cancel")} />Cancel the follow-up</label>
              </fieldset>
            )}
            {reconfirm && <button type="button" className="min-h-11 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-left" onClick={() => { setReconfirm(false); setMessage(""); }}>I reviewed the current assignment</button>}
            {message && <p role="status" className="t-meta text-[var(--color-risk)]">{message}</p>}
          </div>
          <footer className="sales-sheet-foot flex justify-end gap-2 border-t border-[var(--color-line)] px-4 py-3">
            <button type="button" onClick={close} disabled={busy} className="min-h-11 px-3">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!canSave || command.state.phase === "sending"}
              className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 text-[var(--color-surface)] disabled:opacity-50">
              {command.state.phase === "uncertain" ? "Retry" : command.state.phase === "sending" ? "Saving…" : "Save assignment"}
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
