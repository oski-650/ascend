// Layer A — Forecast (Phase 6.1) contract tests.
//
// Frozen contract: a forward-looking probabilistic EXTRAPOLATION with honest confidence. Never a
// recommendation, ranking, or priority. Pure and deterministic: `now` is INJECTED, no clock, no
// randomness, no fs/core/lib import.
//
// OWNERSHIP (D3 — recorded as an OPEN architectural-review item, NOT resolved here): lib/forecast
// remains the canonical owner of the weighted-$ mathematics (STATUS_PROBABILITY / ASSUMED_DEAL_VALUE
// / pipeline90d). This engine COMPOSES numbers already derived there and passed in via ForecastInput.
// The tests below therefore assert that the engine consumes its inputs verbatim and re-derives no
// pipeline mathematics of its own. They encode the CURRENT implementation boundary; they do not
// adjudicate where ownership ought to live. Layer B rule F9 guards the other half.

import { describe, expect, it } from "vitest";
import { deriveForecast, type ForecastInput } from "@/engines/intelligence-engine/forecast";

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  thisMonthReceived: 0,
  thisMonthTarget: 0,
  pipeline90d: 0,
  pipelineProspectCount: 0,
  ...over,
});

// Day 2 of a 30-day month ⇒ elapsed fraction ≈ 0.067 (< 0.2 early-month guard).
const EARLY = new Date("2026-06-02T12:00:00.000Z");
// Day 15 of 30 ⇒ 0.5 (≥ 0.2, < 0.6).
const MID = new Date("2026-06-15T12:00:00.000Z");
// Day 25 of 30 ⇒ 0.833 (≥ 0.6).
const LATE = new Date("2026-06-25T12:00:00.000Z");

describe("forecast · rule set + ordering", () => {
  it("derives exactly the two V1 forecasts, ordered by metric", () => {
    const forecasts = deriveForecast(input(), MID);
    expect(forecasts.map((f) => f.metric)).toEqual(["collections.month_end", "pipeline.90d"]);
  });
});

describe("forecast · early-month honesty guard", () => {
  it("does NOT extrapolate a tiny sample into a false month-end figure", () => {
    const collections = deriveForecast(input({ thisMonthReceived: 500 }), EARLY)[0];
    // Must report what is actually collected, un-extrapolated.
    expect(collections.projected).toBe(500);
    expect(collections.confidence).toBe("low");
    expect(collections.statement).toContain("too early");
  });

  it("begins extrapolating once past the early-month threshold", () => {
    const collections = deriveForecast(input({ thisMonthReceived: 500 }), MID)[0];
    expect(collections.projected).toBeGreaterThan(500);
    expect(collections.statement).toContain("On pace");
  });
});

describe("forecast · confidence ladders", () => {
  it("rates month-end confidence medium in mid-month and high late-month", () => {
    expect(deriveForecast(input({ thisMonthReceived: 1000 }), MID)[0].confidence).toBe("medium");
    expect(deriveForecast(input({ thisMonthReceived: 1000 }), LATE)[0].confidence).toBe("high");
  });

  it("rates pipeline confidence by prospect count: <3 low, <8 medium, else high", () => {
    const at = (n: number) =>
      deriveForecast(input({ pipeline90d: 10000, pipelineProspectCount: n }), MID)[1].confidence;
    expect(at(2)).toBe("low");
    expect(at(3)).toBe("medium");
    expect(at(7)).toBe("medium");
    expect(at(8)).toBe("high");
  });
});

describe("forecast · thin/absent pipeline honesty", () => {
  it("reports insufficient data rather than projecting from nothing", () => {
    const pipeline = deriveForecast(input({ pipelineProspectCount: 0, pipeline90d: 0 }), MID)[1];
    expect(pipeline.projected).toBe(0);
    expect(pipeline.confidence).toBe("low");
    expect(pipeline.statement).toContain("No active pipeline");
  });

  it("treats a non-positive weighted pipeline as no pipeline", () => {
    const pipeline = deriveForecast(input({ pipeline90d: -50, pipelineProspectCount: 5 }), MID)[1];
    expect(pipeline.projected).toBe(0);
    expect(pipeline.confidence).toBe("low");
  });
});

describe("forecast · consumes inputs verbatim (no re-derived pipeline math)", () => {
  it("projects exactly the supplied weighted pipeline figure", () => {
    // If the engine re-implemented STATUS_PROBABILITY / ASSUMED_DEAL_VALUE, this arbitrary value
    // could not survive unchanged.
    const pipeline = deriveForecast(input({ pipeline90d: 73_219, pipelineProspectCount: 9 }), MID)[1];
    expect(pipeline.projected).toBe(73_219);
  });

  it("credits lib/forecast as the basis rather than claiming its own derivation", () => {
    for (const forecast of deriveForecast(input({ thisMonthReceived: 100 }), MID)) {
      expect(forecast.basis.join(" ")).toContain("lib/forecast");
    }
  });
});

describe("forecast · target arithmetic safety", () => {
  it("omits the percentage clause when the target is zero — no divide-by-zero", () => {
    const collections = deriveForecast(input({ thisMonthReceived: 1000, thisMonthTarget: 0 }), MID)[0];
    expect(collections.statement).not.toContain("NaN");
    expect(collections.statement).not.toContain("Infinity");
    expect(collections.statement).not.toContain("% of");
  });

  it("includes the percentage clause when a target is set", () => {
    const collections = deriveForecast(
      input({ thisMonthReceived: 1000, thisMonthTarget: 4000 }),
      MID
    )[0];
    expect(collections.statement).toContain("% of");
  });
});

describe("forecast · injected clock determinism", () => {
  it("stamps computedAt from the injected now", () => {
    for (const forecast of deriveForecast(input(), MID)) {
      expect(forecast.computedAt).toBe(MID.toISOString());
    }
  });

  it("derives the month-end horizon from the injected now, not the system clock", () => {
    // Asserted timezone-independently on purpose. The engine builds month-end with
    // `new Date(y, m + 1, 0, 23, 59, 59)` — LOCAL-time construction serialised to UTC — so the
    // literal string is machine-dependent (on America/Los_Angeles it is 2026-07-01T06:59:59Z,
    // on UTC it is 2026-06-30T23:59:59Z). That timezone sensitivity is EXISTING behaviour of a
    // frozen engine and is recorded as an architectural-review item rather than changed here.
    // What the contract genuinely promises is that the horizon follows the injected `now`.
    const june = deriveForecast(input(), MID)[0];
    const december = deriveForecast(input(), new Date("2026-12-15T12:00:00.000Z"))[0];

    expect(new Date(june.horizon.until).getTime()).toBeGreaterThan(MID.getTime());
    // Month-end is at most ~31 days past a mid-month `now`.
    expect(new Date(june.horizon.until).getTime() - MID.getTime()).toBeLessThan(31 * 86_400_000);
    // A different injected month must produce a different horizon.
    expect(december.horizon.until).not.toBe(june.horizon.until);
    expect(new Date(december.horizon.until).getFullYear()).toBe(2026);
  });

  it("derives the 90-day pipeline horizon purely by offset from the injected now", () => {
    // This horizon uses plain millisecond arithmetic, so it IS timezone-independent.
    const pipeline = deriveForecast(input(), MID)[1];
    expect(pipeline.horizon.until).toBe(new Date(MID.getTime() + 90 * 86_400_000).toISOString());
  });

  it("produces identical output for identical (input, now)", () => {
    const i = input({ thisMonthReceived: 1234, pipeline90d: 5678, pipelineProspectCount: 4 });
    expect(deriveForecast(i, MID)).toEqual(deriveForecast(i, MID));
  });
});

describe("forecast · ownership boundary", () => {
  it("carries confidence but never a recommendation, priority, or rank", () => {
    for (const forecast of deriveForecast(input({ thisMonthReceived: 100 }), MID)) {
      expect(forecast).toHaveProperty("confidence");
      expect(forecast).not.toHaveProperty("priorityScore");
      expect(forecast).not.toHaveProperty("rank");
      expect(forecast).not.toHaveProperty("action");
      expect(forecast.statement.toLowerCase()).not.toMatch(/\byou should\b|\brecommend/);
    }
  });
});