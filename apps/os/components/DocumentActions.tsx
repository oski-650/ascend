"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentStatus } from "@/lib/documentTypes";

type Props = {
  docId: string;
  currentStatus: DocumentStatus;
};

const NEXT_TRANSITIONS: Partial<Record<DocumentStatus, { label: string; to: DocumentStatus }[]>> = {
  draft: [{ label: "Mark sent", to: "sent" }],
  sent: [
    { label: "Mark accepted", to: "accepted" },
    { label: "Back to draft", to: "draft" },
  ],
  accepted: [{ label: "Back to sent", to: "sent" }],
};

export function DocumentActions({ docId, currentStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function patch(status: DocumentStatus) {
    setBusy(`status:${status}`);
    setErr(null);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function newVersion() {
    setBusy("version");
    setErr(null);
    try {
      const res = await fetch(`/api/documents/${docId}/version`, { method: "POST" });
      const json = (await res.json()) as { document?: { meta: { doc_id: string } }; error?: string };
      if (!res.ok || !json.document) {
        setErr(json.error ?? "Failed");
        return;
      }
      router.push(`/documents/${json.document.meta.doc_id}`);
    } finally {
      setBusy(null);
    }
  }

  const transitions = NEXT_TRANSITIONS[currentStatus] ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <button
            key={t.to}
            type="button"
            onClick={() => patch(t.to)}
            disabled={busy !== null}
            className="rounded-md border border-[var(--color-border-hi)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-fg-mute)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            {busy === `status:${t.to}` ? "…" : t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={newVersion}
          disabled={busy !== null || currentStatus === "superseded"}
          className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
        >
          {busy === "version" ? "…" : "⏶ Create v" + "next"}
        </button>
      </div>
      {err && <span className="font-mono text-[10px] text-[var(--color-danger)]">{err}</span>}
    </div>
  );
}
