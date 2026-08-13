// core/finance/care.ts — care-plan (retainer) reads (moved from lib/care.ts, Phase 2.4).
// Kept INFERRED (D6 explicit CarePlan entity deferred) — behavior-preserving migration.
// Reads client business_context + invoices via core/vault primitives.

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { listSubdirs } from "@/core/vault/io";
import { readMarkdownFile } from "@/core/vault/markdown";
import { listInvoices } from "./invoice";

export type CareClient = {
  slug: string;
  name: string;
  website: string;
  retainer_active: boolean;
  retainer_started?: string;
  last_care_invoice?: { paid_at: string; amount_usd: number; label: string } | null;
};

export async function listCareClients(): Promise<CareClient[]> {
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

    const careInvoices = invoices
      .filter((i) => i.client === slug && i.paid_at)
      .filter((i) => /care plan|retainer|maintenance/i.test(i.label))
      .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
    const last = careInvoices[0];

    // Fallback: a recent (≤60d) paid care invoice implies an active retainer even without the flag.
    if (!retainer_active && last) {
      const daysSinceLastCare = Math.floor((Date.now() - new Date(last.paid_at as string).getTime()) / 86400_000);
      if (daysSinceLastCare <= 60) {
        retainer_active = true;
        retainer_started = retainer_started ?? (last.paid_at as string).slice(0, 10);
      }
    }

    out.push({
      slug,
      name,
      website,
      retainer_active,
      retainer_started,
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
