// components/sales/command-state — the browser's side of command identity (Slice 2A.2a).
//
// ─── DRAFT ≠ COMMAND ───────────────────────────────────────────────────────────────────────────
//
// Typing into the sheet produces a DRAFT. A draft has no command id: it has not been sent, so there is
// nothing to converge on. The id is minted at the FIRST ACTUAL SAVE ATTEMPT and snapshotted with the
// exact payload that was sent.
//
// ─── WHY THE ID OUTLIVES THE REQUEST ───────────────────────────────────────────────────────────
//
// A timeout, a dropped connection, a lost response or an ambiguous 5xx leave the outcome UNKNOWN: the
// server may have committed. Retrying with a NEW id would write the contact twice. So an uncertain
// command is persisted (`sessionStorage`) with its payload, and the retry — including after a reload
// — reuses that id. The server then replays and returns the same outcome.
//
// A NEW id is minted only when the command is genuinely different: the payload changed after a
// definitive refusal, a conflict was reconciled and resubmitted, "Save contact only" replaced the
// combined command, or a previous command definitively completed.
//
// ─── WHAT IS STORED ────────────────────────────────────────────────────────────────────────────
//
// Only what is needed to restore an unfinished draft and to retry it safely: the draft itself (the
// operator's own unsent text), and for an uncertain command its id and canonical payload. No tokens,
// no session data, no server outcome. Entries older than a day are dropped on read.

export const DRAFT_KEY = (prospectRowId: string) => `ascend.sales.draft.v1:${prospectRowId}`;
export const CALL_KEY = "ascend.sales.call.v1";
export const DRAFT_TTL_MS = 24 * 60 * 60_000;
/** A call older than this is not the call the operator just made. */
export const CALL_TTL_MS = 30 * 60_000;

export type UncertainCommand = { id: string; payload: string; state: "uncertain"; attempts: number; firstAttemptAt: string };
export type StoredDraft<D = unknown> = { v: 1; prospect: string; updatedAt: string; draft: D; command: UncertainCommand | null };
export type PendingCall = { v: 1; prospect: string; ref: string; startedAt: string };

/** Canonical JSON: keys sorted at every level, `undefined` dropped. Two equal payloads → one string. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** sessionStorage, or null where it is unavailable (private mode, SSR, a blocked origin). */
function store(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
function read<T>(key: string): T | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { store()?.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode: the draft is a convenience */ }
}
export function drop(key: string): void {
  try { store()?.removeItem(key); } catch { /* as above */ }
}

// ─── the draft ────────────────────────────────────────────────────────────────────────────────

export function loadDraft<D>(prospectRowId: string, now = Date.now()): StoredDraft<D> | null {
  const d = read<StoredDraft<D>>(DRAFT_KEY(prospectRowId));
  if (!d || d.v !== 1 || d.prospect !== prospectRowId) return null;
  if (now - Date.parse(d.updatedAt) > DRAFT_TTL_MS) { drop(DRAFT_KEY(prospectRowId)); return null; }
  return d;
}

/** Save the draft. The command is left exactly as it was: editing never mints or clears an id. */
export function saveDraft<D>(prospectRowId: string, draft: D, now = Date.now()): void {
  const prior = loadDraft<D>(prospectRowId, now);
  write(DRAFT_KEY(prospectRowId), {
    v: 1, prospect: prospectRowId, updatedAt: new Date(now).toISOString(), draft, command: prior?.command ?? null,
  } satisfies StoredDraft<D>);
}

export function clearDraft(prospectRowId: string): void { drop(DRAFT_KEY(prospectRowId)); }

/**
 * The id to send for `payload`, and whether it is a retry of an uncertain command.
 *
 * Reuses the stored id ONLY when the stored command is uncertain AND its payload is byte-identical.
 * Anything else is a different command and gets a new id.
 */
export function commandIdFor<D>(
  prospectRowId: string, payload: unknown, mint: () => string, now = Date.now(),
): { id: string; retry: boolean } {
  const stored = loadDraft<D>(prospectRowId, now);
  const canonicalPayload = canonical(payload);
  if (stored?.command && stored.command.state === "uncertain" && stored.command.payload === canonicalPayload) {
    return { id: stored.command.id, retry: true };
  }
  return { id: mint(), retry: false };
}

/** Record that a command's outcome is UNKNOWN, so the next attempt reuses its id. */
export function rememberUncertain<D>(prospectRowId: string, draft: D, id: string, payload: unknown, now = Date.now()): void {
  const prior = loadDraft<D>(prospectRowId, now);
  const canonicalPayload = canonical(payload);
  const same = prior?.command && prior.command.id === id && prior.command.payload === canonicalPayload ? prior.command : null;
  write(DRAFT_KEY(prospectRowId), {
    v: 1, prospect: prospectRowId, updatedAt: new Date(now).toISOString(), draft,
    command: {
      id, payload: canonicalPayload, state: "uncertain",
      attempts: (same?.attempts ?? 0) + 1, firstAttemptAt: same?.firstAttemptAt ?? new Date(now).toISOString(),
    },
  } satisfies StoredDraft<D>);
}

/** The outcome is known: the id must never be reused, whatever happens to the draft. */
export function forgetCommand<D>(prospectRowId: string, now = Date.now()): void {
  const prior = loadDraft<D>(prospectRowId, now);
  if (!prior) return;
  write(DRAFT_KEY(prospectRowId), { ...prior, updatedAt: new Date(now).toISOString(), command: null });
}

// ─── the pending call ─────────────────────────────────────────────────────────────────────────
//
// A browser does not tell a page that a phone call ended. So the page records that a call was STARTED
// and, when it is next visible, offers to record the contact — with the call's start time. Every step
// is an offer: Record contact is always reachable on its own.

export function startCall(prospect: string, ref: string, now = Date.now()): PendingCall {
  const call: PendingCall = { v: 1, prospect, ref, startedAt: new Date(now).toISOString() };
  write(CALL_KEY, call);
  return call;
}

/** The pending call for THIS prospect, if it is fresh. Anything else is cleared rather than guessed at. */
export function takePendingCall(prospectRowId: string, now = Date.now()): PendingCall | null {
  const call = read<PendingCall>(CALL_KEY);
  if (!call || call.v !== 1) { drop(CALL_KEY); return null; }
  const age = now - Date.parse(call.startedAt);
  if (Number.isNaN(age) || age > CALL_TTL_MS || call.prospect !== prospectRowId) { drop(CALL_KEY); return null; }
  return call;
}

export function clearPendingCall(): void { drop(CALL_KEY); }
