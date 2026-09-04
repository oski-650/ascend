// SLICE 8 — WHICH OBJECTS ACKNOWLEDGE A RECENT EVENT.
//
// The derivation is pure, so its rules are testable as values rather than pixels. Every rule here is
// epistemic before it is visual: each one exists to stop the picture asserting something the events
// do not say.
//
// The load-bearing one is the age gate. `graph-view/projection` builds its activity list from
// `readEvents({ limit: 60 })` — a COUNT bound. Membership in that list is not recency, and the test
// that proves the difference is the one where a qualifying-by-membership event is REJECTED by age.

import { describe, expect, it } from "vitest";
import {
  qualifyingActivations, ACTIVATION_WINDOW_MS, type ActivityRecord,
} from "@/components/galaxy/activity";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const record = (nodeId: string, occurredAt: string, id = `e:${nodeId}:${occurredAt}`): ActivityRecord =>
  ({ id, nodeId, occurredAt, summary: `something happened to ${nodeId}` });

const DRAWN = new Set(["client:acme", "client:borden", "project:rebuild", "task:alpha"]);
const run = (activity: ActivityRecord[], drawn = DRAWN, now = NOW) =>
  qualifyingActivations(activity, drawn, now);

describe("the window is a GATE on real age, not membership in the projection's list", () => {
  it("an event inside the window activates its node", () => {
    const out = run([record("client:acme", ago(2 * HOUR))]);
    expect([...out.keys()]).toEqual(["client:acme"]);
    expect(out.get("client:acme")?.summary).toBe("something happened to client:acme");
  });

  it("THE COUNT-BOUND TRAP · a list member older than the window does NOT activate", () => {
    // This is the whole reason the gate exists. `readEvents({ limit: 60 })` bounds by COUNT, so on a
    // quiet vault a months-old event sits at the top of the list. If membership were treated as
    // recency, that event would animate as though it had just happened.
    const stale = record("client:acme", ago(200 * 24 * HOUR));
    const out = run([stale]);
    expect(out.size, "an old event activated because it was in the activity list").toBe(0);
  });

  it("the boundary is inclusive at the window and exclusive beyond it", () => {
    expect(run([record("client:acme", ago(ACTIVATION_WINDOW_MS))]).size).toBe(1);
    expect(run([record("client:acme", ago(ACTIVATION_WINDOW_MS + 1))]).size).toBe(0);
  });

  it("a FUTURE timestamp does not activate", () => {
    // Ignored rather than clamped: clamping would present a clock error as a very recent event.
    const out = run([{ ...record("client:acme", new Date(NOW + HOUR).toISOString()) }]);
    expect(out.size).toBe(0);
  });

  it("a MALFORMED timestamp does not activate, and does not throw", () => {
    for (const bad of ["", "not-a-date", "2026-13-45T99:99:99Z", "yesterday"]) {
      expect(() => run([record("client:acme", bad)])).not.toThrow();
      expect(run([record("client:acme", bad)]).size, `"${bad}" activated something`).toBe(0);
    }
  });
});

describe("it activates the object the event names, and no other", () => {
  it("an event for A leaves B alone", () => {
    const out = run([record("client:acme", ago(HOUR))]);
    expect(out.has("client:acme")).toBe(true);
    for (const other of ["client:borden", "project:rebuild", "task:alpha"]) {
      expect(out.has(other), `${other} activated on someone else's event`).toBe(false);
    }
  });

  it("NO PROPAGATION · a connected neighbour does not activate", () => {
    // The derivation receives no edges at all, so propagation is structurally impossible rather than
    // merely absent. This asserts the consequence anybody would look for.
    const out = run([record("project:rebuild", ago(HOUR))]);
    expect([...out.keys()]).toEqual(["project:rebuild"]);
  });

  it("FABRICATION · an event naming an object that is not drawn creates nothing", () => {
    const out = run([record("client:ghost", ago(HOUR)), record("invoice:hidden", ago(HOUR))]);
    expect(out.size, "an unmatched event id produced an activation").toBe(0);
  });

  it("LOD · an object the scene dropped cannot activate", () => {
    // Same mechanism, stated as the case that matters: `drawn` is the SCENE's node set, so an object
    // hidden by the detail level is simply not in it.
    const coarse = new Set(["client:acme"]);
    const out = run([record("task:alpha", ago(HOUR))], coarse);
    expect(out.size, "a hidden object lit up").toBe(0);
  });
});

describe("COALESCING · one activation per object, and no number attached", () => {
  it("many events on one object produce exactly one activation, from the newest", () => {
    const out = run([
      record("client:acme", ago(9 * HOUR), "old"),
      record("client:acme", ago(1 * HOUR), "newest"),
      record("client:acme", ago(5 * HOUR), "middle"),
    ]);
    expect(out.size).toBe(1);
    expect(out.get("client:acme")?.eventId, "the newest qualifying event did not win").toBe("newest");
  });

  it("input ORDER does not decide which event wins", () => {
    const events = [
      record("client:acme", ago(9 * HOUR), "old"),
      record("client:acme", ago(1 * HOUR), "newest"),
    ];
    expect(run(events).get("client:acme")?.eventId)
      .toBe(run([...events].reverse()).get("client:acme")?.eventId);
  });

  it("NO VOLUME METRIC · one event and twenty events yield indistinguishable activations", () => {
    // The strongest form of "activation carries no count". If a renderer could tell these apart, a
    // busy object would look busier, which is a business metric no reader produced.
    const once = run([record("client:acme", ago(HOUR), "solo")]);
    const many = run([
      ...Array.from({ length: 19 }, (_, i) => record("client:acme", ago((i + 2) * HOUR), `e${i}`)),
      record("client:acme", ago(HOUR), "solo"),
    ]);
    expect(many.get("client:acme")).toEqual(once.get("client:acme"));
  });

  it("NO MAGNITUDE · the output carries no intensity, rank or count field", () => {
    // Pinning the key set is what makes adding one a decision rather than a drift. An `age` or
    // `count` field appearing here is how recency-as-importance would get in.
    const out = run([record("client:acme", ago(HOUR))]);
    expect(Object.keys(out.get("client:acme")!).sort()).toEqual(["eventId", "occurredAt", "summary"]);
  });

  it("a one-hour-old and a twenty-three-hour-old event produce the same SHAPE of activation", () => {
    const fresh = run([record("client:acme", ago(HOUR))]).get("client:acme")!;
    const older = run([record("client:borden", ago(23 * HOUR))]).get("client:borden")!;
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(older).sort());
  });
});

describe("PURE · reads no business field, mutates nothing, and is deterministic", () => {
  it("the same inputs give the same result", () => {
    const activity = [record("client:acme", ago(HOUR)), record("task:alpha", ago(3 * HOUR))];
    expect(run(activity)).toEqual(run(activity));
  });

  it("does not mutate the activity it is given", () => {
    const activity = [record("client:acme", ago(HOUR))];
    const before = JSON.stringify(activity);
    run(activity);
    expect(JSON.stringify(activity)).toBe(before);
  });

  it("an empty vault activates nothing", () => {
    expect(run([]).size).toBe(0);
  });

  it("the clock is an ARGUMENT — the same events expire as it advances", () => {
    const activity = [record("client:acme", ago(HOUR))];
    expect(run(activity, DRAWN, NOW).size).toBe(1);
    expect(run(activity, DRAWN, NOW + ACTIVATION_WINDOW_MS).size,
      "the window did not move with the clock").toBe(0);
  });
});
