// core/finance/revenue.ts — contracted-revenue resolution (moved from lib/ehr.ts, Phase 2.4).
// A financial FACT: `revenue_usd` override on project_scope.md, else `package` → TIER_PRICES.
// (EHR / profitability is INTERPRETATION and stays out of core/finance — see clarification 3.)

import "server-only";
import path from "node:path";
import { crmDir } from "@/core/vault/paths";
import { readMarkdownFile } from "@/core/vault/markdown";
import { TIER_PRICES, normalizeTier } from "@/domain";

const SCOPE_FILE = "project_scope.md";

export async function getClientRevenue(clientSlug: string): Promise<number | null> {
  const md = await readMarkdownFile(path.join(crmDir(), clientSlug, SCOPE_FILE));
  if (md.missing) return null;
  const fm = md.frontmatter as { revenue_usd?: unknown; package?: unknown };

  if (typeof fm.revenue_usd === "number" && Number.isFinite(fm.revenue_usd)) {
    return fm.revenue_usd;
  }
  if (typeof fm.revenue_usd === "string" && fm.revenue_usd.trim() !== "") {
    const n = Number(fm.revenue_usd.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const tier = normalizeTier(fm.package);
  if (tier) return TIER_PRICES[tier];
  return null;
}
