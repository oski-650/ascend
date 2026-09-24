"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StageTarget } from "@/core/crm/sales";
import { STAGE_LABEL } from "./presentation";
import { useSalesCommand } from "./useSalesCommand";

type ReopenStage = Extract<StageTarget, "lead" | "contacted" | "proposal">;

export function ReopenProspect({ slug, rowId, stage, fetchImpl, mintId }: {
  slug: string;
  rowId: string;
  stage: "closed-lost";
  fetchImpl?: typeof fetch;
  mintId?: () => string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ReopenStage | "">("");
  const [message, setMessage] = useState("");
  const command = useSalesCommand<{ target: ReopenStage }>({
    prospectRowId: `${rowId}:reopen`, url: `/api/prospects/${encodeURIComponent(slug)}/actions`, fetchImpl, mintId,
  });
  const sending = command.state.phase === "sending";
  const uncertain = command.state.phase === "uncertain";

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) { if (el.showModal) el.showModal(); else el.setAttribute("open", ""); }
    if (!open && el.open) { if (el.close) el.close(); else el.removeAttribute("open"); }
  }, [open]);
  const close = () => {
    if (sending || uncertain) return;
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async () => {
    if (!target || sending) return;
    const result = await command.send({ expectedStage: stage, stage: { to: target } }, { target });
    if (result.phase === "saved") {
      setOpen(false); setMessage(""); router.refresh();
      requestAnimationFrame(() => trigger.current?.focus());
    } else if (result.phase === "refused") {
      const code = result.refusal.code;
      setMessage(code === "stage_conflict" ? "The stage changed since you opened this. Your choice is kept; review the refreshed page before trying again."
        : code === "reopen_not_permitted" ? "Only the owner can reopen this prospect."
        : code === "closed_won_is_final" ? "A closed-won prospect cannot be reopened."
        : `Reopen was refused (${code.replaceAll("_", " ")}). Your choice is kept.`);
      if (code === "stage_conflict" || code === "held_prospect" || code === "archived_prospect") router.refresh();
    } else if (result.phase === "uncertain") setMessage("The result is unknown. Retry the same request; your choice is kept.");
  };

  return (
    <>
      <button ref={trigger} type="button" onClick={() => { setTarget(""); setMessage(""); command.reset(); setOpen(true); }}
        className="t-label inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t1)]"
        aria-haspopup="dialog">Reopen prospect</button>
      <dialog ref={dialog} aria-labelledby="reopen-title" className="sales-sheet" onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="sales-sheet-panel">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <h2 id="reopen-title" className="t-h2 text-[var(--color-t1)]">Reopen closed-lost prospect</h2>
            <button type="button" onClick={close} disabled={sending || uncertain} className="min-h-11 min-w-11 text-[var(--color-t1)]" aria-label="Close reopen">✕</button>
          </header>
          <div className="sales-sheet-body flex flex-col gap-4 px-4 py-4">
            <p className="t-meta text-[var(--color-t2)]">Choose the stage to reopen into. Nothing changes until you save.</p>
            <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={sending || uncertain}>
              <legend className="t-label mb-2 text-[var(--color-t1)]">Reopen as</legend>
              {(["lead", "contacted", "proposal"] as ReopenStage[]).map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-[var(--color-t1)]">
                  <input type="radio" name="reopen-stage" checked={target === value} onChange={() => { setTarget(value); setMessage(""); }} />{STAGE_LABEL[value]}
                </label>
              ))}
            </fieldset>
            {message && <p role="status" className="t-meta text-[var(--color-risk)]">{message}</p>}
          </div>
          <footer className="sales-sheet-foot flex justify-end gap-2 border-t border-[var(--color-line)] px-4 py-3">
            <button type="button" onClick={close} disabled={sending || uncertain} className="min-h-11 px-3">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!target || sending}
              className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 text-[var(--color-surface)] disabled:opacity-50">
              {uncertain ? "Retry" : sending ? "Saving…" : "Reopen"}
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
