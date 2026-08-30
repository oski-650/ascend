// core/finance/care.ts — care-plan (retainer) reads (moved from lib/care.ts, Phase 2.4).
// Kept INFERRED (D6 explicit CarePlan entity deferred) — behavior-preserving migration.
// Reads client business_context + invoices via core/vault primitives.

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { listSubdirs } from "@/core/vault/io";
import { readMarkdownFile } from "@/core/vault/markdown";
import { listInvoices } from "./invoice";
import { requireCapability } from "@/core/auth/authority";

/**
 * How long a paid care invoice keeps implying an active retainer.
 *
 * NAMED, not buried. This was an inline `60` inside the read below — a domain rule with no name,
 * living in a function that looks like a getter. It says: a care payment is evidence of an ongoing
 * arrangement for this long, and after that it is only evidence of a past payment.
 *
 * It is a judgement, not a measurement, and it belongs to the domain rather than to this reader.
 * Changing it changes which clients Ascend believes are on retainer.
 */
export const CARE_INVOICE_IMPLIES_ACTIVE_DAYS = 60;

/**
 * Where a `retainer_active` value came from.
 *
 * `declared`  the operator wrote `retainer_active: true` in business_context.md
 * `inferred`  no flag, but a care invoice was paid inside the window above
 * `none`      neither — the client is not on a retainer as far as Ascend knows
 *
 * Carried because the two paths were previously indistinguishable: a consumer could not tell a
 * recorded fact from an inference, and `retainer_started` was presented as a date the operator had
 * written down when it had actually been back-filled from an invoice. This is READ-MODEL
 * provenance — it is derived per read and never written to the vault.
 */
export type RetainerSource = "declared" | "inferred" | "none";

export type CareClient = {
  slug: string;
  name: string;
  website: string;
  retainer_active: boolean;
  retainer_started?: string;
  /** Provenance of `retainer_active` / `retainer_started` — see RetainerSource. */
  retainer_active_source: RetainerSource;
  last_care_invoice?: { paid_at: string; amount_usd: number; label: string } | null;
};

export async function listCareClients(): Promise<CareClient[]> {
  await requireCapability("finance:*");
  const dir = crmDir();
  const slugs = await listSubdirs(dir);
  const invoices = await listInvoices();

  const out: CareClient[] = [];
  for (const slug of slugs) {
    const md = await readMarkdownFile(path.join(dir, slug, "business_context.md"));
    if (md.missing) continue;
    const fm = md.frontmatter;
    const name = (fm.name as string | undefined) ?? (fm.business as string | undefined) ?? slug;
    const website = (fm.website as string | undefined) ?? "";
    let retainer_active = fm.retainer_active === true;
    let retainer_started = fm.retainer_started as string | undefined;
    let retainer_active_source: RetainerSource = retainer_active ? "declared" : "none";

    const careInvoices = invoices
      .filter((i) => i.client === slug && i.paid_at)
      .filter((i) => /care plan|retainer|maintenance/i.test(i.label))
      .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
    const last = careInvoices[0];

    // EVIDENCE OVERRIDES A STALE FLAG. A recently paid care invoice implies an active retainer even
    // when nobody set the flag — an invoice is evidence, and better evidence than an unmaintained
    // boolean. The inference is kept; what changes is that its result is now labelled, so no
    // consumer mistakes it for something the operator recorded.
    if (!retainer_active && last) {
      const daysSinceLastCare = Math.floor((Date.now() - new Date(last.paid_at as string).getTime()) / 86400_000);
      if (daysSinceLastCare <= CARE_INVOICE_IMPLIES_ACTIVE_DAYS) {
        retainer_active = true;
        retainer_active_source = "inferred";
        // Back-filled from the payment, NOT recorded by the operator — hence the source label.
        retainer_started = retainer_started ?? (last.paid_at as string).slice(0, 10);
      }
    }

    out.push({
      slug,
      name,
      website,
      retainer_active,
      retainer_started,
      retainer_active_source,
      last_care_invoice: last
        ? { paid_at: last.paid_at as string, amount_usd: last.amount_usd, label: last.label }
        : null,
    });
  }

  return out.sort((a, b) => {
    if (a.retainer_active !== b.retainer_active) return a.retainer_active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
