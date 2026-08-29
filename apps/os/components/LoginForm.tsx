"use client";

import { useState } from "react";

/**
 * Operator sign-in. Posts the password to /api/auth/login, which sets an httpOnly session cookie —
 * the password and the session are never readable from client JavaScript.
 */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation so the new cookie is presented to middleware on the next request.
        window.location.href = next;
        return;
      }
      setError("Incorrect password.");
      setEmail("");
      setPassword("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-invalid={error !== null}
        className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)] focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
      />
      <label htmlFor="password" className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? "login-error" : undefined}
        className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)] focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
      />
      {error && (
        <p id="login-error" role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-2 font-mono text-xs uppercase tracking-widest text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}