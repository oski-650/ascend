"use client";

// components/InvitePartnerPanel — the owner mints an invitation and copies the link (§28.4).
//
// Same shape as `InviteLinkPanel`, and NOT the same mechanism. That file issues CLIENT PORTAL
// tokens through `lib/portal`; this one issues OPERATOR invitations through `core/auth/invitations`.
// Same English word, different security primitive (§28.8) — this component reaches the operator
// route and nothing else, and F58 enforces that it stays that way.
//
// ─── THE TOKEN LIVES IN THIS COMPONENT'S STATE AND NOWHERE ELSE ────────────────────────────────
//
// The server returns it exactly once, because only its SHA-256 digest reaches the table. It is not
// written to localStorage, not put in the URL, and not re-fetchable — a reload loses it, which is
// correct: there is no "show me that link again", only "mint another one".

import { useState } from "react";
import { Button } from "@/components/primitives";
import { FORM_ERROR_CLASS } from "@/components/primitives/form";

/**
 * There is deliberately no "has a password yet" flag here.
 *
 * `005` revoked the table grant on `users` and replaced it with a column list; `ascend_owner` cannot
 * read `password_hash` or `password_set_at` at all. Showing that badge would have cost a GRANT, and
 * §28.3 forbids 2G.3 from adding one. See core/auth/directory for the measurement.
 */
export type InviteCandidate = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

type Minted = { token: string; id: string; expiresAt: string };

export function InvitePartnerPanel({
  candidates,
  baseUrl,
}: {
  candidates: InviteCandidate[];
  baseUrl: string;
}) {
  const [selected, setSelected] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = minted ? `${baseUrl}/invite/${minted.token}` : null;

  async function mint() {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selected }),
      });
      if (!res.ok) {
        // The server distinguishes its failures (§28.4) and this surfaces that distinction, because
        // the operator is the person who can act on it. There is no token to protect here — a
        // failed mint produced none.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? "The invitation could not be issued.");
        return;
      }
      setMinted((await res.json()) as Minted);
    } catch {
      setErr("The invitation could not be issued.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-[var(--color-t2)]">
        Nobody to invite. People are provisioned outside this screen — an invitation sets a password
        for an account that already exists, and never creates one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="t-label text-[var(--color-t3)]">Person</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} · {c.role}
            </option>
          ))}
        </select>
      </label>

      <div>
        <Button onClick={mint} disabled={busy || selected === ""}>
          {busy ? "Issuing…" : "Issue invitation link"}
        </Button>
      </div>

      {err && <p className={FORM_ERROR_CLASS}>{err}</p>}

      {url && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
          <span className="t-label text-[var(--color-t3)]">
            One-time link · expires {new Date(minted!.expiresAt).toLocaleString()}
          </span>
          {/* Shown so the operator can verify what they are about to send. It is already in their
              browser; the thing that matters is that it never reached a log or a mail server. */}
          <code className="t-mono break-all text-xs text-[var(--color-t1)]">{url}</code>
          <div>
            <Button onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
          <p className="text-xs text-[var(--color-t2)]">
            Send it directly to the person. It is not stored anywhere — closing this page loses it,
            and issuing another link is the only way to get one.
          </p>
        </div>
      )}

      {/* §28.3 requires this in plain words. It is a real state property, not reassurance: the owner
          role holds no UPDATE on invitations, so a link cannot be revoked — only outlived. */}
      <p className="text-xs text-[var(--color-t2)]">
        Multiple active invitation links can exist for this partner. Each link can be used once and
        expires automatically.
      </p>
    </div>
  );
}
