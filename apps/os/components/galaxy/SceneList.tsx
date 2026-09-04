"use client";

// components/galaxy/SceneList — THE NON-VISUAL SURFACE (Slice 5, decision B).
//
//     Scene ──┬──► GalaxyCanvas   (pixels)
//             └──► SceneList      (this file — text, links, tab order)
//
// ─── ONE SCENE, TWO SURFACES ───────────────────────────────────────────────────────────────────
//
// This list is NOT a second view of the business. It takes the SAME `Scene` value the canvas paints,
// and it takes nothing else: no projection, no spatial model, no layout, no reader, no fetch. That
// is the whole architectural point, and it is what makes the two surfaces impossible to disagree.
//
// The alternative — an accessible list built from GraphProjection while the canvas is built from the
// scene — would be two data paths that drift, and the non-visual one always drifts second because
// nobody is looking at it. Here, a node the canvas draws is a node this list contains, by
// construction: both iterate the same array. A witness asserts exactly that, and a mutant that gives
// the list its own source goes red.
//
// It invents nothing. Every entry names an object the scene holds; every relationship names an edge
// the scene holds, which traced to an edge the authorized projection asserted. Positions are
// deliberately absent — a coordinate is not information to somebody who is not looking at pixels.
//
// It is not an authorization surface and holds no policy: it renders what it was handed, which was
// already scoped upstream, and it could not widen it if it tried.

import { Fragment, useMemo } from "react";
import { routeForEntity } from "@/navigation/routing";
import { EDGE_VISUAL, NODE_VISUAL } from "@/graph-view/taxonomy";
import type { Scene, SceneNode } from "./scene";
import type { Activation } from "./activity";
import { relationshipsOf, type Relationship } from "./traversal";

const HEALTH_WORD: Record<NonNullable<SceneNode["health"]>, string> = {
  healthy: "healthy",
  on_track: "on track",
  at_risk: "at risk",
};

type Props = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * The SAME map GalaxyView handed the canvas. Not a second query and not a second derivation —
   * where the canvas paints a fading ring, this states the fact in words, and it states it for every
   * user including those who see no motion at all.
   */
  activations: ReadonlyMap<string, Activation>;
  /**
   * Follow a relationship. The SAME action the canvas calls, so a keyboard user and a pointer user
   * perform one semantic and arrive at the same selection — not two implementations that happen to
   * agree today.
   */
  onTraverse: (relationship: Relationship) => void;
};

export function SceneList({ scene, selectedId, onSelect, activations, onTraverse }: Props) {
  // Derived once per SCENE, not per render. GalaxyView re-renders on every animated frame, so an
  // unmemoised Map and Set here rebuilt over every node ~60 times a second during a camera
  // transition — the same per-frame allocation Slice 7 removed from the painter.
  const byId = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);
  const present = useMemo(() => new Set(scene.nodes.map((n) => n.id)), [scene]);

  // Read in the same order the canvas gives attention: most significant first. `labelOrder` is the
  // scene's own ordering, so the two surfaces agree about what matters without either deciding it.
  const ordered = scene.labelOrder.map((id) => byId.get(id)).filter((n): n is SceneNode => Boolean(n));

  if (ordered.length === 0) {
    return (
      <p style={{ margin: 0, color: "#9aa2ab" }}>
        No objects to show. The graph is empty for this account.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {ordered.map((node) => {
        // Relationships come from `traversal.relationshipsOf` — the SAME function the canvas uses.
        // This block used to derive them inline, which was a second place that decided what is
        // connected to what; one authority is what stops the two surfaces drifting apart.
        const links = relationshipsOf(node.id, scene.edges, present);

        const typeName = NODE_VISUAL[node.visualType].label;
        // The owner's own sentence, carried verbatim. This layer composes no description and adds no
        // adjective: "recent activity" states that an event occurred inside the display window and
        // claims nothing about whether it was important, urgent or unusual.
        const recent = activations.get(node.id);

        /**
         * Where this object lives in Ascend OS, or `null`.
         *
         * `navigation/routing` is the ONLY source of a destination here — no path is assembled from
         * pieces, and the kinds it does not route (phase, task, approval, audit, care plan, SOP)
         * render NO link at all. That is the honest outcome rather than a convenient one: a route
         * invented for an object that has no page would take an operator somewhere that does not
         * exist, and F65 fails the build if a path is ever hand-built in this directory.
         *
         * RENDERING A LINK IS NOT GRANTING ACCESS. No capability is consulted here and none should
         * be: the destination page runs its own authorization and denies if this principal may not
         * see it. Filtering links would put a second, weaker copy of that decision in a renderer.
         */
        const destination = routeForEntity(node.entity, node.entityId);
        const notes = [
          node.health ? HEALTH_WORD[node.health] : null,
          node.emphasis ? "needs attention" : null,
        ].filter(Boolean);

        return (
          <li key={node.id} style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              onClick={() => onSelect(node.id === selectedId ? null : node.id)}
              aria-pressed={node.id === selectedId}
              // `aria-current` states WHICH object the view is on, which `aria-pressed` (a toggle
              // state) does not. Selecting here also moves the camera — the same single selection
              // the canvas reports — so the two surfaces are never showing different objects.
              aria-current={node.id === selectedId ? "true" : undefined}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "#e9ebee", font: "inherit", textAlign: "left",
              }}
            >
              <strong>{node.label}</strong>{" "}
              <span style={{ color: "#9aa2ab" }}>
                — {typeName}
                {notes.length > 0 ? `, ${notes.join(", ")}` : ""}
              </span>
            </button>
            {node.id === selectedId && node.meta.length > 0 && (
              // INSPECTION. Shown only for the selected object — every entry carrying its pairs
              // would be a wall of text, and the selection is what the operator has asked about.
              //
              // A description list because that is what these are: a label and its value. The markup
              // is IDENTICAL for every pair of every kind — an opportunity's "Severity" is rendered
              // exactly as an invoice's "Amount". Styling one differently would mean this layer had
              // decided which facts matter, which is an interpretation its owners never delegated.
              //
              // Rendered in projection order, unsorted and unfiltered, with the strings untouched:
              // "$4,500", "72%", "3/5 · warm" are presentations their owners already composed.
              <dl style={{ margin: "0.35rem 0 0 1rem", display: "grid",
                           gridTemplateColumns: "auto 1fr", columnGap: "0.6rem", rowGap: "0.1rem" }}>
                {node.meta.map((pair, i) => (
                  <Fragment key={`${pair.label}:${i}`}>
                    <dt style={{ color: "#9aa2ab" }}>{pair.label}</dt>
                    <dd style={{ margin: 0, color: "#e9ebee" }}>{pair.value}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {destination && (
              // A real anchor, so it is keyboard-reachable, middle-clickable and works without JS —
              // and so this component causes no navigation itself. Deliberately a LINK rather than a
              // button: selection and traversal are buttons, and the role difference is what tells
              // an operator (and a screen reader) that this one leaves the Galaxy.
              <a
                href={destination}
                aria-label={`Open ${node.label} in Ascend OS`}
                style={{ marginLeft: "0.5rem", color: "#7fa8d0", font: "inherit" }}
              >
                Open
              </a>
            )}
            {recent && (
              <p style={{ margin: "0.15rem 0 0 1rem", color: "#9aa2ab" }}>
                Recent activity: <span style={{ color: "#e9ebee" }}>{recent.summary}</span>
              </p>
            )}
            {links.length > 0 && (
              <ul style={{ listStyle: "none", margin: "0.25rem 0 0 1rem", padding: 0, color: "#9aa2ab" }}>
                {links.map((l) => {
                  const other = byId.get(l.targetId);
                  if (!other) return null;
                  // Direction is stated, never flattened: forward along the stored edge reads one
                  // way, back up it reads the other. Containment is named as containment because
                  // SceneEdge says so — this layer re-decides nothing.
                  const verb = EDGE_VISUAL[l.kind].label;
                  const phrase = l.outgoing ? verb : `is the ${verb} of`;
                  const relation = l.containment
                    ? (l.outgoing ? "contains" : "is contained by")
                    : "related to";
                  return (
                    <li key={l.edgeId}>
                      <button
                        type="button"
                        onClick={() => onTraverse(l)}
                        // A real control, so following a relationship is reachable by keyboard on
                        // exactly the same terms as by pointer.
                        aria-label={`Follow ${phrase} ${other.label} — ${relation}`}
                        style={{
                          background: "none", border: "none", padding: 0, cursor: "pointer",
                          color: "inherit", font: "inherit", textAlign: "left",
                        }}
                      >
                        {phrase} <span style={{ color: "#e9ebee" }}>{other.label}</span>
                        {l.containment ? " (contains)" : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

