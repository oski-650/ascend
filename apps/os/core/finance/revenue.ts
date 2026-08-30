// core/finance/revenue.ts — contracted-revenue resolution (moved from lib/ehr.ts, Phase 2.4).
//
// A CONTRACT VALUE IS EVIDENCE, NOT A LOOKUP (docs/COMMERCIAL-PROVENANCE.md §4.1).
//
// This function used to fall back to `package` → TIER_PRICES when no contract value was recorded,
// so "nobody wrote down what we agreed" became "this client is worth the Growth list price". Three
// of four clients in the real vault reported $2,497 that way, every one traceable to a scaffold
// literal or to the `promote.ts` default — and `revenue_usd` was absent everywhere, meaning the
// catalog branch was the ONLY path this function ever took against real data.
//
// A tier says what a package LISTS at. It cannot say what was agreed: contracts are discounted,
// staged, customised, or never signed. Those are four different facts and one number cannot be all
// of them, so an unrecorded contract value now resolves to `null` — unknown, never $0 (H2 §11).
//
// The catalog remains available as reference data via TIER_PRICES, but no finance path may consult
// it to answer this question. Enforced by F26.
//
// (EHR / profitability is INTERPRETATION and stays out of core/finance — see clarification 3.)

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { readMarkdownFile } from "@/core/vault/markdown";
import { requireCapability } from "@/core/auth/authority";

const SCOPE_FILE = "project_scope.md";

export async function getClientRevenue(clientSlug: string): Promise<number | null> {
  await requireCapability("finance:*");
  const md = await readMarkdownFile(path.join(crmDir(), clientSlug, SCOPE_FILE));
  if (md.missing) return null;
  const fm = md.frontmatter as { revenue_usd?: unknown };

  if (typeof fm.revenue_usd === "number" && Number.isFinite(fm.revenue_usd)) {
    return fm.revenue_usd;
  }
  if (typeof fm.revenue_usd === "string" && fm.revenue_usd.trim() !== "") {
    const n = Number(fm.revenue_usd.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  // No recorded contract value ⇒ UNKNOWN. Not the catalog price, and not zero.
  return null;
}
