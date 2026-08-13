"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalSignForm({ token, requestId }: { token: string; requestId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = name.trim().length > 1 && signature.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/portal/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          request_id: requestId,
          by_name: name.trim(),
          signature_text: signature.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Sign failed");
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">your full name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pilar Rodriguez"
          className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          type your name to sign
        </span>
        <input
          type="text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Type your name exactly as above"
          className="rounded-md border-2 border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-3 font-serif text-lg italic text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          This typed name + timestamp serves as your signature. It is recorded permanently and cannot be undone.
        </span>
      </label>
      {err && <p className="font-mono text-xs text-[var(--color-danger)]">{err}</p>}
      <button
        type="submit"
        disabled={!valid || busy}
        className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-[var(--color-bg)] shadow-[0_0_18px_-4px_var(--color-accent)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Signing…" : "✓ Sign &amp; approve"}
      </button>
    </form>
  );
}
