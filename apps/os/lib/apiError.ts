// lib/apiError.ts — uniform, non-disclosing API error responses (hardening pass).
//
// Every route previously ended with `{ error: e instanceof Error ? e.message : String(e) }` at
// status 500. Node's fs errors embed absolute paths, so a single unexpected failure disclosed the
// vault's full filesystem location and internal structure to any caller — e.g.
//   "ENOENT: no such file or directory, open '/Users/<name>/…/Documents/Ascend/…jsonl'"
//
// The real error (with stack) goes to the server log, where the operator can read it. The HTTP
// response carries a generic message only. No read-model, no derivation, no frozen contract.

import { NextResponse } from "next/server";

/**
 * Log `error` server-side under `context`, and return a generic 500 to the caller.
 * `context` is a short route identifier — never user input.
 */
export function serverErrorResponse(context: string, error: unknown, status = 500) {
  console.error(`[api:${context}]`, error);
  return NextResponse.json({ error: "request failed" }, { status });
}