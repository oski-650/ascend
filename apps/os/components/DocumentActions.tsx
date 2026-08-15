"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
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
          <Button key={t.to} type="button" onClick={() => patch(t.to)} disabled={busy !== null}>
            {busy === `status:${t.to}` ? "…" : t.label}
          </Button>
        ))}
        {/* Amber is earned: versioning is the one action here that creates a new document. */}
        <Button
          type="button"
          onClick={newVersion}
          disabled={busy !== null || currentStatus === "superseded"}
          variant="primary"
        >
          {busy === "version" ? "…" : "Create next version"}
        </Button>
      </div>
      {err && <span className="t-meta text-[var(--color-risk)]">{err}</span>}
    </div>
  );
}
