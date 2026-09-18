"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronRight, List, RefreshCw, Search, X } from "lucide-react";
import { recordPath, type SystemMap, type SystemRecord } from "@/graph-view/field/systems";

function subscribeCompact(callback: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function SystemExplorer({ map, selectedId, onSelect, onOverview, onRefresh, degraded = false }: {
  map: SystemMap; selectedId: string | null; onSelect: (id: string) => void;
  onOverview: () => void; onRefresh?: () => void;
  /** True when the scene is not drawing, so the directory IS the surface rather than an overlay. */
  degraded?: boolean;
}) {
  const compact = useSyncExternalStore(subscribeCompact,
    () => window.matchMedia("(max-width: 767px)").matches, () => false);
  const [directoryChoice, setDirectory] = useState<boolean | null>(null);
  // DIRECTORY-FIRST WHEN THERE IS NO PICTURE. Without a scene there is nothing else on this surface
  // to look at, so the list opens itself — but an explicit choice still wins, including the choice
  // to close it, and a selected record still shows its inspector.
  const directory = directoryChoice ?? (degraded ? !selectedId : (!compact && !selectedId));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("client");
  const [limit, setLimit] = useState(40);
  const records = useMemo(() => new Map(map.records.map((r) => [r.id, r])), [map]);
  const selected = selectedId ? records.get(selectedId) : undefined;
  const path = recordPath(map, selectedId);
  const results = useMemo(() => map.records.filter((r) => {
    const matchesType = filter === "all" || r.type === filter ||
      (filter === "record" && !["client", "project", "prospect"].includes(r.type));
    return matchesType &&
      `${r.label} ${r.type} ${r.state.status ?? ""}`.toLowerCase().includes(query.toLowerCase());
  }), [map, query, filter]);
  const children = selected ? map.records.filter((r) => r.parentId === selected.id) : [];
  const related = selected?.relatedIds.map((id) => records.get(id)).filter((r): r is SystemRecord => !!r) ?? [];
  const clients = map.records.filter((r) => r.type === "client").length;
  const projects = map.records.filter((r) => r.type === "project").length;
  const prospects = map.bodies.filter((r) => r.role === "asteroid").length;
  const choose = (id: string) => { onSelect(records.get(id)?.promotedToId ?? id); setDirectory(false); };
  const row = (record: SystemRecord) => <button key={record.id} className="system-record"
    aria-pressed={record.id === selectedId} onClick={() => choose(record.id)}>
    <i data-role={record.role ?? "record"} />
    <span><strong>{record.label}</strong><small>{record.type.replaceAll("_", " ")}{record.promotedToId ? " · converted to client" : record.state.status ? ` · ${record.state.status}` : ""}</small></span>
    <ChevronRight size={13} />
  </button>;
  return <div className="system-ui" data-directory={directory}>
    <header className="system-heading">
      <div className="galaxy-eyebrow">ASCEND OS / LIVING SYSTEM</div>
      <nav aria-label="Galaxy hierarchy" className="system-breadcrumbs">
        <button onClick={onOverview}>Galaxy</button>
        {path.map((r) => <span key={r.id}><ChevronRight size={12} /><button onClick={() => choose(r.id)} aria-current={r.id === selectedId ? "location" : undefined}>{r.label}</button></span>)}
      </nav>
      <p>{clients} client suns · {projects} project planets · {prospects.toLocaleString()} prospects · {map.records.length.toLocaleString()} records</p>
    </header>
    <div className="system-actions">
      {onRefresh && <button aria-label="Refresh business data" onClick={onRefresh}><RefreshCw size={16} /></button>}
      <button aria-expanded={directory} aria-controls="system-directory" onClick={() => setDirectory(!directory)}><List size={16} /> Directory</button>
    </div>
    {directory && <aside id="system-directory" className="system-directory" aria-label="Business directory">
      <div className="system-panel-heading"><span>Find your next orbit</span><button aria-label="Close directory" onClick={() => setDirectory(false)}><X size={16} /></button></div>
      <label className="system-search"><Search size={15} /><input aria-label="Search galaxy records" placeholder="Search records…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(40); }} /></label>
      <div className="system-filters" role="group" aria-label="Record types">
        {[["client", "Clients"], ["project", "Projects"], ["prospect", "Prospects"],
          ["record", "Records"], ["all", "All records"]].map(([value, label]) =>
          <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(40); }}>{label}</button>)}
      </div>
      <div className="system-records">
        {results.slice(0, limit).map(row)}
        {results.length === 0 && <p className="system-muted">No matching records.</p>}
        {results.length > limit && <button className="system-more" onClick={() => setLimit(limit + 40)}>Show more · {results.length - limit} remaining</button>}
      </div>
      <p className="system-directory-footer">Select a sun to reveal its projects and satellites.</p>
    </aside>}
    {selected && <aside className="system-inspector" aria-label="Selected record">
      <div className="system-panel-heading"><span>{selected.type.replaceAll("_", " ")}</span><button aria-label="Close selected record" onClick={onOverview}><X size={16} /></button></div>
      <h2>{selected.label}</h2>
      {selected.state.status && <p className="system-state">{selected.state.status}</p>}
      {selected.state.attention && <p className="system-attention">Flagged for attention</p>}
      <dl>{selected.meta.map((pair, i) => <div key={`${pair.label}:${i}`}><dt>{pair.label}</dt><dd>{pair.value}</dd></div>)}</dl>
      {selected.href ? <a className="system-open" href={selected.href}>Open {selected.type === "invoice" ? "finance" : selected.type.replaceAll("_", " ")} <ArrowUpRight size={16} /></a>
        : <p className="system-muted">Details are available here; this record has no separate page.</p>}
      <a className="system-permalink" href={selected.focusHref}>Link to this view</a>
      {selected.placementNote && <p className="system-placement">{selected.placementNote}</p>}
      {selected.type === "prospect" && <p className="system-placement">Open this prospect to use the existing pipeline and conversion workflow. After conversion, refresh to reveal its client sun.</p>}
      {children.length > 0 && <section><h3>In this system · {children.length}</h3>{children.map(row)}</section>}
      {related.length > 0 && <section><h3>Connected records</h3>{related.filter((r) => !children.some((c) => c.id === r.id)).map(row)}</section>}
      <p className="system-placement">Source: {map.source.name}{map.source.builtAt ? ` · ${new Date(map.source.builtAt).toLocaleString()}` : ""}</p>
    </aside>}
    {map.records.length === 0 && <div className="system-empty"><h2>No business records to display</h2><p>The stars are the backdrop. Client systems appear here when records are available to this account.</p></div>}
  </div>;
}
