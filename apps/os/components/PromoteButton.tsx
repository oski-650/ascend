"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { routeForEntity } from "@/navigation/routing";
import { Button } from "@/components/primitives";
import {
  FIELD_LABEL_CLASS,
  FORM_ERROR_CLASS,
  INPUT_CLASS,
  SELECT_CLASS,
} from "@/components/primitives/form";

const TEMPLATES = [
  { value: "generic", label: "Generic (default)" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "cleaning", label: "Cleaning" },
];

const PACKAGES = [
  { value: "starter", label: "Starter ($1,257)" },
  { value: "growth", label: "Growth ($2,497)" },
  { value: "ascend-pro", label: "Ascend Pro ($3,127)" },
];

export function PromoteButton({
  prospectSlug,
  prospectName,
  alreadyWon,
}: {
  prospectSlug: string;
  prospectName: string;
  alreadyWon: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientSlug, setClientSlug] = useState(prospectSlug);
  const [template, setTemplate] = useState("generic");
  const [packageTier, setPackageTier] = useState("growth");
  const [launchTarget, setLaunchTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/prospects/${prospectSlug}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_slug: clientSlug,
          template,
          package_tier: packageTier,
          launch_target: launchTarget || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Promotion failed");
        return;
      }
      // ACTION → ENTITY. Promotion creates a CLIENT, so it lands on the client view. It used to
      // follow the API's `links.production` into /production/:slug — the legacy checklist editor —
      // which dropped the operator out of the redesigned surface immediately after the single most
      // significant write in the product. The destination is resolved through navigation/routing,
      // the single owner; the API response is left untouched (its `links` are Increment 8's
      // concern) and this component simply stops consuming the wrong one.
      router.push(routeForEntity("client", clientSlug) ?? `/clients/${clientSlug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyWon) {
    return (
      <span className="t-label text-[var(--color-good)]">✓ already won</span>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="primary"
        title="Mark closed-won and create the CRM client + production tracking"
      >
        Promote to client
      </Button>
    );
  }

  return (
    <div className="border-l border-[var(--color-accent)]/45 pl-4">
      <p className="t-label mb-3 text-[var(--color-accent)]">
        promote {prospectName} → client
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>client slug</span>
          <input
            type="text"
            value={clientSlug}
            onChange={(e) => setClientSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            className={INPUT_CLASS}
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>production template</span>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className={SELECT_CLASS}
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>package tier</span>
            <select
              value={packageTier}
              onChange={(e) => setPackageTier(e.target.value)}
              className={SELECT_CLASS}
            >
              {PACKAGES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>launch target (optional)</span>
          <input
            type="date"
            value={launchTarget}
            onChange={(e) => setLaunchTarget(e.target.value)}
            className={SELECT_CLASS}
          />
        </label>
        <p className="t-meta text-[var(--color-t3)]">
          Creates: <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5">01 - CRM &amp; Clients/{clientSlug}/</code> with 4 profile files + <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5">production_state.md</code> from the {template} template. Marks prospect <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5">closed-won</code>. Opens the new client.
        </p>
        {err && <p className={FORM_ERROR_CLASS}>{err}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" onClick={() => setOpen(false)} disabled={busy} variant="quiet">
            Cancel
          </Button>
          <Button type="button" onClick={promote} disabled={busy || !clientSlug} variant="primary">
            {busy ? "Promoting…" : "Promote now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
