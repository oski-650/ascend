import "server-only";
import type {
  AuditOpportunity,
  AuditStrategy,
  CoreWebVitals,
  LighthouseScores,
} from "./audits";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

export type PsiResult = {
  scores: LighthouseScores;
  cwv: CoreWebVitals;
  opportunities: AuditOpportunity[];
  fetched_url?: string;
};

function pctScore(audit: unknown): number | null {
  if (audit && typeof audit === "object" && "score" in audit) {
    const s = (audit as { score: unknown }).score;
    if (typeof s === "number") return Math.round(s * 100);
  }
  return null;
}

function numericValue(audit: unknown): number | null {
  if (audit && typeof audit === "object" && "numericValue" in audit) {
    const n = (audit as { numericValue: unknown }).numericValue;
    if (typeof n === "number") return Math.round(n);
  }
  return null;
}

function clsValue(audit: unknown): number | null {
  if (audit && typeof audit === "object" && "numericValue" in audit) {
    const n = (audit as { numericValue: unknown }).numericValue;
    if (typeof n === "number") return Math.round(n * 1000) / 1000;
  }
  return null;
}

export async function runPsiAudit(
  url: string,
  strategy: AuditStrategy,
  timeoutMs = 60_000
): Promise<PsiResult> {
  const u = new URL(PSI_ENDPOINT);
  u.searchParams.set("url", url);
  u.searchParams.set("strategy", strategy);
  for (const c of CATEGORIES) u.searchParams.append("category", c);
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) u.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(u.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        apiKey
          ? "PageSpeed Insights 429 — your API key hit its quota. Wait a minute or check Cloud Console quotas."
          : "PageSpeed Insights 429 — anonymous rate limit. Get a free API key (https://console.cloud.google.com/apis/credentials, enable PageSpeed Insights API), then set PAGESPEED_API_KEY in apps/os/.env.local and restart."
      );
    }
    const body = await res.text().catch(() => "");
    throw new Error(`PageSpeed Insights returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await res.json()) as Record<string, unknown>;
  const lighthouse = payload.lighthouseResult as Record<string, unknown> | undefined;
  if (!lighthouse) throw new Error("PSI response missing lighthouseResult");

  const cats = lighthouse.categories as Record<string, { score: number | null }> | undefined;
  const audits = (lighthouse.audits as Record<string, unknown>) ?? {};

  const scores: LighthouseScores = {
    performance: cats?.performance?.score != null ? Math.round(cats.performance.score * 100) : null,
    accessibility: cats?.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : null,
    best_practices:
      cats?.["best-practices"]?.score != null ? Math.round(cats["best-practices"].score * 100) : null,
    seo: cats?.seo?.score != null ? Math.round(cats.seo.score * 100) : null,
  };

  const cwv: CoreWebVitals = {
    lcp_ms: numericValue(audits["largest-contentful-paint"]),
    fcp_ms: numericValue(audits["first-contentful-paint"]),
    cls: clsValue(audits["cumulative-layout-shift"]),
    ttfb_ms: numericValue(audits["server-response-time"]),
    inp_ms: numericValue(audits["interaction-to-next-paint"]),
  };

  // Pull top opportunities (largest savings first).
  const opportunities: AuditOpportunity[] = Object.entries(audits)
    .map(([id, raw]) => {
      const a = raw as { title?: string; details?: { type?: string; overallSavingsMs?: number } };
      if (!a || a.details?.type !== "opportunity") return null;
      return {
        id,
        title: typeof a.title === "string" ? a.title : id,
        savings_ms: typeof a.details.overallSavingsMs === "number" ? Math.round(a.details.overallSavingsMs) : null,
      };
    })
    .filter((o): o is AuditOpportunity => o !== null && (o.savings_ms ?? 0) > 0)
    .sort((a, b) => (b.savings_ms ?? 0) - (a.savings_ms ?? 0))
    .slice(0, 5);

  return {
    scores,
    cwv,
    opportunities,
    fetched_url: (lighthouse.finalUrl as string | undefined) ?? url,
  };
}
