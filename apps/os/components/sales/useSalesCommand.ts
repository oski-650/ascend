"use client";

// components/sales/useSalesCommand — sending a sales command from the browser, safely (Slice 2A.2a).
//
// ONE hook owns everything the UI must not get wrong twice: which command id to send, when an outcome
// is definitive, and what the frozen HTTP contract (`lib/sales-http.ts`) means for the operator.
//
//   sent            → "saved"      201 applied, or 200 replayed. A replay IS the first save's result,
//                                  so the UI shows the same thing for both.
//   refused         → "refused"    a 4xx the operator must resolve. The draft is kept; the command id
//                                  is forgotten, because the next attempt is a different command.
//   outcome unknown → "uncertain"  timeout, dropped connection, offline, or a 5xx. The id and payload
//                                  are persisted, and Retry reuses them — that is what makes a retry
//                                  safe rather than a second contact.
//
// It never refreshes data itself and never fetches prospect data: the page owns reads (server-side),
// and the caller decides when to `router.refresh()`.

import { useCallback, useRef, useState } from "react";
import {
  clearDraft, commandIdFor, forgetCommand, rememberUncertain,
} from "./command-state";

/**
 * Refusals the operator resolves by REFRESHING state and resubmitting, rather than by editing the
 * draft: the server moved under them. The UI shows the new state and asks again.
 *
 * Every refusal — these included — forgets the command id, because the resubmission is a different
 * command. This set only decides what the UI SAYS.
 */
export const RECONCILABLE = new Set([
  "stage_conflict", "already_assigned", "followup_owned_by_other", "command_id_conflict",
  "followup_conflict", "assignment_conflict", "followup_choice_required",
]);
export const isReconcilable = (code: string): boolean => RECONCILABLE.has(code);

export type CommandRefusal = { code: string; status: number; detail?: Record<string, unknown>; fallback?: Record<string, unknown> };
export type CommandSuccess = { status: "applied" | "replayed" | "already_yours"; commandId: string; outcome: Record<string, unknown> };
export type CommandPhase =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "saved"; result: CommandSuccess }
  | { phase: "refused"; refusal: CommandRefusal }
  | { phase: "uncertain"; reason: "offline" | "network" | "server"; canRetry: true };

export type SalesCommandOptions = {
  /** The prospect's ROW id — the draft and pending-call keys are scoped to it. */
  prospectRowId: string;
  /** Where to POST/PATCH. The caller builds it from the slug in the URL. */
  url: string;
  method?: "POST" | "PATCH";
  /** Injected in tests. */
  now?: () => number;
  mintId?: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function useSalesCommand<D = unknown>(opts: SalesCommandOptions) {
  const { prospectRowId, url, method = "POST", now = Date.now, mintId = uuid, fetchImpl, timeoutMs = 15_000 } = opts;
  const [state, setState] = useState<CommandPhase>({ phase: "idle" });
  /** One in-flight request per command: a second submit while pending is ignored, not queued. */
  const inFlight = useRef(false);

  const send = useCallback(async (payload: Record<string, unknown>, draft: D): Promise<CommandPhase> => {
    if (inFlight.current) return state;
    inFlight.current = true;
    // The id is minted HERE — at the first actual save attempt — or reused when this exact payload is
    // an uncertain command already in flight against the server's memory.
    const { id } = commandIdFor<D>(prospectRowId, payload, mintId, now());
    const body = { ...payload, commandId: id };
    setState({ phase: "sending" });

    const uncertain = (reason: "offline" | "network" | "server"): CommandPhase => {
      rememberUncertain<D>(prospectRowId, draft, id, payload, now());
      const next: CommandPhase = { phase: "uncertain", reason, canRetry: true };
      setState(next);
      return next;
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      inFlight.current = false;
      return uncertain("offline");
    }

    const doFetch = fetchImpl ?? fetch;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (res.status >= 500) return uncertain("server");
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        // Definitive: the command committed. The draft and its id are done.
        clearDraft(prospectRowId);
        const result: CommandSuccess = {
          status: (json.status as CommandSuccess["status"]) ?? "applied",
          commandId: String(json.commandId ?? id),
          outcome: (json.outcome as Record<string, unknown>) ?? {},
        };
        const next: CommandPhase = { phase: "saved", result };
        setState(next);
        return next;
      }
      const code = String(json.error ?? "refused");
      // Definitive refusal. The id is forgotten either way: whatever the operator does next — edit the
      // draft, reconcile a conflict, save the contact alone — is a DIFFERENT command.
      forgetCommand<D>(prospectRowId, now());
      const refusal: CommandRefusal = {
        code, status: res.status,
        ...(json.detail ? { detail: json.detail as Record<string, unknown> } : {}),
        ...(json.fallback ? { fallback: json.fallback as Record<string, unknown> } : {}),
      };
      const next: CommandPhase = { phase: "refused", refusal };
      setState(next);
      return next;
    } catch {
      // Abort, DNS, dropped socket: the server may have committed. Keep the id.
      return uncertain("network");
    } finally {
      if (timer) clearTimeout(timer);
      inFlight.current = false;
    }
  }, [fetchImpl, method, mintId, now, prospectRowId, state, timeoutMs, url]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, send, reset };
}
