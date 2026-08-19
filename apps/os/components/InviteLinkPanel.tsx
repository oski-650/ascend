"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { FORM_ERROR_CLASS } from "@/components/primitives/form";

type Invite = { id: string; token: string; created_at: string };

export function InviteLinkPanel({
  clientSlug,
  invite,
  baseUrl,
}: {
  clientSlug: string;
  invite: Invite | null;
  baseUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const url = invite ? `${baseUrl}/portal/${invite.token}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  async function rotate() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!invite || !url) {
    return (
      <div>
        <p className="t-body max-w-[68ch] text-[var(--color-t2)]">
          No active invite. Generating one creates a unique URL this client can use to submit
          information and sign approvals.
        </p>
        <div className="mt-3">
          {/* Accent is earned: this issues real access to a third party. */}
          <Button type="button" onClick={rotate} disabled={busy} variant="primary">
            {busy ? "Generating…" : "Generate invite"}
          </Button>
        </div>
        {err && <p className={`mt-2 ${FORM_ERROR_CLASS}`}>{err}</p>}
      </div>
    );
  }

  return (
    <div>
      {/* The live URL is the fact; it is stated plainly and allowed to wrap rather than truncate —
          a half-shown invite link is not a link you can check. */}
      <p className="t-mono break-all text-[var(--color-t1)]">{url}</p>
      <p className="t-mono mt-1 text-[var(--color-t3)]">
        issued {new Date(invite.created_at).toLocaleDateString()} · anyone with this link can submit
        as this client
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={copy} variant="ghost">
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        {/* Rotating REVOKES the current link. That is destructive to whoever holds it, so it is
            the danger variant and says what it does rather than showing a bare ↻. */}
        <Button
          type="button"
          onClick={rotate}
          disabled={busy}
          variant="danger"
          title="Issues a new token and revokes the old one. The existing URL stops working immediately."
        >
          {busy ? "Rotating…" : "Rotate — revokes current link"}
        </Button>
      </div>
      {err && <p className={`mt-2 ${FORM_ERROR_CLASS}`}>{err}</p>}
    </div>
  );
}
