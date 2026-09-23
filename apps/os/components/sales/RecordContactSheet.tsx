"use client";

// components/sales/RecordContactSheet — Call → Record → What next?, in ONE sheet (Slice 2A.2b).
//
// One dialog, grouped into sections, never a wizard: outcome · channel · note · when · stage ·
// follow-up · claim · Save. The normal path is three taps and no typing — outcome, a follow-up preset,
// Save. Everything the sheet decides lives in `record-draft` (pure, tested); everything it says lives
// in `presentation`. This file is the interaction: focus, the draft's persistence, and what each
// answer from the frozen route contract does to the screen.
//
// ─── THE COMMAND ID IS NOT THIS FILE'S BUSINESS ────────────────────────────────────────────────
//
// `useSalesCommand` mints it on the first Save, reuses it for a retry whose outcome is unknown, and
// forgets it on every definitive answer. What this file guarantees is the PAYLOAD half of that
// contract: an uncertain save locks the form and Retry resends the byte-identical body that was sent
// (restored from sessionStorage after a reload), so "the same command" is really the same command. A
// refusal unlocks the form; whatever is sent next is a new command, and gets a new id.
//
// ─── NATIVE <dialog> ───────────────────────────────────────────────────────────────────────────
//
// Same choice as the shell's overlays: `showModal()` gives the top layer, background inertness (the
// focus trap), and Escape for free. Escape closes WITHOUT losing anything — the draft is in
// sessionStorage — except while a save is in flight, when closing would hide its outcome.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { ContactChannel, ContactOutcome, FollowUpAction, LostReason, StageTarget } from "@/core/crm/sales";
import { losAngelesWallClock } from "@/domain";
import { Button } from "@/components/primitives";
import { clearPendingCall, loadDraft, saveDraft } from "./command-state";
import { useSalesCommand, type CommandPhase } from "./useSalesCommand";
import {
  ACTION_LABEL, ACTION_ORDER, CHANNEL_LABEL, CHANNEL_ORDER, COMMON_OUTCOMES, FORCED_CHANNEL, LOST_REASON_LABEL,
  LOST_REASON_ORDER, MORE_OUTCOMES, OUTCOME_LABEL, STAGE_LABEL, formatDue, formatTime, refusalWords, stageLabel, type Stage,
} from "./presentation";
import {
  LOST_CONTEXT_MAX, NOTE_MAX, buildSave, effectiveAction, effectiveChannel, emptyDraft, isClosed, presetAvailable,
  suggestedStage, type FollowChoice, type OpenFollowUpView, type RecordDraft, type SaveBody,
} from "./record-draft";

export type SheetProspect = {
  rowId: string;
  slug: string;
  name: string;
  stage: Stage | null;
  /** Null when nobody holds the prospect. */
  assignedTo: string | null;
  assigneeName: string | null;
  viewerIsAssignee: boolean;
  openFollowUp: OpenFollowUpView | null;
  lastChannel: ContactChannel | null;
};

export type SheetEntry = { kind: "manual" } | { kind: "call"; startedAt: string };

type Notice =
  | { kind: "uncertain"; reason: "offline" | "network" | "server" }
  | { kind: "stage"; current: Stage | null }
  | { kind: "claim" }
  | { kind: "followup_owned" }
  | { kind: "retry_new" }
  | { kind: "error"; text: string };

export function RecordContactSheet({
  prospect, open, entry, onClose, onSaved, onLocked, onStale, clock = () => new Date(), fetchImpl, mintId,
}: {
  prospect: SheetProspect;
  open: boolean;
  entry: SheetEntry;
  /** Dismissed. The draft is kept. */
  onClose: () => void;
  onSaved: (status: "applied" | "replayed" | "already_yours") => void;
  /** The prospect became held or archived (or vanished) under the operator. */
  onLocked: (code: string) => void;
  /** The server moved; the page should re-read. */
  onStale: () => void;
  clock?: () => Date;
  fetchImpl?: typeof fetch;
  mintId?: () => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const cmd = useSalesCommand<RecordDraft>({
    prospectRowId: prospect.rowId, url: `/api/prospects/${encodeURIComponent(prospect.slug)}/actions`, fetchImpl, mintId,
  });
  const [draft, setDraft] = useState<RecordDraft>(() => emptyDraft());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [serverField, setServerField] = useState<{ when?: string; follow?: string; lost?: string }>({});
  /** The stage the server reported in a stage_conflict, until the page re-reads. */
  const [stageSeen, setStageSeen] = useState<Stage | null | undefined>(undefined);
  const [claimTaken, setClaimTaken] = useState(false);
  /** The exact body of a save whose outcome is unknown. Retry sends THIS, never a rebuild. */
  const [pendingBody, setPendingBody] = useState<SaveBody | null>(null);
  const [now, setNow] = useState<Date>(() => clock());

  // ── opening: restore this prospect's draft, then apply what the entry point knows ──
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const t = clock();
      setNow(t);
      setNotice(null); setServerField({}); setClaimTaken(false); setStageSeen(undefined); cmd.reset();
      const stored = loadDraft<RecordDraft>(prospect.rowId, t.getTime());
      if (stored?.command) {
        // An earlier save's outcome is unknown. Nothing may change until it is retried.
        setDraft({ ...emptyDraft(), ...stored.draft });
        setPendingBody(JSON.parse(stored.command.payload) as SaveBody);
        setNotice({ kind: "uncertain", reason: "network" });
      } else {
        setPendingBody(null);
        const base = stored ? { ...emptyDraft(), ...stored.draft } : emptyDraft({
          channel: entry.kind === "call" ? "call" : prospect.lastChannel ?? "call",
          hasOpenFollowUp: prospect.openFollowUp !== null,
        });
        // A call pre-fills WHEN and HOW. It never says WHAT happened.
        setDraft(entry.kind === "call" ? { ...base, when: { mode: "call", at: entry.startedAt }, channel: "call" } : base);
      }
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the open transition only
  }, [open]);

  // ── the dialog element follows `open` ──
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
      // Initial focus: the chosen outcome, else the first — the question the sheet exists to ask.
      const target = d.querySelector<HTMLInputElement>('input[name$="-outcome"]:checked')
        ?? d.querySelector<HTMLInputElement>('input[name$="-outcome"]');
      target?.focus();
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
    }
  }, [open]);

  const sending = cmd.state.phase === "sending";
  const locked = sending || notice?.kind === "uncertain";

  const update = useCallback((patch: Partial<RecordDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      saveDraft(prospect.rowId, next);
      return next;
    });
    setServerField({});
    setNotice((n) => (n && n.kind !== "uncertain" && n.kind !== "stage" ? null : n));
  }, [prospect.rowId]);

  const stage: Stage | null = stageSeen !== undefined ? stageSeen : prospect.stage;
  const unassigned = prospect.assignedTo === null && !claimTaken;
  const ctx = useMemo(() => ({ stage, unassigned, openFollowUp: prospect.openFollowUp, now }), [stage, unassigned, prospect.openFollowUp, now]);
  const built = useMemo(() => buildSave(draft, ctx), [draft, ctx]);
  const suggestion = suggestedStage(stage, draft.outcome);
  const closed = isClosed(stage);

  // ── what each answer does ──
  function handle(r: CommandPhase, body: SaveBody) {
    if (r.phase === "saved") {
      clearPendingCall();
      setPendingBody(null);
      onSaved(r.result.status);
      return;
    }
    if (r.phase === "uncertain") {
      setPendingBody(body);
      setNotice({ kind: "uncertain", reason: r.reason });
      return;
    }
    if (r.phase !== "refused") return;
    setPendingBody(null);
    const { code, detail } = r.refusal;
    switch (code) {
      case "stage_conflict":
      case "stage_unchanged": {
        const current = (detail?.current ?? null) as Stage | null;
        setStageSeen(current);
        // The operator re-decides the stage against what is true now. Everything else is kept.
        setDraft((d) => { const n = { ...d, stageTo: null, lostReason: null, stageOpen: true }; saveDraft(prospect.rowId, n); return n; });
        setNotice({ kind: "stage", current });
        onStale();
        return;
      }
      case "already_assigned":
        setClaimTaken(true);
        setDraft((d) => { const n = { ...d, claim: false }; saveDraft(prospect.rowId, n); return n; });
        setNotice({ kind: "claim" });
        onStale();
        return;
      case "followup_owned_by_other":
        setNotice({ kind: "followup_owned" });
        return;
      case "command_id_conflict":
        setNotice({ kind: "retry_new" });
        return;
      case "held_prospect":
      case "archived_prospect":
      case "ambiguous_prospect":
      case "prospect_not_found":
        onLocked(code);
        return;
      case "no_open_followup":
        onStale();
        break;
    }
    const words = refusalWords(code);
    if (words.where === "sheet") setNotice({ kind: "error", text: words.text });
    else setServerField({ [words.where]: words.text });
  }

  async function submit(body: SaveBody) {
    setServerField({});
    if (notice?.kind !== "uncertain") setNotice(null);
    const r = await cmd.send(body as unknown as Record<string, unknown>, draft);
    handle(r, body);
    // Save was disabled while sending, which drops focus to <body>. When the sheet stays open, focus
    // returns to its primary action — the thing the operator must decide next (Retry, Save contact
    // only…); the alert above it has already been announced.
    if (r.phase !== "saved") requestAnimationFrame(() => primaryRef.current?.focus());
  }

  function save() {
    // Presets are re-read against the clock at the moment of Save, so "Tomorrow" means tomorrow.
    const t = clock();
    setNow(t);
    const fresh = buildSave(draft, { ...ctx, now: t });
    if (fresh.body) void submit(fresh.body);
  }

  function saveWithoutClaim() {
    const fresh = buildSave({ ...draft, claim: false }, { ...ctx, unassigned: false, now: clock() });
    if (fresh.body) void submit(fresh.body);
  }

  function saveContactOnly() {
    // A DIFFERENT command — contact and note only — and therefore a new id (the hook forgot the old one).
    if (built.body?.contact) void submit({ contact: built.body.contact });
  }

  function dismiss() {
    if (sending) return;
    // A call that was not recorded is not recorded by closing the sheet either; the offer ends here.
    clearPendingCall();
    onClose();
  }

  function clearDraftAndReset() {
    const fresh = emptyDraft({ channel: prospect.lastChannel ?? "call", hasOpenFollowUp: prospect.openFollowUp !== null });
    setDraft(entry.kind === "call" ? { ...fresh, when: { mode: "call", at: entry.startedAt }, channel: "call" } : fresh);
    saveDraft(prospect.rowId, fresh);
    setNotice(null); setServerField({});
  }

  const n = (s: string) => `${ids}-${s}`;
  const fieldWhen = serverField.when ?? built.field.when;
  const fieldFollow = serverField.follow ?? built.field.follow;
  const open_ = prospect.openFollowUp;
  const dirty = draft.outcome !== null || draft.note.trim() !== "" || draft.stageTo !== null || draft.claim
    || (draft.follow !== "none" && draft.follow !== "keep");

  // ── the footer's one message ──
  const status: { text: string; tone: "quiet" | "risk" | "accent" } | null =
    sending ? { text: "Saving…", tone: "quiet" }
    : notice?.kind === "uncertain" ? {
        tone: "risk",
        text: notice.reason === "offline"
          ? "You're offline, so this wasn't sent. Your entry is kept — retry when you're back online."
          : "We couldn't confirm this was saved. Your entry is kept. Retry is safe — it can't record the contact twice.",
      }
    : notice?.kind === "stage" ? { tone: "risk", text: `The stage changed to ${stageLabel(notice.current)} since you opened this. Your entry is kept — choose the stage again (or leave it) and save.` }
    : notice?.kind === "claim" ? { tone: "risk", text: "Someone else claimed this prospect just now. Your contact and follow-up are kept." }
    : notice?.kind === "followup_owned" ? {
        tone: "risk",
        text: `${open_?.assigneeName ?? "Another salesperson"} owns the open follow-up, so it can't be changed from here.${built.body?.contact ? " You can still save the contact and note." : ""}`,
      }
    : notice?.kind === "retry_new" ? { tone: "risk", text: "This couldn't be saved. Your entry is kept — try again." }
    : notice?.kind === "error" ? { tone: "risk", text: notice.text }
    : built.blockers.length ? { tone: "quiet", text: built.blockers[0] }
    : null;

  // What Save will record, in one line — the operator's last check before tapping it.
  const summary = built.body ? [
    built.body.contact && OUTCOME_LABEL[built.body.contact.outcome],
    built.body.claim && "claim",
    built.body.stage && `→ ${STAGE_LABEL[built.body.stage.to]}`,
    built.followPreview ? `next: ${built.followPreview}` : built.body.followUp && "resolve the open follow-up",
  ].filter(Boolean).join(" · ") : "";

  let primary: { label: string; onClick: () => void; disabled?: boolean };
  if (notice?.kind === "uncertain") primary = { label: "Retry", onClick: () => pendingBody && void submit(pendingBody), disabled: sending || !pendingBody };
  else if (notice?.kind === "claim") primary = { label: "Save without claiming", onClick: saveWithoutClaim, disabled: sending || !built.body };
  else if (notice?.kind === "followup_owned" && built.body?.contact) primary = { label: "Save contact only", onClick: saveContactOnly, disabled: sending };
  else if (notice?.kind === "retry_new") primary = { label: "Try again", onClick: save, disabled: sending || !built.body };
  else primary = { label: sending ? "Saving…" : "Save", onClick: save, disabled: sending || !built.body };

  return (
    <dialog
      ref={dialog}
      className="sales-sheet"
      aria-labelledby={n("title")}
      aria-describedby={n("sub")}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
    >
      <div className="sales-sheet-panel">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 pb-3 pt-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={n("title")} className="t-h2 text-[var(--color-t1)]">Record contact</h2>
            <p id={n("sub")} className="t-meta mt-0.5 truncate text-[var(--color-t3)]">{prospect.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {dirty && !locked && (
              <Button type="button" variant="quiet" onClick={clearDraftAndReset}>Clear</Button>
            )}
            <Button type="button" variant="quiet" onClick={dismiss} disabled={sending} aria-label="Close. Your entry is kept.">
              <span aria-hidden className="text-base leading-none">✕</span>
            </Button>
          </div>
        </header>

        {/* The scroll container is a DIV: a <fieldset> does not reliably clip as one, and focusing a
            chip low in the form then scrolled the whole dialog off-screen (measured at 667×375). The
            fieldset inside only disables the form while a save is in flight or uncertain. */}
        <div className="sales-sheet-body">
        <fieldset disabled={locked} className="min-w-0 border-0 p-0">
          <div className="flex flex-col gap-5 px-4 py-4 sm:px-5">
            {/* ── 1 · outcome ── */}
            <ChipGroup
              legend="What happened?"
              name={n("outcome")}
              value={draft.outcome}
              options={[...COMMON_OUTCOMES, ...(draft.moreOutcomes || (draft.outcome && MORE_OUTCOMES.includes(draft.outcome)) ? MORE_OUTCOMES : [])]
                .map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
              onChange={(v) => update({ outcome: v as ContactOutcome })}
              after={!(draft.moreOutcomes || (draft.outcome && MORE_OUTCOMES.includes(draft.outcome))) && (
                <button type="button" className={CHIP_BUTTON} onClick={() => update({ moreOutcomes: true })} aria-expanded={false}>
                  More…
                </button>
              )}
            />

            {/* WHEN is always visible: after a call, "Call started 2:14 PM PT" is the first thing to confirm. */}
            <div className="-mt-3">
              <WhenRow draft={draft} update={update} now={now} error={fieldWhen} idBase={n("when")} pick={built.whenPick} />
            </div>

            {/* ── channel · note — the contact's details, grouped under it ── */}
            {draft.outcome && (
              <div className="-mt-3 flex flex-col gap-3">
                <ChipGroup
                  legend="How"
                  small
                  name={n("channel")}
                  value={effectiveChannel(draft)}
                  options={CHANNEL_ORDER.map((c) => ({
                    value: c, label: CHANNEL_LABEL[c],
                    disabled: FORCED_CHANNEL[draft.outcome!] !== undefined && FORCED_CHANNEL[draft.outcome!] !== c,
                  }))}
                  onChange={(v) => update({ channel: v as ContactChannel })}
                  hint={FORCED_CHANNEL[draft.outcome] ? `${OUTCOME_LABEL[draft.outcome]} is always ${CHANNEL_LABEL[FORCED_CHANNEL[draft.outcome]!].toLowerCase() === "call" ? "a call" : "an email"}.` : undefined}
                />
                {draft.noteOpen || draft.note ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="t-label text-[var(--color-t3)]">Note</span>
                    <textarea
                      className={`${TEXTAREA} min-h-[5.5rem]`}
                      value={draft.note}
                      maxLength={NOTE_MAX + 200}
                      onChange={(e) => update({ note: e.target.value })}
                      aria-describedby={built.field.note ? n("note-err") : undefined}
                      aria-invalid={built.field.note ? true : undefined}
                    />
                    {built.field.note && <span id={n("note-err")} className="t-meta text-[var(--color-risk)]">{built.field.note}</span>}
                  </label>
                ) : (
                  <div>
                    <button type="button" className={LINK_BUTTON} onClick={() => update({ noteOpen: true })}>+ Add a note</button>
                  </div>
                )}
              </div>
            )}
            {!draft.outcome && built.field.note && (
              <p className="t-meta -mt-3 text-[var(--color-risk)]">{built.field.note}</p>
            )}

            {/* ── 2 · stage — optional, never changed by an outcome ── */}
            <section aria-labelledby={n("stage-h")} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id={n("stage-h")} className="t-label text-[var(--color-t3)]">
                  Stage · <span className="text-[var(--color-t2)]">{stageLabel(stage)}</span>
                  {draft.stageTo && <span className="text-[var(--color-accent-hi)]"> → {STAGE_LABEL[draft.stageTo]}</span>}
                </h3>
                {!closed && !draft.stageOpen && (
                  <button type="button" className={LINK_BUTTON} onClick={() => update({ stageOpen: true })} aria-expanded={false}>
                    Change stage
                  </button>
                )}
              </div>
              {closed ? (
                <p className="t-meta text-[var(--color-t3)]">
                  {stage === "closed-won" ? "This prospect is won — its stage is final." : "Closed. Only the owner can reopen it."}
                </p>
              ) : (
                <>
                  {suggestion && !draft.stageOpen && (
                    <button
                      type="button"
                      aria-pressed={draft.stageTo === suggestion}
                      onClick={() => update({ stageTo: draft.stageTo === suggestion ? null : suggestion })}
                      className={`${CHIP_BUTTON} self-start ${draft.stageTo === suggestion ? CHIP_ON : "border-dashed border-[var(--color-accent)]/50 text-[var(--color-t1)]"}`}
                    >
                      <span aria-hidden>{draft.stageTo === suggestion ? "✓" : "+"}</span>
                      {draft.stageTo === suggestion ? `Moving ${stageLabel(stage)} → ${STAGE_LABEL[suggestion]}` : `Move ${stageLabel(stage)} → ${STAGE_LABEL[suggestion]}?`}
                    </button>
                  )}
                  {draft.stageOpen && (
                    <ChipGroup
                      legend="Move to"
                      srLegend
                      name={n("stage")}
                      value={draft.stageTo ?? "__keep"}
                      options={[
                        { value: "__keep", label: `Keep ${stageLabel(stage)}` },
                        ...(["lead", "contacted", "proposal", "closed-lost"] as StageTarget[])
                          .filter((s) => s !== stage)
                          .map((s) => ({ value: s, label: STAGE_LABEL[s] })),
                      ]}
                      onChange={(v) => update({ stageTo: v === "__keep" ? null : (v as StageTarget), lostReason: v === "closed-lost" ? draft.lostReason : null })}
                    />
                  )}
                  {draft.stageTo === "closed-lost" && (
                    <div className="flex flex-col gap-2.5 border-l-2 border-[var(--color-line-strong)] pl-3">
                      <ChipGroup
                        legend="Why was it lost? (required)"
                        small
                        name={n("lost")}
                        value={draft.lostReason}
                        options={LOST_REASON_ORDER.map((r) => ({ value: r, label: LOST_REASON_LABEL[r] }))}
                        onChange={(v) => update({ lostReason: v as LostReason })}
                        // Red is for the server's refusal. Before Save, the legend says "(required)" and the
                        // footer says why Save is unavailable — the operator has done nothing wrong yet.
                        error={serverField.lost}
                        required
                      />
                      {draft.lostReason === "other" && draft.outcome && (
                        <label className="flex flex-col gap-1.5">
                          <span className="t-label text-[var(--color-t3)]">What happened? (optional — saved with the contact note)</span>
                          <input
                            className={INPUT}
                            value={draft.lostContext}
                            maxLength={LOST_CONTEXT_MAX}
                            onChange={(e) => update({ lostContext: e.target.value })}
                          />
                        </label>
                      )}
                      {built.consequence && <p className="t-meta text-[var(--color-t2)]">{built.consequence}</p>}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── 3 · what next ── */}
            <section aria-labelledby={n("follow-h")} className="flex flex-col gap-2.5">
              {closed || draft.stageTo === "closed-lost" ? (
                <>
                  <h3 id={n("follow-h")} className="t-label text-[var(--color-t3)]">Next step</h3>
                  <p className="t-meta text-[var(--color-t3)]">No follow-up — a closed prospect doesn&apos;t get one.</p>
                </>
              ) : (
                <>
                  <ChipGroup
                    legend="Next step"
                    labelledBy={n("follow-h")}
                    name={n("follow")}
                    value={draft.follow}
                    options={[
                      ...(open_ ? [{ value: "keep", label: "Keep current" }] : []),
                      { value: "later_today", label: "Later today", disabled: !presetAvailable("later_today", now) },
                      { value: "tomorrow", label: "Tomorrow" },
                      { value: "in_2_days", label: "In 2 days" },
                      { value: "next_week", label: "Next week" },
                      { value: "pick", label: "Pick date…" },
                      { value: "none", label: "No follow-up" },
                    ]}
                    onChange={(v) => update({ follow: v as FollowChoice })}
                    hint={!presetAvailable("later_today", now) ? "Later today isn't offered this late — use Tomorrow or pick a time." : undefined}
                  />
                  {open_ && draft.follow === "keep" && (
                    <p className="t-meta text-[var(--color-t2)]">
                      Keeps: {ACTION_LABEL[open_.action as FollowUpAction] ?? "Follow-up"} · {formatDue(open_.dueOn, open_.dueAt, now)} · {open_.assigneeName}
                    </p>
                  )}
                  {draft.follow === "pick" && (
                    <PtPicker
                      idBase={n("pick")}
                      date={draft.pickDate}
                      time={draft.pickTime}
                      offset={draft.pickOffset}
                      min={losAngelesWallClock(now).slice(0, 10)}
                      res={built.pick}
                      onChange={(p) => update({ pickDate: p.date ?? draft.pickDate, pickTime: p.time ?? draft.pickTime, pickOffset: p.offset === undefined ? draft.pickOffset : p.offset })}
                      optionalTime
                    />
                  )}
                  {draft.follow !== "keep" && draft.follow !== "none" && (
                    <ChipGroup
                      legend="As"
                      small
                      name={n("action")}
                      value={effectiveAction(draft)}
                      options={ACTION_ORDER.map((a) => ({ value: a, label: ACTION_LABEL[a] }))}
                      onChange={(v) => update({ action: v as FollowUpAction })}
                    />
                  )}
                  {built.followPreview && (
                    <p className="t-body text-[var(--color-t1)]" data-testid="follow-preview">
                      <span className="text-[var(--color-t3)]">Follow-up: </span>{built.followPreview}
                      <span className="t-meta block text-[var(--color-t3)]">Pacific time (Los Angeles), wherever you are.</span>
                    </p>
                  )}
                  {/* A DST problem in the picker is explained inside the picker, once. */}
                  {fieldFollow && !(draft.follow === "pick" && !serverField.follow && built.pick && built.pick.kind !== "empty") && (
                    <p role="alert" className="t-meta text-[var(--color-risk)]">{fieldFollow}</p>
                  )}
                  {built.consequence && <p className="t-meta text-[var(--color-t2)]">{built.consequence}</p>}
                </>
              )}
            </section>

            {/* ── 4 · claim — noticeable, optional, OFF ── */}
            {unassigned ? (
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-3 py-2.5">
                <span className="flex flex-col">
                  <span className="t-body text-[var(--color-t1)]">Claim this prospect</span>
                  <span className="t-meta text-[var(--color-t3)]">Nobody holds it yet. Claiming makes it yours.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="sales-switch"
                  checked={draft.claim}
                  onChange={(e) => update({ claim: e.target.checked })}
                />
              </label>
            ) : (
              <p className="t-meta text-[var(--color-t3)]">
                {claimTaken ? "Claimed by someone else just now." : prospect.viewerIsAssignee ? "Assigned to you." : `Assigned to ${prospect.assigneeName ?? "a teammate"}.`}
              </p>
            )}
          </div>
        </fieldset>
        </div>

        <footer className="sales-sheet-foot border-t border-[var(--color-line)] px-4 pt-3 sm:px-5">
          {/* Two regions: a polite one for progress, an alert for anything the operator must act on. */}
          <p aria-live="polite" className="t-meta mb-2.5 min-h-[1.25rem] text-[var(--color-t3)]" data-testid="sheet-status">
            {status && status.tone !== "risk" ? status.text : status ? "" : summary}
          </p>
          {status?.tone === "risk" && (
            <p role="alert" className="t-meta -mt-2 mb-2.5 text-[var(--color-risk)]" data-testid="sheet-alert">{status.text}</p>
          )}
          <div className="flex items-center gap-2">
            {notice?.kind === "followup_owned" && !built.body?.contact && (
              <Button type="button" variant="ghost" onClick={() => { update({ follow: open_ ? "keep" : "none" }); setNotice(null); }}>
                Leave the follow-up
              </Button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="sales-save t-body flex-1 rounded-[var(--radius-md)] border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/14 px-4 py-2.5 font-medium text-[var(--color-accent-hi)] transition-colors duration-[120ms] hover:bg-[var(--color-accent)]/22 disabled:cursor-not-allowed disabled:border-[var(--color-line-strong)] disabled:bg-transparent disabled:text-[var(--color-t3)]"
            >
              {primary.label}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────────────────────

const INPUT = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-t1)] outline-none transition-colors duration-[120ms] focus:border-[var(--color-accent)] disabled:opacity-50";
const TEXTAREA = `${INPUT} resize-y`;
const CHIP_BASE = "relative inline-flex min-h-9 cursor-pointer select-none items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[0.8125rem] transition-colors duration-[120ms]";
const CHIP_OFF = "border-[var(--color-line-strong)] text-[var(--color-t2)] hover:border-[var(--color-t3)] hover:text-[var(--color-t1)]";
const CHIP_ON = "border-[var(--color-accent)]/70 bg-[var(--color-accent)]/12 text-[var(--color-accent-hi)]";
const CHIP_BUTTON = `${CHIP_BASE} ${CHIP_OFF}`;
const LINK_BUTTON = "t-meta min-h-9 text-[var(--color-t2)] underline-offset-4 hover:text-[var(--color-t1)] hover:underline";

type ChipOption = { value: string; label: string; disabled?: boolean };

/** Mutually exclusive choices as NATIVE radios: arrow keys, one tab stop and radio semantics for free. */
function ChipGroup({
  legend, srLegend, labelledBy, name, value, options, onChange, hint, error, after, small, required,
}: {
  legend: string; srLegend?: boolean; labelledBy?: string; name: string; value: string | null;
  options: ChipOption[]; onChange: (v: string) => void; hint?: string; error?: string; after?: ReactNode;
  small?: boolean; required?: boolean;
}) {
  const errId = `${name}-err`;
  return (
    <fieldset className="min-w-0 border-0 p-0" aria-describedby={error ? errId : undefined} aria-required={required || undefined}>
      <legend id={labelledBy} className={srLegend ? "sr-only" : `t-label mb-2 ${small ? "text-[var(--color-t3)]" : "text-[var(--color-t2)]"}`}>
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={`${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40`}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={o.value}
                checked={on}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              {/* Selection is a glyph AND a colour, never colour alone. */}
              {on && <span aria-hidden>✓</span>}
              {o.label}
            </label>
          );
        })}
        {after}
      </div>
      {hint && <p className="t-meta mt-1.5 text-[var(--color-t3)]">{hint}</p>}
      {error && <p id={errId} role="alert" className="t-meta mt-1.5 text-[var(--color-risk)]">{error}</p>}
    </fieldset>
  );
}

/** WHEN the contact happened: now, the call's start, or a Pacific date and time the operator picks. */
function WhenRow({
  draft, update, now, error, idBase, pick,
}: {
  draft: RecordDraft; update: (p: Partial<RecordDraft>) => void; now: Date; error?: string; idBase: string;
  pick: ReturnType<typeof buildSave>["whenPick"];
}) {
  const w = draft.when;
  if (w.mode !== "manual") {
    const wall = losAngelesWallClock(w.mode === "call" ? new Date(w.at) : now);
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="t-meta text-[var(--color-t2)]">
          <span className="text-[var(--color-t3)]">When: </span>
          {w.mode === "call" ? `Call started ${formatTime(w.at)}` : "Just now"}
        </span>
        <button
          type="button"
          className={LINK_BUTTON}
          onClick={() => update({ when: { mode: "manual", date: wall.slice(0, 10), time: wall.slice(11), offset: null } })}
        >
          Change time
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PtPicker
        idBase={idBase}
        legend="When it happened"
        date={w.date}
        time={w.time}
        offset={w.offset}
        max={losAngelesWallClock(now).slice(0, 10)}
        res={pick}
        onChange={(p) => update({ when: { mode: "manual", date: p.date ?? w.date, time: p.time ?? w.time, offset: p.offset === undefined ? w.offset : p.offset } })}
        hideError
      />
      <div>
        <button type="button" className={LINK_BUTTON} onClick={() => update({ when: { mode: "now" } })}>Use just now</button>
      </div>
      {error && <p role="alert" className="t-meta text-[var(--color-risk)]">{error}</p>}
    </div>
  );
}

/** A Pacific date and time. Refuses a time that doesn't exist; asks which one when it exists twice. */
function PtPicker({
  idBase, legend = "Date and time", date, time, offset, min, max, res, onChange, optionalTime, hideError,
}: {
  idBase: string; legend?: string; date: string; time: string; offset: string | null; min?: string; max?: string;
  res: ReturnType<typeof buildSave>["pick"]; optionalTime?: boolean; hideError?: boolean;
  onChange: (p: { date?: string; time?: string; offset?: string | null }) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="t-label mb-2 text-[var(--color-t3)]">{legend} · Pacific time</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-meta text-[var(--color-t3)]">Date</span>
          <input id={`${idBase}-date`} type="date" className={INPUT} value={date} min={min} max={max}
            onChange={(e) => onChange({ date: e.target.value, offset: null })} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-meta text-[var(--color-t3)]">Time{optionalTime ? " (optional)" : ""}</span>
          <input id={`${idBase}-time`} type="time" className={INPUT} value={time}
            onChange={(e) => onChange({ time: e.target.value, offset: null })} />
        </label>
      </div>
      {res?.kind === "gap" && (
        <div role="alert" className="mt-2 flex flex-col items-start gap-2">
          {!hideError && <p className="t-meta text-[var(--color-risk)]">{res.message}</p>}
          <button type="button" className={CHIP_BUTTON} onClick={() => onChange({ time: res.suggestion, offset: null })}>
            Use 3:00 AM instead
          </button>
        </div>
      )}
      {res?.kind === "ambiguous" && (
        <div className="mt-2">
          {!hideError && <p className="t-meta mb-2 text-[var(--color-t2)]">{res.message}</p>}
          <ChipGroup
            legend="Which one?"
            small
            name={`${idBase}-offset`}
            value={offset}
            options={res.options.map((o) => ({ value: o.offset, label: o.label }))}
            onChange={(v) => onChange({ offset: v })}
          />
        </div>
      )}
      {res?.kind === "invalid" && !hideError && <p role="alert" className="t-meta mt-2 text-[var(--color-risk)]">{res.message}</p>}
    </fieldset>
  );
}
