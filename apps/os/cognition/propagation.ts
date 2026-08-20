// cognition/propagation — N3, Cognitive Propagation. See docs/COGNITION-N3.md.
//
// N3 LEARNS NOTHING NEW. It takes what the business structurally IS and what cognition has already
// LEARNED, and asks one question:
//
//     What becomes reachable from here, and why exactly is it reachable?
//
// THE GOVERNING RULE. Relationships describe what is structurally connected. Cognition describes
// what it has learned about co-occurrence. Propagation may traverse both only while their
// provenance stays distinguishable. Every design choice below follows from that, including the
// inconvenient ones.
//
// NO COMBINED SCALAR. The two channels report different kinds of number — an exact integer hop
// count, and a real magnitude in [0,1] — and there is no honest arithmetic that fuses them. A
// renderer wanting one number is not a reason to invent one.
//
// NO ATTENUATION KNOB. Learned resonance is the product of `relevance` along a route, and relevance
// is already bounded and already time-decayed, so routes attenuate on their own. HOP_DECAY stays
// unused: a second decay mechanism would put a tuned constant between the evidence and the result.
// Termination comes from MAX_PROPAGATION_HOPS, not from decay.
//
// PURITY: no fs, no reads, no writes, no events, no clock, no randomness, no module state.

import type {
  Association,
  CognitiveNodeRef,
  CognitivePropagation,
  InjectedRelationship,
  PropagationInput,
  PropagationPath,
  PropagationResult,
  PropagationStep,
} from "./contract";
import { MAX_PATHS_EXPLORED, MAX_PATHS_PER_NODE, MAX_PROPAGATION_HOPS } from "./bounds";
import { nodeKey } from "./cooccurrence";

/** One traversable move out of a node, before it becomes a step on a path. */
type Move = { step: PropagationStep; toKey: string };

/** A partial route during traversal. */
type Frontier = { key: string; steps: PropagationStep[]; visited: ReadonlySet<string> };

const stepToken = (step: PropagationStep): string =>
  step.via === "structural"
    ? `s:${step.kind}:${step.direction}>${nodeKey(step.to)}`
    : `l:${step.associationId}:${step.direction}>${nodeKey(step.to)}`;

/** Stable path identity, derived from the steps themselves. Not an id format for consumers. */
const pathId = (steps: readonly PropagationStep[]): string => steps.map(stepToken).join("|");

const contributionOf = (steps: readonly PropagationStep[]): number =>
  steps.reduce((carried, step) => (step.via === "learned" ? carried * step.relevance : carried), 1);

const structuralStepCount = (steps: readonly PropagationStep[]): number =>
  steps.filter((step) => step.via === "structural").length;

const isAllStructural = (steps: readonly PropagationStep[]): boolean =>
  steps.length > 0 && steps.every((step) => step.via === "structural");

/**
 * The total order on retained paths.
 *
 * A total order is not decoration: without one, two runs over identical input keep different paths
 * and the layer stops being reproducible — the same requirement association eviction carries.
 *
 *   contribution desc   the route that carried most
 *   → steps asc         a shorter explanation is a better one
 *   → structural desc   the stronger kind of claim first
 *   → id asc            stable, derived from the steps
 */
function comparePaths(a: PropagationPath, b: PropagationPath): number {
  if (a.contribution !== b.contribution) return b.contribution - a.contribution;
  if (a.steps.length !== b.steps.length) return a.steps.length - b.steps.length;
  const structural = structuralStepCount(b.steps) - structuralStepCount(a.steps);
  if (structural !== 0) return structural;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the adjacency both channels traverse.
 *
 * Traversal is UNDIRECTED — reachability is symmetric, and a task must be able to lead back to its
 * client — but each move records the direction it took, so the asymmetry of the underlying claim
 * survives into the provenance rather than being erased by the convenience.
 *
 * ARCHIVED ASSOCIATIONS ARE NOT TRAVERSABLE. By definition they are cognitively inactive: they keep
 * every event id and can reactivate, but they carry no activation. Dormant ones remain traversable
 * and simply contribute little, because their relevance is low. This is the whole payoff of N2's
 * split between storage and accessibility — no special case, no branch, it falls out.
 */
function buildMoves(
  relationships: readonly InjectedRelationship[],
  associations: readonly Association[]
): Map<string, Move[]> {
  const moves = new Map<string, Move[]>();
  const add = (fromKey: string, move: Move): void => {
    const existing = moves.get(fromKey);
    if (existing) existing.push(move);
    else moves.set(fromKey, [move]);
  };

  for (const relationship of relationships) {
    const sourceKey = nodeKey(relationship.source);
    const targetKey = nodeKey(relationship.target);
    add(sourceKey, {
      step: { via: "structural", kind: relationship.kind, direction: "forward", to: relationship.target },
      toKey: targetKey,
    });
    add(targetKey, {
      step: { via: "structural", kind: relationship.kind, direction: "reverse", to: relationship.source },
      toKey: sourceKey,
    });
  }

  for (const association of associations) {
    if (association.state === "archived") continue;
    const sourceKey = nodeKey(association.source);
    const targetKey = nodeKey(association.target);
    add(sourceKey, {
      step: {
        via: "learned",
        associationId: association.id,
        direction: "forward",
        relevance: association.relevance,
        to: association.target,
      },
      toKey: targetKey,
    });
    add(targetKey, {
      step: {
        via: "learned",
        associationId: association.id,
        direction: "reverse",
        relevance: association.relevance,
        to: association.source,
      },
      toKey: sourceKey,
    });
  }

  // Deterministic expansion order, independent of how the adapter happened to order its inputs.
  for (const [, list] of moves) {
    list.sort((a, b) => {
      const left = stepToken(a.step);
      const right = stepToken(b.step);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  return moves;
}

/**
 * Everything reachable from the seed, with the provenance of every route preserved.
 *
 * Deterministic: same seed, same relationships, same associations, same `now` ⇒ byte-identical
 * output, including node order, path order, ids, contributions and counts.
 */
export function propagate(input: PropagationInput): PropagationResult {
  const traversable = input.associations.filter((a) => a.state !== "archived");
  const moves = buildMoves(input.relationships, traversable);
  const seedKey = nodeKey(input.seed);

  const discovered = new Map<string, { node: CognitiveNodeRef; paths: PropagationPath[] }>();
  const record = (node: CognitiveNodeRef, steps: PropagationStep[]): void => {
    const key = nodeKey(node);
    const entry = discovered.get(key) ?? { node, paths: [] };
    entry.paths.push({ id: pathId(steps), steps: [...steps], contribution: contributionOf(steps) });
    discovered.set(key, entry);
  };

  // Breadth-first so shallower routes are found first, with a per-path visited set. A GLOBAL
  // visited set would suppress legitimate alternate routes and make the result depend on traversal
  // order — the opposite of what a provenance-preserving traversal is for.
  const explored = { count: 0, exhausted: false };
  const walk = (frontier: Frontier[], depth: number): void => {
    if (depth >= MAX_PROPAGATION_HOPS || frontier.length === 0 || explored.exhausted) return;
    const next: Frontier[] = [];
    for (const partial of frontier) {
      for (const move of moves.get(partial.key) ?? []) {
        if (partial.visited.has(move.toKey)) continue;
        if (explored.count >= MAX_PATHS_EXPLORED) {
          explored.exhausted = true;
          return;
        }
        explored.count += 1;
        const steps = [...partial.steps, move.step];
        record(move.step.to, steps);
        next.push({
          key: move.toKey,
          steps,
          visited: new Set([...partial.visited, move.toKey]),
        });
      }
    }
    walk(next, depth + 1);
  };
  walk([{ key: seedKey, steps: [], visited: new Set([seedKey]) }], 0);

  const reached: CognitivePropagation[] = [...discovered.entries()]
    .map(([, entry]) => {
      const ordered = [...entry.paths].sort(comparePaths);

      // Structural distance uses ONLY all-structural routes. A mixed route says something else.
      const structuralLengths = ordered.filter((p) => isAllStructural(p.steps)).map((p) => p.steps.length);
      const structuralDistance = structuralLengths.length > 0 ? Math.min(...structuralLengths) : null;

      // Learned resonance is the strongest single route, never the sum of many.
      const learnedPaths = ordered.filter((p) => p.steps.some((s) => s.via === "learned"));
      const learnedResonance = learnedPaths.reduce((best, p) => Math.max(best, p.contribution), 0);

      const relevances = ordered.flatMap((p) =>
        p.steps.filter((s) => s.via === "learned").map((s) => (s.via === "learned" ? s.relevance : 0))
      );
      const relevance = relevances.length > 0 ? Math.max(...relevances) : null;

      return {
        node: entry.node,
        structuralDistance,
        learnedResonance,
        relevance,
        // The TRUE number of routes found, before retention truncates. A result that keeps eight of
        // seventeen must say seventeen.
        pathCount: ordered.length,
        paths: ordered.slice(0, MAX_PATHS_PER_NODE),
        epistemics: "learned" as const,
      };
    })
    .sort((a, b) => {
      const left = nodeKey(a.node);
      const right = nodeKey(b.node);
      return left < right ? -1 : left > right ? 1 : 0;
    });

  return {
    seed: input.seed,
    computedAt: input.now.toISOString(),
    reached,
    source: {
      hopLimit: MAX_PROPAGATION_HOPS,
      structuralRelationships: input.relationships.length,
      traversableAssociations: traversable.length,
      pathsExplored: explored.count,
      explorationExhausted: explored.exhausted,
    },
  };
}
