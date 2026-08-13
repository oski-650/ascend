// engines/intelligence-engine/forecast.ts — PURE forward-looking Forecast derivation (Phase 6.1).
//
// A SIBLING of the frozen deriveInsights (index.ts) — that file is UNTOUCHED. Insight answers "what
// changed?"; Forecast answers "where is it heading?" — a probabilistic EXTRAPOLATION with honest
// confidence. It is NEVER a recommendation, ranking, or priority (that is Decision). Pure and
// deterministic: `now` is INJECTED; no clock, no randomness, no fs, no core, no lib import. It COMPOSES
// numbers already computed by lib/forecast (passed in by the orchestrator) — it re-implements no
// existing forecast math; the only new derivation here is the month-end pace projection + confidence.

export type ForecastConfidence = "low" | "medium" | "high";

/** A forward-looking projection. Carries confidence, never a recommended action / score / priority. */
export type Forecast = {
  id: string;
  metric: string;
  statement: string;
  horizon: { until: string };
  projected: number;
  confidence: ForecastConfidence;
  basis: string[];
  computedAt: string;
};

/** Plain numbers gathered by the orchestrator (from lib/forecast + core reads). No lib/core types leak in. */
export type ForecastInput = {
  thisMonthReceived: number;
  thisMonthTarget: number;
  pipeline90d: number;
  pipelineProspectCount: number;
};

const DAY_MS = 86_400_000;

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Month-end collections at current pace. Small-N/early honesty: too early ⇒ no explosive extrapolation. */
function collectionsMonthEnd(input: ForecastInput, now: Date): Forecast {
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const fraction = now.getDate() / daysInMonth; // elapsed fraction of the month
  const until = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

  let projected: number;
  let confidence: ForecastConfidence;
  let statement: string;

  if (fraction < 0.2) {
    // Too early — do NOT extrapolate a tiny sample into a false month-end figure.
    projected = input.thisMonthReceived;
    confidence = "low";
    statement = `${usd(input.thisMonthReceived)} collected so far — too early (${Math.round(fraction * 100)}% into the month) for a reliable month-end projection.`;
  } else {
    projected = Math.round(input.thisMonthReceived / fraction);
    confidence = fraction < 0.6 ? "medium" : "high";
    const pct = input.thisMonthTarget > 0 ? ` (${Math.round((projected / input.thisMonthTarget) * 100)}% of ${usd(input.thisMonthTarget)} target)` : "";
    statement = `On pace for ~${usd(projected)} collected by month-end${pct}.`;
  }
  return {
    id: "collections.month_end",
    metric: "collections.month_end",
    statement,
    horizon: { until },
    projected,
    confidence,
    basis: ["lib/forecast.computeKpis", "invoices.paid_at"],
    computedAt: now.toISOString(),
  };
}

/** 90-day weighted pipeline. Small-N honesty: no/thin pipeline ⇒ low confidence, explicit. */
function pipeline90d(input: ForecastInput, now: Date): Forecast {
  const until = new Date(now.getTime() + 90 * DAY_MS).toISOString();
  let projected: number;
  let confidence: ForecastConfidence;
  let statement: string;

  if (input.pipelineProspectCount === 0 || input.pipeline90d <= 0) {
    projected = 0;
    confidence = "low";
    statement = "No active pipeline — insufficient data for a 90-day projection.";
  } else {
    projected = Math.round(input.pipeline90d);
    confidence = input.pipelineProspectCount < 3 ? "low" : input.pipelineProspectCount < 8 ? "medium" : "high";
    statement = `~${usd(projected)} weighted pipeline projected over the next 90 days (across ${input.pipelineProspectCount} active prospect${input.pipelineProspectCount === 1 ? "" : "s"}).`;
  }
  return {
    id: "pipeline.90d",
    metric: "pipeline.90d",
    statement,
    horizon: { until },
    projected,
    confidence,
    basis: ["lib/forecast.computeKpis", "prospect pipeline weighting"],
    computedAt: now.toISOString(),
  };
}

/**
 * Derive the two V1 forecasts — pure and deterministic given (input, now). Extrapolations with explicit
 * confidence only; no recommendation/priority. Stable order by metric.
 */
export function deriveForecast(input: ForecastInput, now: Date): Forecast[] {
  const forecasts = [collectionsMonthEnd(input, now), pipeline90d(input, now)];
  forecasts.sort((a, b) => a.metric.localeCompare(b.metric));
  return forecasts;
}
