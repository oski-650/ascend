// core/auth/connection — the database binding the AUTH path uses.
//
// Separate from `core/crm/source`'s prospect binding on purpose. That one answers "where do
// prospects come from?" and may legitimately be the vault. This one answers "where do users and
// memberships come from?", and the answer is always Postgres — a credential has no vault
// representation and never will.
//
// FAIL CLOSED, like every other seam in this system: an unregistered connection throws. There is no
// fallback, because the only conceivable fallback for "cannot check who you are" is "let you in".

import "server-only";
import type { SqlClient } from "@/core/db";

export class AuthDbUnavailable extends Error {}

let binding: SqlClient | null = null;

/** Registered once at startup, alongside the prospect binding. */
export function registerAuthDb(client: SqlClient): void {
  binding = client;
}

/** Test/teardown helper. Never called in production. */
export function clearAuthDb(): void {
  binding = null;
}

export function requireAuthDb(): SqlClient {
  if (!binding) {
    throw new AuthDbUnavailable(
      "No auth database connection is registered. Authentication cannot proceed, and there is no " +
        "fallback: the only fallback for 'cannot verify who you are' would be to let the caller in."
    );
  }
  return binding;
}
