// The retrospective utility harness — docs/COGNITION-OBSERVATION.md §15.
//
// It answers one pre-registered question and reports the answer without interpreting it:
//
//     On the eligible genuine transitions, does cognitive propagation rank the next subject
//     better than recency, over an identical candidate universe?
//
// It lives under tests/ because it is MEASUREMENT SCAFFOLDING, not architecture: nothing in the
// running system imports it, and tests/ is excluded from every fitness scan.
//
// NOTHING HERE MAY BE TUNED AFTER SEEING A RESULT. Every rule below — eligibility, the candidate
// universe, both cognitive rankings, the baseline, the tie-breaks, and the kill condition — was
// fixed in the pre-registration commit before the harness existed.
//
// THREE LEGITIMATE OUTCOMES, and the third is fine:
//     fails         recency strictly beats both cognitive rankers   -> KILL THE LADDER
//     beats         a cognitive ranker strictly beats recency        -> design the next experiment
//     inconclusive  neither                                          -> harness validated, no
//                                                                       conclusion about cognition

import { foldCognitiveState, nodeKey } from "@/cognition/cooccurrence";
import { propagate } from "@/cognition/propagation";
import type { Activation, CognitiveNodeRef } from "@/cognition/contract";
import type { StructuralRelationship } from "@/relationships/contract";

export const K_VALUES = [1, 3, 5] as const;

/** One ranker's verdict on one trial. */
export type RankerResult = {
  ranker: string;
  /** 1-based position of the true next subject, or null when it is not in the universe at all. */
  rankOfTruth: number | null;
  hitAtK: Record<number, boolean>;
  /** How many candidates share the truth's sort key — large ties make a hit less meaningful. */
  tiedWithTruth: number;
  topFive: string[];
};

export type Trial = {
  index: number;
  seed: string;
  truth: string;
  candidateUniverse: number;
  truthInUniverse: boolean;
  associationsAtTime: number;
  rankers: RankerResult[];
};

export type Excluded = { index: number; from: string; to: string; reason: string };

export type HarnessReport = {
  totalConsecutivePairs: number;
  eligibleTrials: number;
  excluded: Excluded[];
  trials: Trial[];
  hitRateAtK: Record<string, Record<number, number>>;
  killConditionTriggered: boolean;
  outcome: "fails" | "beats" | "inconclusive";
};

const key = (ref: CognitiveNodeRef): string => nodeKey(ref);

/**
 * The candidate universe, identical for every ranker.
 *
 * Every structural subject, plus every subject the spine has named up to and including the seed
 * event, minus the seed itself. The seed is excluded because propagation never returns it by
 * design, and because eligibility already guarantees the truth is never the seed — leaving it in
 * would hand the baseline a rank-1 slot it can never need.
 *
 * A truth outside this universe counts as a miss for every ranker equally.
 */
function candidateUniverse(
  relationships: readonly StructuralRelationship[],
  seenSoFar: readonly Activation[],
  seed: string
): string[] {
  const universe = new Set<string>();
  for (const relationship of relationships) {
    universe.add(key(relationship.source));
    universe.add(key(relationship.target));
  }
  for (const activation of seenSoFar) universe.add(key(activation.subject));
  universe.delete(seed);
  return [...universe].sort();
}

/** Rank a scored universe. Lower `sort` is better; ties resolve by candidate key ascending. */
function rankBy(
  universe: readonly string[],
  score: (candidate: string) => number[]
): { ordered: string[]; sortKeys: Map<string, string> } {
  const sortKeys = new Map<string, string>();
  for (const candidate of universe) sortKeys.set(candidate, score(candidate).join(","));
  const ordered = [...universe].sort((a, b) => {
    const left = score(a);
    const right = score(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { ordered, sortKeys };
}

function measure(
  ranker: string,
  ordered: string[],
  sortKeys: Map<string, string>,
  truth: string
): RankerResult {
  const position = ordered.indexOf(truth);
  const rankOfTruth = position === -1 ? null : position + 1;
  const truthKey = sortKeys.get(truth);
  const tiedWithTruth =
    truthKey === undefined ? 0 : [...sortKeys.values()].filter((v) => v === truthKey).length;
  const hitAtK: Record<number, boolean> = {};
  for (const k of K_VALUES) hitAtK[k] = rankOfTruth !== null && rankOfTruth <= k;
  return { ranker, rankOfTruth, hitAtK, tiedWithTruth, topFive: ordered.slice(0, 5) };
}

/**
 * Run the pre-registered experiment.
 *
 * `now` for each trial is the timestamp of the seed event, NOT today: relevance must be evaluated
 * as of the moment the prediction would have been made, or the harness leaks the future into the
 * fold.
 */
export function runUtilityHarness(
  stream: readonly Activation[],
  relationships: readonly StructuralRelationship[]
): HarnessReport {
  const excluded: Excluded[] = [];
  const trials: Trial[] = [];

  for (let i = 0; i < stream.length - 1; i += 1) {
    const seedRef = stream[i].subject;
    const truthRef = stream[i + 1].subject;
    const seed = key(seedRef);
    const truth = key(truthRef);

    // ELIGIBILITY, pre-registered: genuine transitions only. A self-repeat measures persistence,
    // not association, and propagation structurally cannot return the seed — so including them
    // would refute cognition with an artifact of its own semantics.
    if (seed === truth) {
      excluded.push({ index: i, from: seed, to: truth, reason: "self-repeat (subject unchanged)" });
      continue;
    }

    const seenSoFar = stream.slice(0, i + 1);
    const now = new Date(stream[i].at);
    const state = foldCognitiveState({
      activations: seenSoFar,
      structuralPairs: [],
      excludedCount: 0,
      sourceName: "harness",
      now,
    });
    const result = propagate({
      seed: seedRef,
      relationships: relationships.map((r) => ({ source: r.source, target: r.target, kind: r.kind })),
      associations: state.associations,
      now,
    });

    const universe = candidateUniverse(relationships, seenSoFar, seed);
    const reached = new Map(result.reached.map((r) => [key(r.node), r]));
    const distance = (c: string) => reached.get(c)?.structuralDistance ?? Number.MAX_SAFE_INTEGER;
    const resonance = (c: string) => reached.get(c)?.learnedResonance ?? 0;

    // Last position in the stream at which a candidate was activated; -1 when never touched.
    const lastSeen = new Map<string, number>();
    seenSoFar.forEach((activation, index) => lastSeen.set(key(activation.subject), index));
    const recency = (c: string) => lastSeen.get(c) ?? -1;

    // Two pre-declared cognitive rankings, because cognition deliberately emits no combined
    // scalar. Both are reported; neither is selected after the fact.
    const cogA = rankBy(universe, (c) => [distance(c), -resonance(c)]);
    const cogB = rankBy(universe, (c) => [-resonance(c), distance(c)]);
    const base = rankBy(universe, (c) => [-recency(c)]);

    trials.push({
      index: i,
      seed,
      truth,
      candidateUniverse: universe.length,
      truthInUniverse: universe.includes(truth),
      associationsAtTime: state.associations.length,
      rankers: [
        measure("COG-A structural-first", cogA.ordered, cogA.sortKeys, truth),
        measure("COG-B learned-first", cogB.ordered, cogB.sortKeys, truth),
        measure("BASELINE recency", base.ordered, base.sortKeys, truth),
      ],
    });
  }

  const names = trials[0]?.rankers.map((r) => r.ranker) ?? [];
  const hitRateAtK: Record<string, Record<number, number>> = {};
  for (const name of names) {
    hitRateAtK[name] = {};
    for (const k of K_VALUES) {
      const hits = trials.filter((t) => t.rankers.find((r) => r.ranker === name)?.hitAtK[k]).length;
      hitRateAtK[name][k] = trials.length === 0 ? 0 : hits / trials.length;
    }
  }

  // KILL CONDITION, pre-registered. Compared at K=1, the only K that discriminates when a single
  // target is being ranked.
  const baseline = hitRateAtK["BASELINE recency"]?.[1] ?? 0;
  const bestCognitive = Math.max(
    hitRateAtK["COG-A structural-first"]?.[1] ?? 0,
    hitRateAtK["COG-B learned-first"]?.[1] ?? 0
  );
  const outcome: HarnessReport["outcome"] =
    bestCognitive > baseline ? "beats" : baseline > bestCognitive ? "fails" : "inconclusive";

  return {
    totalConsecutivePairs: Math.max(stream.length - 1, 0),
    eligibleTrials: trials.length,
    excluded,
    trials,
    hitRateAtK,
    killConditionTriggered: outcome === "fails",
    outcome,
  };
}
