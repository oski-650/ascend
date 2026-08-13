// mission-control/site-quality — the Site-Quality ORCHESTRATOR (Phase 9, MC-1/MC-3).
//
// Mission Control GATHERS audit records (via the existing lib/audits reader — SQ-7, not migrated) and
// INVOKES the pure engine; it computes no classification itself. Read-only: no writes, no events. The
// engine is clock-free, so nothing is injected.

import "server-only";
import { listAudits } from "@/lib/audits";
import { buildSiteQualityDigest, type SiteQualityDigest } from "@/engines/site-quality-engine";

export async function assembleSiteQuality(): Promise<SiteQualityDigest> {
  const audits = await listAudits();
  return buildSiteQualityDigest(audits);
}
