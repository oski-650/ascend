"use client";

// components/sales/SalesWorkspace — the prospect page's action surface (Slice 2A.2b).
//
// The page is a Server Component: it reads the prospect, its timeline and the member names in its own
// guarded render. This client wrapper adds only what needs a browser — the Call and Record launchers
// (wherever the page places them), the sticky phone action bar, the More sheet, the Record contact
// sheet, and the CALL → RETURN flow.
//
// ─── CALL → RETURN, WITHOUT A "CALL ENDED" EVENT ───────────────────────────────────────────────
//
// Browsers do not tell a page that a phone call ended, so nothing here pretends one does:
//
//   1. Call is tapped → the pending-call state (prospect, start time) is written FIRST, then the
//      `tel:` link navigates. The write happens in the click handler, before the default action.
//   2. The phone app takes over; the page is hidden or loses focus.
//   3. On `visibilitychange` → visible, `focus` or `pageshow`, and on a fresh load, the state is
//      read back. If it names THIS prospect and is fresh (< 30 min), Record contact opens with the
//      call's START as the contact time — editable, and with no outcome chosen: tapping Call is not
//      evidence that anyone answered.
//   4. Record contact is always a button on its own, so none of this has to fire for the workflow
//      to work.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loadDraft, startCall, takePendingCall } from "./command-state";
import { RecordContactSheet, type SheetEntry, type SheetProspect } from "./RecordContactSheet";

/** A focus/visibility event this soon after tapping Call is the tap itself, not a return. */
export const MIN_AWAY_MS = 1500;

type Lock = "held" | "archived" | "gone" | null;
type DraftState = "none" | "draft" | "uncertain";

type Workspace = {
  name: string;
  phone: string | null;
  lock: Lock;
  /** A lock the CLIENT learned from a refusal, before the server's next render says so itself. */
  clientOnlyLock: Lock;
  sheetOpen: boolean;
  draftState: DraftState;
  call: () => void;
  openRecord: (launcher: HTMLElement | null) => void;
};
const Ctx = createContext<Workspace | null>(null);

/** `tel:` wants digits and a leading plus, nothing else. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function SalesWorkspace({
  prospect, phone, serverLock, more, children, clock = () => new Date(), fetchImpl, mintId,
}: {
  prospect: SheetProspect;
  phone: string | null;
  /** Held or archived as the SERVER last read it. */
  serverLock: "held" | "archived" | null;
  /** The page's secondary actions, shown in the phone's More sheet. */
  more: ReactNode;
  children: ReactNode;
  clock?: () => Date;
  fetchImpl?: typeof fetch;
  mintId?: () => string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<SheetEntry>({ kind: "manual" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [clientLock, setClientLock] = useState<Lock>(null);
  const [announce, setAnnounce] = useState("");
  const [draftState, setDraftState] = useState<DraftState>("none");
  const launcher = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const lock: Lock = serverLock ?? clientLock;

  const readDraftState = useCallback(() => {
    const d = loadDraft(prospect.rowId);
    setDraftState(!d ? "none" : d.command ? "uncertain" : "draft");
  }, [prospect.rowId]);
  useEffect(() => { readDraftState(); }, [readDraftState]);

  const openSheet = useCallback((e: SheetEntry, from: HTMLElement | null) => {
    if (lock) return;
    launcher.current = from ?? (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
    setEntry(e);
    setAnnounce("");
    setOpen(true);
  }, [lock]);

  const openRecord = useCallback((from: HTMLElement | null) => {
    // Opened by hand while a fresh call to this prospect is pending: the call's start still applies.
    const call = takePendingCall(prospect.rowId, clock().getTime());
    openSheet(call ? { kind: "call", startedAt: call.startedAt } : { kind: "manual" }, from);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clock` is a test seam, stable in use
  }, [openSheet, prospect.rowId]);

  const call = useCallback(() => {
    startCall(prospect.rowId, prospect.slug, clock().getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect.rowId, prospect.slug]);

  // ── the return ──
  useEffect(() => {
    if (lock) return;
    const check = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (openRef.current) return;
      const t = clock().getTime();
      const pending = takePendingCall(prospect.rowId, t);
      if (!pending || t - Date.parse(pending.startedAt) < MIN_AWAY_MS) return;
      openSheet({ kind: "call", startedAt: pending.startedAt }, null);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock, openSheet, prospect.rowId]);

  const close = useCallback(() => {
    setOpen(false);
    readDraftState();
    // Focus returns to whatever opened the sheet; after an automatic resume, to the Record button.
    const back = launcher.current?.isConnected ? launcher.current : document.querySelector<HTMLElement>("[data-record-launcher]");
    requestAnimationFrame(() => back?.focus());
  }, [readDraftState]);

  const ws: Workspace = {
    name: prospect.name, phone, lock, clientOnlyLock: serverLock ? null : clientLock, sheetOpen: open, draftState, call, openRecord,
  };

  return (
    <Ctx.Provider value={ws}>
      {children}

      {/* ── the phone's action bar: Call · Record · More ── */}
      <div className="sales-actionbar" role="group" aria-label="Prospect actions">
        {lock ? (
          <p className="t-meta flex-1 self-center text-[var(--color-t2)]">{LOCK_SHORT[lock]}</p>
        ) : (
          <>
            {phone && <CallButton variant="bar" />}
            <RecordButton variant="bar" />
          </>
        )}
        <button type="button" className="sales-bar-btn" aria-haspopup="dialog" onClick={(e) => { launcher.current = e.currentTarget; setMoreOpen(true); }}>
          More
        </button>
      </div>
      <MoreSheet open={moreOpen} onClose={() => { setMoreOpen(false); requestAnimationFrame(() => launcher.current?.focus()); }}>
        {more}
      </MoreSheet>

      {!lock && (
        <RecordContactSheet
          key={prospect.rowId}
          prospect={prospect}
          open={open}
          entry={entry}
          onClose={close}
          onSaved={(status) => {
            close();
            setAnnounce(status === "already_yours" ? "Already yours — nothing changed." : "Saved.");
            router.refresh();
          }}
          onLocked={(code) => {
            setOpen(false);
            setClientLock(code === "archived_prospect" ? "archived" : code === "held_prospect" ? "held" : "gone");
            router.refresh();
          }}
          onStale={() => router.refresh()}
          clock={clock}
          fetchImpl={fetchImpl}
          mintId={mintId}
        />
      )}
      <p aria-live="polite" className="sr-only" data-testid="workspace-status">{announce}</p>
      {announce === "Saved." && <SavedToast onDone={() => setAnnounce("")} />}
    </Ctx.Provider>
  );
}

/** The bar's version: the banner above says it in full. */
const LOCK_SHORT: Record<Exclude<Lock, null>, string> = {
  held: "On hold · can't record", archived: "Archived · can't record", gone: "Can't be changed",
};

const LOCK_WORDS: Record<Exclude<Lock, null>, string> = {
  held: "On hold for identity review — contacts can't be recorded.",
  archived: "Archived — contacts can't be recorded.",
  gone: "This prospect can't be changed any more. The page has been refreshed.",
};

/** The workspace's own notices, placed by the page inside its column (under the header). */
export function WorkspaceNotices() {
  const ws = useContext(Ctx);
  if (!ws) return null;
  if (ws.clientOnlyLock) return <LockBanner lock={ws.clientOnlyLock} />;
  if (ws.lock || ws.draftState !== "uncertain" || ws.sheetOpen) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-risk)]/40 px-3 py-2.5">
      <span className="t-meta text-[var(--color-t1)]">A save may not have gone through. Your entry is kept.</span>
      <button type="button" data-record-launcher className="t-label min-h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t1)]" onClick={(e) => ws.openRecord(e.currentTarget)}>
        Review and retry
      </button>
    </div>
  );
}

export function LockBanner({ lock }: { lock: Exclude<Lock, null> }) {
  return (
    <div role="status" className="mb-6 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-3 py-2.5">
      <p className="t-meta text-[var(--color-t1)]">{LOCK_WORDS[lock]}</p>
    </div>
  );
}

/** A visible, brief confirmation. The live region carries it for screen readers. */
function SavedToast({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [onDone]);
  return (
    <div aria-hidden className="sales-toast t-meta anim-enter">
      <span className="text-[var(--color-accent)]">✓</span> Saved
    </div>
  );
}

// ─── launchers — placed by the page, wired to the one sheet ───────────────────────────────────

const BAR = "sales-bar-btn";
// `pointer-coarse:` — the 1C floor covers <button> but not <a>, and Call is a link.
const HEADER = "t-label inline-flex min-h-9 pointer-coarse:min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 transition-colors duration-[120ms]";

/** `tel:` — and the pending-call record written BEFORE the navigation. */
export function CallButton({ variant = "header" }: { variant?: "bar" | "header" | "inline" }) {
  const ws = useContext(Ctx);
  if (!ws?.phone) return null;
  const label = `Call ${ws.name}, ${ws.phone}`;
  if (ws.lock) {
    return variant === "inline" ? <a href={telHref(ws.phone)} className="t-h2 inline-flex min-h-11 items-center self-start text-[var(--color-t1)]">{ws.phone}</a> : null;
  }
  const cls = variant === "bar" ? BAR
    : variant === "inline" ? "t-h2 inline-flex min-h-11 items-center self-start text-[var(--color-t1)] underline-offset-4 hover:text-[var(--color-accent-hi)] hover:underline"
    : `${HEADER} border-[var(--color-line-strong)] text-[var(--color-t1)] hover:border-[var(--color-t3)] hover:bg-[var(--color-surface-2)]`;
  return (
    <a href={telHref(ws.phone)} onClick={ws.call} aria-label={label} className={cls} data-call-launcher={variant}>
      {variant === "inline" ? ws.phone : "Call"}
    </a>
  );
}

export function RecordButton({ variant = "header" }: { variant?: "bar" | "header" }) {
  const ws = useContext(Ctx);
  if (!ws || ws.lock) return null;
  const suffix = ws.draftState === "draft" ? " · draft" : ws.draftState === "uncertain" ? " · not sent" : "";
  const cls = variant === "bar" ? `${BAR} sales-bar-primary`
    : `${HEADER} border-[var(--color-accent)]/50 bg-[var(--color-accent)]/12 text-[var(--color-accent-hi)] hover:bg-[var(--color-accent)]/20`;
  return (
    <button type="button" className={cls} aria-haspopup="dialog" data-record-launcher onClick={(e) => ws.openRecord(e.currentTarget)}>
      Record{variant === "header" ? " contact" : ""}{suffix && <span className="opacity-70">{suffix}</span>}
    </button>
  );
}

// ─── More (phone) ─────────────────────────────────────────────────────────────────────────────

function MoreSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
    if (!open && d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  }, [open]);
  return (
    <dialog ref={ref} className="sales-sheet sales-sheet--more" aria-label="More actions" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sales-sheet-panel">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="t-h2 text-[var(--color-t1)]">More</h2>
          <button type="button" onClick={onClose} className="t-label min-h-9 min-w-9 text-[var(--color-t2)]" aria-label="Close">
            <span aria-hidden className="text-base">✕</span>
          </button>
        </header>
        <div className="sales-sheet-body flex flex-col items-stretch gap-2 px-4 py-4 [&_a]:justify-start [&_button]:justify-start">
          {children}
        </div>
      </div>
    </dialog>
  );
}
