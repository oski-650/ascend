// components/sales/FindWebsiteButton — "look for this business's website".
//
// It decides nothing and reports exactly what came back, including the outcome that is easiest to
// misreport: NOT FOUND. The wording there is load-bearing — "no site found at the addresses tried"
// rather than "no website" — because the second is a claim about the business that neither this
// component nor the runner behind it is entitled to make.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

type Probe = { domain: string; reachable: boolean; status: number | null; error: string | null };

type Result =
  | { kind: "found"; website: string; basis: string }
  | { kind: "not_found"; tried: Probe[] }
  | { kind: "already_known"; website: string }
  | { kind: "no_candidates" };

const BASIS_LABEL: Record<string, string> = {
  contact_email_domain: "from the contact's email domain",
  business_name_guess: "guessed from the business name",
};

export function FindWebsiteButton({ prospect }: { prospect: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/prospects/${encodeURIComponent(prospect)}/research`, {
        method: "POST",
      });
      const json = (await res.json()) as { result?: Result; error?: string };
      if (!res.ok) {
        setErr(json.error ?? "Research failed");
        return;
      }
      setResult(json.result ?? null);
      // A found site changed the row; re-read rather than patching it in here.
      if (json.result?.kind === "found") router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        {/* The shared primitive, not a bespoke pill — see CopyTargetButton's header. */}
        <Button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? "Looking…" : "Find website"}
        </Button>
      </div>

      {err && <p className="font-mono text-[11px] text-[var(--color-danger)]">{err}</p>}

      {result?.kind === "found" && (
        <p className="text-xs text-[var(--color-accent)]">
          Found <span className="font-mono">{result.website}</span>{" "}
          <span className="text-[var(--color-fg-dim)]">— {BASIS_LABEL[result.basis] ?? result.basis}</span>
        </p>
      )}

      {result?.kind === "already_known" && (
        <p className="text-xs text-[var(--color-fg-mute)]">
          Already recorded: <span className="font-mono">{result.website}</span>. Nothing was changed.
        </p>
      )}

      {result?.kind === "no_candidates" && (
        <p className="max-w-prose text-xs text-[var(--color-fg-mute)]">
          Nothing to go on — this record has no company email domain and no usable business name.
        </p>
      )}

      {/* THE CAREFUL ONE. Ascend looked and found nothing; that is a fact about the search, not
          about the business. Nothing was written to the prospect and the score is unchanged. */}
      {result?.kind === "not_found" && (
        <div className="max-w-prose text-xs text-[var(--color-fg-mute)]">
          <p>
            No site answered at the addresses tried. Nothing was recorded — this is not evidence that
            the business has no website, so the score is unchanged.
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {result.tried.map((p) => (
              <li key={p.domain} className="font-mono text-[11px] text-[var(--color-fg-dim)]">
                ○ {p.domain} — {p.error ?? "no answer"}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-[var(--color-fg-dim)]">
            If you confirm by hand that they have no site, record it as your own assessment.
          </p>
        </div>
      )}
    </div>
  );
}
