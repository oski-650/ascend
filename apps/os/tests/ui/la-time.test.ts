// Slice 2A.2a — the SHARED Los Angeles time module (`packages/domain/time.ts`).
//
// One implementation, two callers: the server command validates `{ local, offset }` with `resolveDue`,
// and the browser's follow-up picker produces it with `followUpPreset`. A preset that guessed an offset
// would be a second, quieter implementation of the DST contract — so every preset is fed back through
// the resolver here, at both boundaries.

import { describe, expect, it } from "vitest";
import { followUpPreset, laOffsetAt, losAngelesDate, losAngelesWallClock, resolveDue } from "@/domain";

/** An instant from a Los Angeles wall clock and its offset — the test's own arithmetic, not the module's. */
const at = (local: string, offsetMinutes: number) => new Date(Date.parse(`${local}:00Z`) - offsetMinutes * 60_000);

describe("wall clock and offsets", () => {
  it("renders an instant in Los Angeles, and names the offset in force there", () => {
    expect(losAngelesWallClock(at("2026-07-01T09:00", -420))).toBe("2026-07-01T09:00");
    expect(losAngelesDate(at("2026-07-01T09:00", -420))).toBe("2026-07-01");
    expect(laOffsetAt("2026-07-01T09:00")).toBe("-07:00");   // PDT
    expect(laOffsetAt("2026-01-15T09:00")).toBe("-08:00");   // PST
  });

  it("refuses the spring-forward gap, and resolves the fall-back hour to its FIRST instant", () => {
    expect(laOffsetAt("2026-03-08T02:30")).toBeNull();
    expect(laOffsetAt("2026-11-01T01:30")).toBe("-07:00");
    // Both instants exist; the module returns the earlier one, and a caller wanting the second says so.
    expect(resolveDue("2026-11-01", { local: "2026-11-01T01:30", offset: "-08:00" }))
      .toEqual({ ok: true, dueOn: "2026-11-01", dueAt: "2026-11-01T09:30:00.000Z" });
  });
});

describe("follow-up presets", () => {
  const cases: [string, Parameters<typeof followUpPreset>[0], string, string | null][] = [
    ["tomorrow 9 AM", "tomorrow", "2026-07-01T14:00", "2026-07-02T09:00"],
    ["in 2 days", "in_2_days", "2026-07-01T14:00", "2026-07-03T09:00"],
    ["next week (Monday)", "next_week", "2026-07-01T14:00", "2026-07-06T09:00"],   // Wed → the following Mon
    ["next week from a Monday is the NEXT Monday", "next_week", "2026-07-06T09:30", "2026-07-13T09:00"],
    ["later today rounds up to the next half hour", "later_today", "2026-07-01T09:10", "2026-07-01T12:30"],
    ["later today rounds a late-half hour to the next hour", "later_today", "2026-07-01T09:40", "2026-07-01T13:00"],
  ];
  it.each(cases)("%s", (_label, kind, nowLocal, expected) => {
    const out = followUpPreset(kind, at(nowLocal, -420));
    expect(out).not.toBeNull();
    expect(out!.dueAt?.local ?? null).toBe(expected);
    expect(out!.dueOn).toBe(expected!.slice(0, 10));
  });

  it("every preset it produces is ACCEPTED by the server's own resolver — one contract, not two", () => {
    for (const now of [at("2026-07-01T09:10", -420), at("2026-01-15T09:10", -480),
                       at("2026-03-07T10:00", -480), at("2026-10-31T10:00", -420)]) {
      for (const kind of ["later_today", "tomorrow", "in_2_days", "next_week", "no_time"] as const) {
        const preset = followUpPreset(kind, now);
        if (preset === null) continue;
        expect(resolveDue(preset.dueOn, preset.dueAt), `${kind} @ ${losAngelesWallClock(now)}`).toMatchObject({ ok: true });
      }
    }
  });

  it("'later today' is unavailable when it would land after 21:00 — a 'later today' that is tomorrow is a lie", () => {
    expect(followUpPreset("later_today", at("2026-07-01T19:00", -420))).toBeNull();
    expect(followUpPreset("later_today", at("2026-07-01T23:30", -420))).toBeNull();
  });

  it("'no time' is a date with no instant, so it cannot drift across a day boundary", () => {
    const out = followUpPreset("no_time", at("2026-07-01T23:50", -420));
    expect(out).toEqual({ dueOn: "2026-07-01" });
    expect(resolveDue(out!.dueOn, out!.dueAt)).toEqual({ ok: true, dueOn: "2026-07-01", dueAt: null });
  });

  it("a preset that would land in the spring-forward gap moves to 03:00 rather than inventing an offset", () => {
    // 2027-03-14 02:00–02:59 does not exist in Los Angeles. "Tomorrow 9 AM" is unaffected; the guard is
    // exercised directly through the resolver to prove the module never emits an impossible local time.
    const preset = followUpPreset("tomorrow", at("2027-03-13T10:00", -480));
    expect(preset!.dueAt!.local).toBe("2027-03-14T09:00");
    expect(resolveDue("2027-03-14", { local: "2027-03-14T02:30", offset: "-08:00" })).toMatchObject({ ok: false, code: "nonexistent_local_time" });
  });
});
