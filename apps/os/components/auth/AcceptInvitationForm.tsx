"use client";

// components/auth/AcceptInvitationForm — the form half of invitation acceptance.
//
// It holds the token only to post it back. It renders ONE message for every failure, because the
// server answers one way for every failure: distinguishing "expired" from "already used" here would
// reintroduce on the client precisely the oracle the database and the route were built to avoid.

import { useState } from "react";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "refused">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("working");
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      setState(res.ok ? "done" : "refused");
    } catch {
      setState("refused");
    }
  }

  if (state === "done") {
    return (
      <div>
        <p className="mb-6 text-sm text-[var(--color-t1)]">
          Your password is set. You can sign in now.
        </p>
        <a href="/login" className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-sm">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={12}
        required
        autoComplete="new-password"
        placeholder="At least 12 characters"
        className="mb-4 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={state === "working"}
        className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-2 text-sm"
      >
        {state === "working" ? "Setting…" : "Set password"}
      </button>
      {state === "refused" && (
        // ONE message. Never which of the four reasons it was.
        <p className="mt-4 text-sm text-[var(--color-danger)]">
          This link can&rsquo;t be used. Ask the account owner for a new one.
        </p>
      )}
    </form>
  );
}
