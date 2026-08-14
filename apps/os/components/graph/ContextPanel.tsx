"use client";

// components/graph/ContextPanel — inspecting one entity in the brain.
//
// Renders ONLY what the GraphModel already carries. It computes nothing, fetches nothing, and
// invents nothing: every fact shown was copied by the projection from the read-model that owns it.
// Where a value is unknown it is omitted — never filled with a placeholder.

import { Badge, Button, KeyValue, Status, type Tone } from "@/components/primitives";
import type { GraphActivity, GraphModel, GraphNode } from "@/graph-view/contract";
import { EDGE_VISUAL, NODE_VISUAL, displayLabel } from "@/graph-view/taxonomy";

type Props = {
  node: GraphNode;
  model: GraphModel;
  href: string | null;
  onClose: () => void;
  onFocusNode: (id: string) => void;
};

function stateTone(node: GraphNode): Tone {
  if (node.state.attention) return "risk";
  if (node.state.health === "healthy") return "good";
  if (node.state.health === "at_risk") return "risk";
  return "neutral";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function ContextPanel({ node, model, href, onClose, onFocusNode }: Props) {
  const visual = NODE_VISUAL[node.type];

  // Direct relationships, from the model's own edges. No traversal logic beyond one hop.
  const relations = model.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = model.nodes.find((n) => n.id === otherId);
      return other ? { edge: e, other, outgoing: e.source === node.id } : null;
    })
    .filter((r): r is { edge: (typeof model.edges)[number]; other: GraphNode; outgoing: boolean } => r !== null);

  const activity: GraphActivity[] = model.activity.filter((a) => a.nodeId === node.id).slice(0, 5);
  const attentionCount = relations.filter((r) => r.other.state.attention).length;

  return (
    <aside
      className="anim-panel pointer-events-auto flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]/95 shadow-[var(--shadow-e2)] backdrop-blur-xl"
      aria-label={`Details for ${displayLabel(node.label)}`}
    >
      {/* Identity */}
      <header className="border-b border-[var(--color-line)] px-4 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: visual.color }} />
              <span className="t-label text-[var(--color-t3)]">{visual.label}</span>
            </div>
            <h2 className="t-h2 mt-1 break-words text-[var(--color-t1)]">{displayLabel(node.label)}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-t3)] transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {node.state.status && <Status tone={stateTone(node)}>{node.state.status}</Status>}
          {node.state.health && (
            <Badge tone={node.state.health === "at_risk" ? "risk" : node.state.health === "healthy" ? "good" : "neutral"}>
              {node.state.health.replace("_", " ")}
            </Badge>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Summary counts — derived from the model's own structure, not from business logic. */}
        <div className="flex gap-4 border-b border-[var(--color-line)] px-4 py-3">
          <div>
            <p className="t-metric text-[var(--color-t1)]">{relations.length}</p>
            <p className="t-label text-[var(--color-t3)]">connected</p>
          </div>
          {attentionCount > 0 && (
            <div>
              <p className="t-metric text-[var(--color-risk)]">{attentionCount}</p>
              <p className="t-label text-[var(--color-t3)]">need attention</p>
            </div>
          )}
          {activity.length > 0 && (
            <div>
              <p className="t-metric text-[var(--color-t1)]">{relativeTime(activity[0].occurredAt)}</p>
              <p className="t-label text-[var(--color-t3)]">last activity</p>
            </div>
          )}
        </div>

        {/* Key facts */}
        {node.meta.length > 0 && (
          <div className="border-b border-[var(--color-line)] px-4 py-2.5">
            <p className="t-section mb-1 text-[var(--color-t3)]">Facts</p>
            {node.meta.map((m) => (
              <KeyValue key={m.label} label={m.label} value={m.value} />
            ))}
          </div>
        )}

        {/* Relationships */}
        {relations.length > 0 && (
          <div className="border-b border-[var(--color-line)] px-4 py-2.5">
            <p className="t-section mb-1.5 text-[var(--color-t3)]">Relationships</p>
            <ul className="flex flex-col">
              {relations.slice(0, 14).map((r) => (
                <li key={r.edge.id}>
                  <button
                    onClick={() => onFocusNode(r.other.id)}
                    className="group flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 text-left transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)]"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: NODE_VISUAL[r.other.type].color }}
                    />
                    <span className="t-label w-[86px] shrink-0 text-[var(--color-t3)]">
                      {EDGE_VISUAL[r.edge.type].label}
                    </span>
                    <span className="t-meta min-w-0 flex-1 truncate text-[var(--color-t2)] group-hover:text-[var(--color-t1)]">
                      {displayLabel(r.other.label)}
                    </span>
                    {r.other.state.attention && (
                      <span aria-label="needs attention" className="size-1.5 shrink-0 rounded-full bg-[var(--color-risk)]" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {relations.length > 14 && (
              <p className="t-mono px-1 pt-1 text-[var(--color-t3)]">+{relations.length - 14} more</p>
            )}
          </div>
        )}

        {/* Recent real activity — never ambient. */}
        {activity.length > 0 && (
          <div className="px-4 py-2.5">
            <p className="t-section mb-1.5 text-[var(--color-t3)]">Recent activity</p>
            <ul className="flex flex-col gap-1.5">
              {activity.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3">
                  <span className="t-meta min-w-0 flex-1 text-[var(--color-t2)]">{a.summary}</span>
                  <span className="t-mono shrink-0 text-[var(--color-t3)]">{relativeTime(a.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions — the doorway from exploration into operational work. */}
      <footer className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-3">
        {href ? (
          <Button variant="primary" onClick={() => (window.location.href = href)}>
            Open {visual.label.toLowerCase()} →
          </Button>
        ) : (
          <span className="t-label text-[var(--color-t3)]">No detail route yet</span>
        )}
      </footer>
    </aside>
  );
}