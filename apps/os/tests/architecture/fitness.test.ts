// LAYER B — architecture fitness rules.
//
// These tests turn the frozen Phase 4.1–12 architecture from documented convention into a
// machine-enforced constraint. They assert against real source text, so they cannot drift from the
// repository the way a hand-maintained list would.
//
// They change NO architecture. Where the codebase currently violates a rule, the violation is
// encoded as a NARROW, NAMED exemption (see F14/F15) so that the specific known case passes while
// any NEW occurrence fails. Nothing here silently blesses a violation as correct.
//
// F13 ("orchestration-only") is deliberately NOT automated: it is a semantic property, and every
// mechanical proxy for it produces more false positives than true ones. It remains a review concern.

import { describe, expect, it } from "vitest";
import {
  definitionSites,
  filesMatching,
  importsOf,
  importsUnder,
  sourceFiles,
  stripComments,
  read,
} from "./source-graph";

const ENGINE_DIRS = [
  "approvals-engine",
  "decision-engine",
  "document-engine",
  "effort-engine",
  "health-engine",
  "intelligence-engine",
  "notification-engine",
  "opportunity-engine",
  "pipeline-engine",
  "site-quality-engine",
  "sop-engine",
];

// ─── F1 ────────────────────────────────────────────────────────────────────────────────────────
describe("F1 · engines must not depend on the surface", () => {
  it("no engine imports app/, mission-control/, or components/", () => {
    const offenders = importsUnder("engines").filter((e) =>
      /^@\/(app|mission-control|components)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });
});

// ─── F2 ────────────────────────────────────────────────────────────────────────────────────────
describe("F2 · engines must not perform or import I/O", () => {
  it("no engine imports a filesystem, network, or process primitive", () => {
    const forbidden = /^(node:|fs$|path$|crypto$|child_process$|http|https$|net$|os$)/;
    const offenders = importsUnder("engines").filter((e) => forbidden.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("no engine reads process.env or calls fetch", () => {
    const offenders = filesMatching(/\bprocess\.env\b|\bfetch\s*\(/, ["engines"]);
    expect(offenders).toEqual([]);
  });

  it("no engine declares server-only (it would imply a server-bound side effect)", () => {
    expect(importsUnder("engines").filter((e) => e.specifier === "server-only")).toEqual([]);
  });
});

// ─── F3 ────────────────────────────────────────────────────────────────────────────────────────
describe("F3 · engines must not write, persist, or emit events", () => {
  it("no engine references an event emitter or write primitive", () => {
    const offenders = filesMatching(
      /\bemitEvent\b|\bwriteFile\w*|\bappendFile\w*|\bappendJsonlLine\b|\bwriteJsonFileAtomic\b|\bmkdir\b|\bunlink\b|\brename\b/,
      ["engines"]
    );
    expect(offenders).toEqual([]);
  });

  it("no engine introduces module-level mutable state (a cache is persistence by another name)", () => {
    // `let`/`var` at column 0 in an engine would survive across calls and break rebuildability.
    const offenders = sourceFiles("engines").filter((f) => /^(let|var)\s/m.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });
});

// ─── F4 ────────────────────────────────────────────────────────────────────────────────────────
describe("F4 · engines must not import lib/", () => {
  it("no engine imports @/lib", () => {
    const offenders = importsUnder("engines").filter((e) => /^@\/lib\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });
});

// ─── F5 ────────────────────────────────────────────────────────────────────────────────────────
describe("F5 · no cross-engine coupling", () => {
  it("no engine imports a different engine directory", () => {
    const offenders: string[] = [];
    for (const dir of ENGINE_DIRS) {
      for (const edge of importsUnder(`engines/${dir}`)) {
        const match = edge.specifier.match(/^@\/engines\/([^/]+)/);
        // intelligence-engine's index.ts and forecast.ts are declared siblings within ONE
        // responsibility boundary, so same-directory references are explicitly permitted.
        if (match && match[1] !== dir) offenders.push(`${edge.from}:${edge.line} → ${edge.specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("permits the intelligence-engine index/forecast sibling relationship explicitly", () => {
    const siblings = sourceFiles("engines/intelligence-engine");
    expect(siblings.some((f) => f.endsWith("index.ts"))).toBe(true);
    expect(siblings.some((f) => f.endsWith("forecast.ts"))).toBe(true);
  });
});

// ─── F6 ────────────────────────────────────────────────────────────────────────────────────────
describe("F6 · engine → core imports stay type-only, with one recorded exception", () => {
  /**
   * Opportunity's value import of core/crm is an EXISTING architectural-review item (AR-4). Per the
   * D2 ruling it is not changed here. The exemption is narrow: this exact file, this exact
   * specifier. A value import from any other engine — or a different core specifier in this one —
   * fails.
   */
  const EXEMPT = { file: "engines/opportunity-engine/index.ts", specifier: "@/core/crm" };

  it("only the recorded exemption imports core as a value", () => {
    const valueEdges = importsUnder("engines")
      .filter((e) => /^@\/core\b/.test(e.specifier) && !e.typeOnly)
      .map((e) => ({ file: e.from, specifier: e.specifier }));
    expect(valueEdges).toEqual([EXEMPT]);
  });

  it("the recorded exemption still exists exactly as described (guards against silent drift)", () => {
    const edge = importsOf(EXEMPT.file).find((e) => e.specifier === EXEMPT.specifier);
    expect(edge).toBeDefined();
    expect(edge?.typeOnly).toBe(false);
  });

  it("every other engine → core import is erased at runtime", () => {
    const nonExempt = importsUnder("engines")
      .filter((e) => /^@\/core\b/.test(e.specifier) && e.from !== EXEMPT.file);
    expect(nonExempt.length).toBeGreaterThan(0);
    for (const edge of nonExempt) expect(edge.typeOnly).toBe(true);
  });
});

// ─── F7 / F8 ───────────────────────────────────────────────────────────────────────────────────
describe("F7 · computeEhr is the single EHR authority", () => {
  it("is defined exactly once, in lib/ehr.ts", () => {
    expect(definitionSites("computeEhr", ["lib", "core", "engines", "packages", "mission-control"])).toEqual([
      "lib/ehr.ts",
    ]);
  });
});

describe("F8 · computeScore is the single scoring authority", () => {
  it("is defined exactly once, in core/crm/scoring.ts", () => {
    expect(definitionSites("computeScore", ["lib", "core", "engines", "packages", "mission-control"])).toEqual([
      "core/crm/scoring.ts",
    ]);
  });

  it("no engine re-derives a prospect score", () => {
    expect(filesMatching(/\bcomputeScore\s*\(/, ["engines"])).toEqual([]);
  });
});

// ─── F9 ────────────────────────────────────────────────────────────────────────────────────────
describe("F9 · Forecast weighted-$ mathematics stays owned by lib/forecast", () => {
  // D3: this encodes the CURRENT implementation boundary. It does not resolve, and must not be read
  // as resolving, the recorded Forecast ownership tension — that remains an architectural-review item.
  it("STATUS_PROBABILITY is defined only in lib/forecast.ts", () => {
    expect(
      filesMatching(/const\s+STATUS_PROBABILITY\b/, ["lib", "core", "engines", "mission-control", "packages"])
    ).toEqual(["lib/forecast.ts"]);
  });

  it("ASSUMED_DEAL_VALUE is defined only in lib/forecast.ts", () => {
    expect(
      filesMatching(/const\s+ASSUMED_DEAL_VALUE\b/, ["lib", "core", "engines", "mission-control", "packages"])
    ).toEqual(["lib/forecast.ts"]);
  });

  it("no engine references the weighted-$ constants in CODE (comments may discuss them)", () => {
    // pipeline-engine's header names STATUS_PROBABILITY to declare it does NOT compute weighted-$.
    // Comment stripping is what makes this rule assert the truth rather than its opposite.
    expect(filesMatching(/\bSTATUS_PROBABILITY\b|\bASSUMED_DEAL_VALUE\b/, ["engines"])).toEqual([]);
  });
});

// ─── F10 ───────────────────────────────────────────────────────────────────────────────────────
describe("F10 · Opportunity's 7/2 ownership split is preserved", () => {
  // D5: the OpportunityKind union is shared and does NOT itself encode ownership. What IS stable and
  // already present in the code is which `kind:` literals each module EMITS. That existing disjoint
  // partition is asserted here; no new mapping is invented. The absence of a type-level distinction
  // is recorded as an architectural-review item.
  const emittedKinds = (file: string): string[] =>
    [...stripComments(read(file)).matchAll(/kind:\s*"([a-z_]+)"/g)]
      .map((m) => m[1])
      // `target: { kind: "client" | "prospect" }` is a subject kind, not an OpportunityKind.
      .filter((k) => k !== "client" && k !== "prospect")
      .sort();

  const ENGINE_OWNED = ["launched_checkin", "launched_no_retainer"];
  const LIB_OWNED = [
    "hot_lead_untouched",
    "launch_crunch",
    "low_ehr",
    "pipeline_thin",
    "production_missing",
    "proposal_cold",
    "stalled_project",
  ];

  it("the engine emits exactly its two revenue-expansion kinds", () => {
    expect([...new Set(emittedKinds("engines/opportunity-engine/index.ts"))]).toEqual(ENGINE_OWNED);
  });

  it("the lib composer emits exactly the seven retained risk/sales kinds", () => {
    expect([...new Set(emittedKinds("lib/opportunities.ts"))]).toEqual(LIB_OWNED);
  });

  it("the two sets are disjoint — no kind is emitted from both sides", () => {
    const overlap = ENGINE_OWNED.filter((k) => LIB_OWNED.includes(k));
    expect(overlap).toEqual([]);
  });
});

// ─── F11 ───────────────────────────────────────────────────────────────────────────────────────
describe("F11 · Graph / KnowledgeIndex remain isolated", () => {
  it("no engine imports packages/graph, packages/indexer, or core/knowledge", () => {
    const offenders = importsUnder("engines").filter((e) =>
      /^@\/(packages\/(graph|indexer)|core\/knowledge)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("no mission-control orchestrator imports the graph or knowledge index", () => {
    const offenders = importsUnder("mission-control").filter((e) =>
      /^@\/(packages\/(graph|indexer)|core\/knowledge)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });
});

// ─── F12 ───────────────────────────────────────────────────────────────────────────────────────
describe("F12 · no AI/agent infrastructure may be introduced", () => {
  it("no source module imports an LLM/agent SDK", () => {
    const forbidden = /^(openai|@anthropic-ai\/|anthropic|langchain|@langchain\/|llamaindex|ollama|@google\/generative-ai)/;
    // `cognition` is listed because a new top-level directory is invisible to every rule in this
    // file until it is named in one. The cognitive layer is where the pressure to reach for a model
    // will actually appear, so the ban has to reach it — see docs/COGNITION-CONTRACT.md §7.
    const offenders = [
      "engines",
      "core",
      "lib",
      "mission-control",
      "app",
      "components",
      "packages",
      "cognition",
      "relationships",
    ]
      .flatMap(importsUnder)
      .filter((e) => forbidden.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("declares no LLM/agent dependency in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const forbidden = names.filter((n) =>
      /openai|anthropic|langchain|llamaindex|ollama|generative-ai/i.test(n)
    );
    expect(forbidden).toEqual([]);
  });

  it("keeps agent job types inert — declared in domain but wired to nothing", () => {
    // AgentJobId/AgentJobStatus exist as reserved domain vocabulary. They must remain unused:
    // a consumer would mean the gate had opened.
    //
    // `packages` is deliberately absent: the two types are DECLARED in packages/domain (ids.ts,
    // enums.ts), which is the whole point — reserved vocabulary with no consumer. Adding it here
    // would fail on the declarations this rule exists to protect.
    const consumers = filesMatching(/\bAgentJob(Id|Status)\b/, [
      "engines",
      "core",
      "lib",
      "mission-control",
      "app",
      "components",
      "cognition",
    ]);
    expect(consumers).toEqual([]);
  });
});

// ─── F14 ───────────────────────────────────────────────────────────────────────────────────────
describe("F14 · surface → engine imports may be type-only; value imports are prohibited", () => {
  /**
   * D6: the pragmatic interpretation. Type-only imports are erased at runtime and are allowed.
   *
   * RESOLVED (Neural Core increment): the recorded violation was app/dashboard/page.tsx importing
   * `rank` as a VALUE and calling it directly, bypassing mission-control.assemblePriorityFeed. That
   * page has been retired to a redirect and its replacement (app/page.tsx) goes through Mission
   * Control, so the exemption is DELETED rather than carried forward.
   *
   * The rule is now absolute: no value import from app/ or components/ into engines/, with no
   * exemptions. It is strictly stronger than the version it replaces.
   */
  it("no surface module value-imports an engine", () => {
    const valueEdges = ["app", "components"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/engines\b/.test(e.specifier) && !e.typeOnly)
      .map((e) => `${e.from}:${e.line} → ${e.specifier}`);
    expect(valueEdges).toEqual([]);
  });

  it("all surface → engine imports are type-only", () => {
    const edges = ["app", "components"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/engines\b/.test(e.specifier));
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expect(edge.typeOnly).toBe(true);
  });
});

// ─── F15 ───────────────────────────────────────────────────────────────────────────────────────
describe("F15 · canonical client reader stays canonical", () => {
  /**
   * D7: KNOWN ARCHITECTURAL VIOLATION — EXEMPTED.
   *
   * lib/opportunities.readActiveClients is a second implementation of the client read-model
   * (core/crm.listClients + getClient). It is NOT consolidated in this increment and lib/opportunities
   * is NOT modified. The exemption is scoped to that exact symbol in that exact file, so a THIRD
   * client reader appearing anywhere fails this rule.
   */
  const EXEMPT_FILE = "lib/opportunities.ts";
  const EXEMPT_SYMBOL = "readActiveClients";

  it("the exempted duplicate reader still exists exactly where recorded", () => {
    expect(new RegExp(`function\\s+${EXEMPT_SYMBOL}\\b`).test(stripComments(read(EXEMPT_FILE)))).toBe(true);
  });

  it("listClients is defined only in core/crm", () => {
    expect(definitionSites("listClients", ["core", "lib", "engines", "mission-control"])).toEqual([
      "core/crm/client.ts",
    ]);
  });

  it("no engine or orchestrator reads client profile files directly", () => {
    // Engines and mission-control must never open a vault file themselves — that is precisely how a
    // second read-model is born. This half of the rule is absolute, with no exemptions.
    expect(
      filesMatching(/business_context\.md|project_scope\.md/, ["engines", "mission-control"])
    ).toEqual([]);
  });

  it("pins the exact set of modules that read client profile files (growth must be deliberate)", () => {
    /**
     * BASELINE PIN, not an endorsement. These are the modules that today open business_context.md or
     * project_scope.md directly. They fall into three distinct categories and are labelled honestly:
     *
     *   canonical core readers — the legitimate owners of a client read-model or financial fact:
     *     core/crm/client.ts        · the canonical client reader (F15's authority)
     *     core/production/state.ts  · production state + client name
     *     core/finance/revenue.ts   · contracted-revenue FACT (Phase 2.4)
     *     core/finance/care.ts      · inferred care-plan reads (Phase 2.4)
     *     core/knowledge/index.ts   · the single vault walk for the KnowledgeIndex
     *
     *   EXEMPTED duplicate read-model (D7) — the one true F15 violation, not modified here:
     *     lib/opportunities.ts      · readActiveClients duplicates the client read-model
     *
     *   pre-existing direct readers for CONTEXT TEXT, not read-models. These are instances of the
     *   separately-recorded "raw fs outside core/vault" finding, NOT duplicate client readers:
     *     lib/automations.ts          · reads a client name for automation context
     *     lib/compileDocumentBrief.ts · clipboard brief context
     *     lib/compileOpportunityBrief.ts · clipboard brief context
     *
     * Pinning the set means any NEW reader anywhere fails this test and must be justified.
     */
    const PINNED = [
      "core/crm/client.ts",
      "core/finance/care.ts",
      "core/finance/revenue.ts",
      "core/knowledge/index.ts",
      "core/production/state.ts",
      "lib/automations.ts",
      "lib/compileDocumentBrief.ts",
      "lib/compileOpportunityBrief.ts",
      EXEMPT_FILE,
    ].sort();

    const actual = filesMatching(/business_context\.md|project_scope\.md/, [
      "engines",
      "core",
      "lib",
      "mission-control",
    ]).sort();

    expect(actual).toEqual(PINNED);
  });
});

// ─── F17 ───────────────────────────────────────────────────────────────────────────────────────
describe("F17 · graph-view is a disposable projection, never a source of truth", () => {
  /**
   * graph-view/ is the presentation-layer graph adapter added for the Neural Core. It exists ONLY
   * because the KnowledgeIndex covers 3 of 25 EntityKinds (docs/GRAPH-CONTRACT.md GAP-1/2/3), and it
   * must stay incapable of becoming a second read-model. These rules encode that.
   */
  it("performs no filesystem access of its own — all I/O belongs to a canonical reader", () => {
    const offenders = importsUnder("graph-view").filter((e) =>
      /^(node:|fs$|fs\/promises$|path$)/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("never opens a client profile file directly (F15's absolute half applies here too)", () => {
    expect(filesMatching(/business_context\.md|project_scope\.md|structural_meta\.json/, ["graph-view"])).toEqual([]);
  });

  it("introduces no module-level mutable state — a cache is persistence by another name", () => {
    const offenders = sourceFiles("graph-view").filter((f) => /^(let|var)\s/m.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });

  it("writes nothing and emits no events", () => {
    expect(
      filesMatching(/\bemitEvent\b|\bwriteFile\w*|\bappendFile\w*|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b/, [
        "graph-view",
      ])
    ).toEqual([]);
  });

  it("value-imports no engine — engines are reached through Mission Control", () => {
    const offenders = importsUnder("graph-view").filter(
      (e) => /^@\/engines\b/.test(e.specifier) && !e.typeOnly
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("keeps the renderer independent of the data producer (the swap must stay a one-line change)", () => {
    // components/graph/* must never import the projection: it depends on the CONTRACT only. If this
    // fails, replacing the projection with the real indexer would require a UI rewrite.
    const offenders = importsUnder("components/graph").filter((e) =>
      /^@\/(graph-view\/projection|core|lib|mission-control|relationships)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("leaves the frozen Phase 4 index contracts unmodified by this layer", () => {
    // graph-view CONSUMES the KnowledgeIndex; it must never re-implement indexing or traversal.
    expect(filesMatching(/\bbuildIndex\s*\(|IndexContributor|MutableKnowledgeIndex/, ["graph-view"])).toEqual([]);
  });
});

// ─── F18 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * The ENTITY SURFACES: routes whose whole job is to select existing read-models and render them.
 *
 *   app/clients     the Client → Project vertical (dossier.ts narrows global output to one client)
 *   app/crm         the Clients index (roster.ts joins the same global outputs across all clients)
 *   app/production  the build index (joins production state with Health and Decision output)
 *
 * `app/crm` and `app/production` were added when they were migrated into the Neural Core language.
 * Both had been thin enough to be uninteresting; once they started consuming Health and Decision
 * output they acquired exactly the failure mode F18 exists to prevent, so they are held to it.
 *
 * Deliberately NOT in this list: app/tasks, which legitimately calls `computeEhr` — the OWNER of
 * that interpretation (lib/ehr). Calling an owner is the correct posture; only re-implementing it
 * on the surface is a violation, and that copy has been removed.
 */
const ENTITY_SURFACES = ["app/clients", "app/crm", "app/production"];

describe("F18 · the entity surface selects; it never computes", () => {
  /**
   * The narrow `app/crm/[client]/portal/page.tsx` exemption that lived here is GONE (Increment 8).
   * Its retirement condition — fold the profile prose into app/clients/[slug], move portal
   * administration to app/clients/[slug]/portal, delete app/crm/[client]/** — is satisfied, and
   * the migrated page needs no `node:path` at all: it called `path.basename` on `saved_name`,
   * which lib/portal already produces as a bare filename, so the import was a no-op.
   *
   * The rule is now ABSOLUTE. No fs/path import anywhere under the entity surfaces.
   */
  it("performs no filesystem access — all I/O belongs to a canonical reader", () => {
    const offenders = ENTITY_SURFACES.flatMap((dir) =>
      importsUnder(dir).filter((e) => /^(node:|fs$|fs\/promises$|path$)/.test(e.specifier))
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("opens no vault file directly (F15's absolute half applies here too)", () => {
    expect(
      filesMatching(/business_context\.md|project_scope\.md|structural_meta\.json/, ENTITY_SURFACES)
    ).toEqual([]);
  });

  it("writes nothing and emits no events — the entity views are read-only", () => {
    expect(
      filesMatching(
        /\bemitEvent\b|\bwriteFile\w*|\bappendFile\w*|\bwriteJsonFileAtomic\b/,
        ENTITY_SURFACES
      )
    ).toEqual([]);
  });

  it("never re-ranks: Decision's order is consumed, never recomputed", () => {
    // `rank(` here would mean the surface had taken over Decision's job. Reaching ranking through
    // mission-control.assemblePriorityFeed is the only permitted path (F14).
    expect(filesMatching(/\brank\s*\(/, ENTITY_SURFACES)).toEqual([]);
    expect(
      filesMatching(
        /\bcomputeHealthScore\s*\(|\bcomputeScore\s*\(|\bcomputeEhr\s*\(/,
        ENTITY_SURFACES
      )
    ).toEqual([]);
  });

  it("never classifies site quality itself — the Site Quality Engine owns the bands", () => {
    // The Maintenance surface used to hand-code `>= 90` / `>= 50` against Lighthouse scores, which
    // is `classify()` in engines/site-quality-engine reproduced on the surface. Any reappearance of
    // a bare Lighthouse threshold in a surface file is that duplication coming back.
    expect(
      filesMatching(/score\s*>=\s*(90|50)\b/, [
        ...ENTITY_SURFACES,
        "app/maintenance",
        "components/AuditClientCard.tsx",
      ])
    ).toEqual([]);
  });

  it("reaches ranked attention through Mission Control", () => {
    for (const dir of ENTITY_SURFACES) {
      expect(importsUnder(dir).map((e) => e.specifier)).toContain("@/mission-control");
    }
  });
});

// ─── F19 ───────────────────────────────────────────────────────────────────────────────────────
describe("F19 · graph identity has one owner", () => {
  /**
   * `GraphNode.id` is defined by graph-view/contract as `${type}:${entityId}`. Four surfaces used
   * to hand-build that string to construct `/?focus=…`, which duplicated the id format and left
   * every caller unable to tell whether an entity is representable in the graph at all — EntityKind
   * has 25 members and GraphNodeType only 12, so Signals emitted focus links for kinds the graph
   * cannot contain.
   *
   * `graphNodeIdFor` / `focusHrefFor` in the contract are now the only place that format exists.
   * This is graph IDENTITY, distinct from navigation/routing, which owns entity → ROUTE and stays
   * the single owner of that.
   */
  it("no surface hand-builds a focus URL", () => {
    // Matches `focus=${...}:${...}` and `/?focus=` followed by a template literal — i.e. an id
    // assembled at the call site rather than obtained from the contract.
    const offenders = filesMatching(/focus=\$\{[^}]*\}:|`\/\?focus=\$\{(?!encodeURIComponent\(f)/, [
      "app",
      "components",
    ]).filter((f) => !f.startsWith("graph-view/"));
    expect(offenders).toEqual([]);
  });

  it("the id format never appears outside graph-view", () => {
    // graph-view legitimately contains it twice: contract.ts DEFINES the format, projection.ts
    // (the current producer) EMITS it while building nodes. Everywhere else must obtain an id from
    // the contract rather than assembling one.
    const sites = filesMatching(/\$\{entity\}:\$\{entityId\}|\$\{type\}:\$\{entityId\}/, [
      "app",
      "components",
      "mission-control",
      "navigation",
      // cognition keys nodes by the domain pair and collapses them with a FORWARD SLASH. It is the
      // layer most likely to want a node id string, and the graph's format is not its to reuse.
      "cognition",
    ]);
    expect(sites).toEqual([]);
  });

  it("the graph contract stays free of routing knowledge", () => {
    // focusHrefFor returns a Neural Core href, which is the graph's OWN route — it must not start
    // resolving entity detail routes, which belong to navigation/routing.
    const edges = importsOf("graph-view/contract.ts").map((e) => e.specifier);
    expect(edges).not.toContain("@/navigation/routing");
  });
});

// ─── F20 ───────────────────────────────────────────────────────────────────────────────────────
describe("F20 · routes are resolved, never constructed", () => {
  /**
   * navigation/routing is the single owner of entity → route. Increment 8 retired the last three
   * places that had quietly become secondary owners:
   *   • engines/opportunity-engine — an `href` field on Opportunity, built as `/crm/:slug`. A pure
   *     engine must not know routes at all. The field had zero consumers and was removed.
   *   • app/api/prospects/[slug]/promote — hardcoded `crm:` / `portal:` strings in its response.
   *   • app/production/[client] — a hardcoded `/crm/:slug` back-link.
   *
   * The `/crm/:slug` route itself no longer exists, so any reappearance is both a dead link and a
   * routing-ownership violation.
   */
  it("no engine constructs a route", () => {
    // A route literal inside a pure engine is presentation data in the wrong layer.
    expect(filesMatching(/["'`]\/(crm|clients|sales|production|documents|finance)\//, ["engines"])).toEqual(
      []
    );
  });

  it("the retired /crm/:slug route is referenced nowhere in executable code", () => {
    // Comments recording the migration are allowed; `filesMatching` reads stripped source, so this
    // matches only live code.
    const offenders = filesMatching(/["'`]\/crm\/\$\{|["'`]\/crm\/[a-z[]/, [
      "app",
      "components",
      "lib",
      "core",
      "engines",
      "mission-control",
      "navigation",
      "graph-view",
      "packages",
    ]);
    expect(offenders).toEqual([]);
  });

  it("the CRM client detail routes are gone from the filesystem", () => {
    expect(sourceFiles("app/crm").filter((f) => f.includes("[client]"))).toEqual([]);
  });

  it("routeForEntity remains the sole entity → route resolver", () => {
    expect(definitionSites("routeForEntity", ["app", "components", "lib", "core", "navigation", "engines"])).toEqual(
      ["navigation/routing.ts"]
    );
  });
});

// ─── F21 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * THE PROVENANCE RULE (Increment 10) — the OS's permanent position on where memory comes from:
 *
 *   Every durable state transition must have an observable provenance. If Ascend owns the write,
 *   the writer emits the event. If an external editor can own the write, a reconciler must observe
 *   it. No layer may fabricate an event for a transition it did not actually observe.
 *
 * Ascend is NOT the sole author of the vault — the operator also edits it in Obsidian — so the rule
 * has two legitimate paths into memory, and this file can only enforce the first:
 *
 *   ASCEND MUTATION → core write → (vault state + event) → memory     ← enforced below
 *   OBSIDIAN MUTATION → vault state → reconciler → event → memory     ← does not exist yet
 *
 * What is deliberately NOT asserted here: that an emitted event is CORRECT, exactly-once, or absent
 * on a no-op. Static text cannot show that. It is proven behaviourally, per writer, against a
 * fixture vault in tests/engines/event-emission.test.ts. This rule catches one specific regression
 * that behavioural tests cannot: a NEW writer added with no memory at all.
 */
describe("F21 · a module that writes durable state can remember doing so", () => {
  /** Text that indicates a durable write to the vault or its sidecars. */
  const WRITE_PRIMITIVE =
    /\bwriteFileAtomic\b|\bwriteMarkdownFileAtomic\b|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b|\bappendJsonl\b|\brewriteJsonl\b|\bfs\.writeFile\b|\bfs\.appendFile\b|\bfs\.unlink\b|\bfs\.rm\b/;

  /**
   * NARROW, NAMED exemptions. Each is a real gap, recorded rather than papered over.
   *
   *  core/vault/io.ts, core/vault/markdown.ts
   *    The write PRIMITIVES themselves. They are the mechanism every writer uses; they perform no
   *    business transition and have no subject to attribute an event to.
   *
   *  app/api/prospects/[slug]/route.ts   (deletes a prospect file)
   *  app/api/admin/wipe/route.ts         (clears the transactional sidecars)
   *    packages/domain defines NO event type for either transition. Inventing `prospect.deleted` or
   *    a wipe event purely to satisfy this rule would be exactly the fabrication the provenance rule
   *    forbids. RETIREMENT: if the domain ever gains those types, delete the exemption and emit.
   */
  const EXEMPT = new Set([
    "core/vault/io.ts",
    "core/vault/markdown.ts",
    "app/api/prospects/[slug]/route.ts",
    "app/api/admin/wipe/route.ts",
  ]);

  it("every durable writer either emits an event or is a named, reasoned exemption", () => {
    const writers = filesMatching(WRITE_PRIMITIVE, ["core", "lib", "app"]);
    // The rule is worthless if it matches nothing — prove it is finding real writers.
    expect(writers.length).toBeGreaterThan(8);

    const silent = writers.filter((f) => !EXEMPT.has(f) && filesMatching(/\bemitEvent\b/, [f]).length === 0);
    expect(silent).toEqual([]);
  });

  it("every exemption still exists (a stale exemption is a hole nobody is watching)", () => {
    const writers = new Set(filesMatching(WRITE_PRIMITIVE, ["core", "lib", "app"]));
    for (const f of EXEMPT) expect(writers.has(f)).toBe(true);
  });

  it("durable writes live in core or lib, never in a route handler", () => {
    // Prospect creation used to call fs.writeFile from two API routes, which put vault I/O in the
    // surface AND meant creation left no memory. Both now delegate to core/crm.createProspect.
    // Only the two event-less exemptions above may still write from app/.
    const surfaceWriters = filesMatching(WRITE_PRIMITIVE, ["app"]).filter((f) => !EXEMPT.has(f));
    expect(surfaceWriters).toEqual([]);
  });

  it("prospect creation has exactly one durable writer", () => {
    expect(definitionSites("createProspect", ["core", "lib", "app", "packages"])).toEqual([
      "core/crm/prospect.ts",
    ]);
  });
});

// ─── F16 ───────────────────────────────────────────────────────────────────────────────────────
describe("F16 · packages/domain remains a pure shared kernel", () => {
  it("imports nothing with I/O and nothing from an outer layer", () => {
    const offenders = importsUnder("packages/domain").filter(
      (e) =>
        /^(node:|fs$|path$)/.test(e.specifier) ||
        /^@\/(core|lib|engines|mission-control|app|components)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("reads no environment and performs no fetch", () => {
    expect(filesMatching(/\bprocess\.env\b|\bfetch\s*\(/, ["packages/domain"])).toEqual([]);
  });
});

// ─── F23 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * relationships/ is the canonical structural substrate (docs/STRUCTURAL-SUBSTRATE.md). It answers
 * exactly one question — "what is structurally connected?" — from foreign keys that already exist
 * on disk, and it is deliberately boring: nothing learned, nothing ranked, nothing inferred.
 *
 * WHY IT EXISTS. Structural derivation used to live inside graph-view/projection, which carries its
 * own retirement notice. Cognition needs the same truth and must not depend on a module marked for
 * deletion — and this repository already holds three graph representations, so duplication would
 * have produced a fourth. Both consumers now read one owner:
 *
 *     relationships → graph-view/projection   (draws them)
 *     relationships → mission-control         (injects them into cognition)
 *
 * The rule these tests exist to defend, beyond the usual purity: ENGINE JUDGMENTS ARE NOT TERRAIN.
 * An `opportunity` is not a vault entity — lib/opportunities synthesises it per request — so its
 * `flags` edges are an interpretation. graph-view may draw one; nothing may traverse one as
 * structure. That is the same epistemic collapse F22 prevents for learned vs structural, one layer
 * further down.
 */
describe("F23 · relationships is structural truth, and only structural truth", () => {
  it("has source files — these rules must never pass because the layer is empty", () => {
    expect(sourceFiles("relationships").length).toBeGreaterThan(0);
  });

  it("F23.1 · performs no I/O of its own — all reads go through canonical readers", () => {
    const offenders = importsUnder("relationships").filter((e) =>
      /^(node:|fs$|fs\/promises$|path$|crypto$|child_process$|http|https$|net$|os$)/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
    expect(filesMatching(/\bprocess\.env\b|\bfetch\s*\(/, ["relationships"])).toEqual([]);
  });

  it("F23.2 · introduces no module-level mutable state — built per request, never cached", () => {
    const offenders = sourceFiles("relationships").filter((f) =>
      /^(let|var)\s/m.test(stripComments(read(f)))
    );
    expect(offenders).toEqual([]);
  });

  it("F23.3 · writes nothing and emits no events", () => {
    expect(
      filesMatching(
        /\bemitEvent\b|\bwriteFile\w*|\bappendFile\w*|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b/,
        ["relationships"]
      )
    ).toEqual([]);
  });

  it("F23.4 · depends on no consumer and on no engine", () => {
    // The whole point of the extraction: no reverse dependency. If this fails, structural truth has
    // started depending on something that consumes it.
    const offenders = importsUnder("relationships").filter((e) =>
      /^@\/(graph-view|cognition|app|components|mission-control|engines)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("F23.5 · computes no business judgement — it copies foreign keys, it does not derive", () => {
    expect(
      filesMatching(
        /\bcomputeScore\b|\bcomputeHealthScore\b|\bcomputeEhr\b|\bdetectOpportunities\b|\brank\s*\(/,
        ["relationships"]
      )
    ).toEqual([]);
  });

  it("F23.6 · never mints a graph node id — that format belongs to graph-view (F19)", () => {
    expect(
      filesMatching(/\$\{entity\}:\$\{entityId\}|\$\{type\}:\$\{entityId\}/, ["relationships"])
    ).toEqual([]);
  });

  it("F23.7 · engine judgments cannot enter the substrate", () => {
    // `flags` and `opportunity` are interpretations, not foreign keys. Neither may appear in this
    // layer's CODE — the contract may discuss why they are excluded, since comments are stripped.
    expect(filesMatching(/\bflags\b|\bopportunit(y|ies)\b/, ["relationships"])).toEqual([]);
  });

  it("F23.8 · the structural vocabulary stays a strict subset of the graph's edge types", () => {
    // graph-view maps StructuralRelationshipKind → GraphEdgeType through an explicit record, so the
    // subset relationship is compile-checked rather than an accident of shared literals. The record
    // is module-local (not exported), so this matches source text rather than definition sites.
    expect(filesMatching(/STRUCTURAL_EDGE_TYPE/, ["graph-view"])).toEqual([
      "graph-view/projection.ts",
    ]);
    // And the projection no longer hand-builds any structural edge.
    expect(
      filesMatching(/edge\("(has_project|has_phase|has_task|billed|promoted_to)"/, ["graph-view"])
    ).toEqual([]);
  });
});

// ─── F22 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * cognition/ is the computational cognition boundary (docs/COGNITION-CONTRACT.md). It learns what
 * tends to occur together, and it is DERIVED STATE: rebuildable, deletable, and structurally
 * incapable of deciding what is true.
 *
 * These rules exist before any learning logic does, which is the point. graph-view got F17 only
 * after it existed; this layer gets its walls in the commit that creates it, so there is never a
 * window in which a cognitive module could quietly acquire a filesystem handle, a cache, or a
 * model.
 *
 * THE RULE BEHIND THE RULES: anything a human answered is a fact, anything a machine derived is a
 * cache. Every assertion below is downstream of that. The failure mode being prevented is not a bad
 * learning rule — it is a chain of individually reasonable derivations (association → pattern →
 * prediction → hypothesis) arriving at a claim of truth nobody authorised.
 *
 * KNOWN GAP, recorded rather than silently fixed: F22.6 bans the ambient clock in cognition only.
 * engines/opportunity-engine (Date.now) and engines/health-engine (new Date) both read it today, so
 * widening that rule to `engines` would fail immediately. Injected-clock discipline is enforced
 * behaviourally for those two in tests/engines, and structurally only here.
 */
describe("F22 · cognition is derived state, never a source of truth", () => {
  it("has source files — these rules must never pass because the layer is empty", () => {
    expect(sourceFiles("cognition").length).toBeGreaterThan(0);
  });

  it("F22.1 · performs no I/O of its own", () => {
    const offenders = importsUnder("cognition").filter((e) =>
      /^(node:|fs$|fs\/promises$|path$|crypto$|child_process$|http|https$|net$|os$)/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
    expect(filesMatching(/\bprocess\.env\b|\bfetch\s*\(/, ["cognition"])).toEqual([]);
    expect(importsUnder("cognition").filter((e) => e.specifier === "server-only")).toEqual([]);
  });

  it("F22.2 · introduces no module-level mutable state — a cache is persistence by another name", () => {
    const offenders = sourceFiles("cognition").filter((f) => /^(let|var)\s/m.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });

  it("F22.3 · writes nothing and emits no events", () => {
    expect(
      filesMatching(
        /\bemitEvent\b|\bwriteFile\w*|\bappendFile\w*|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b|\bmkdir\b|\bunlink\b/,
        ["cognition"]
      )
    ).toEqual([]);
  });

  it("F22.4 · imports no outer layer, and never the graph", () => {
    // @/graph-view is the one people will want to break. graph-view/projection carries its own
    // retirement notice and F17 keeps it disposable; cognition depending on it would invert exactly
    // the property that makes the projection safe to delete. Structural context is INJECTED.
    const offenders = importsUnder("cognition").filter((e) =>
      /^@\/(lib|app|components|mission-control|engines|graph-view|packages\/(graph|indexer)|core\/knowledge)\b/.test(
        e.specifier
      )
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("F22.5 · reaches core only through types, with zero exemptions", () => {
    // F6 had to grandfather opportunity-engine. This layer starts clean and stays that way.
    const valueEdges = importsUnder("cognition").filter(
      (e) => /^@\/core\b/.test(e.specifier) && !e.typeOnly
    );
    expect(valueEdges.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("F22.6 · reads no clock and no randomness — `now` is injected, always", () => {
    // Decay is a function of elapsed time. A clock read here would make the fold unreproducible,
    // which is the single property the whole layer is built on.
    expect(filesMatching(/\bnew Date\s*\(|\bDate\.now\s*\(|\bMath\.random\s*\(/, ["cognition"])).toEqual([]);
  });

  it("F22.7 · never opens a vault file (F15's absolute half applies here too)", () => {
    expect(
      filesMatching(/business_context\.md|project_scope\.md|structural_meta\.json/, ["cognition"])
    ).toEqual([]);
  });

  it("F22.8 · never mints a graph node id — that format belongs to graph-view (F19)", () => {
    expect(filesMatching(/\$\{entity\}:\$\{entityId\}|\$\{type\}:\$\{entityId\}/, ["cognition"])).toEqual([]);
  });

  it("F22.9 · every numeric bound has exactly one owner", () => {
    // The F7/F8/F9 single-authority pattern. A bound defined twice is a bound nobody owns.
    for (const bound of [
      "S_MAX",
      "CONFIDENCE_MAX",
      "SESSION_GAP_MS",
      "REINFORCEMENT_RATE",
      "DECAY_HALF_LIFE_MS",
      "MAX_SESSION_ACTIVATIONS",
      "RELEVANCE_HALF_LIFE_MS",
      "DORMANCY_THRESHOLD",
      "ARCHIVAL_THRESHOLD",
    ]) {
      expect(definitionSites(bound, ["cognition"])).toHaveLength(1);
    }
    // And they live in bounds.ts specifically, not wherever they were first needed.
    expect(definitionSites("S_MAX", ["cognition"])).toEqual(["cognition/bounds.ts"]);
  });

  it("F22.10 · provenance and epistemics are never optional", () => {
    // An artifact that can omit its evidence is an artifact that can be fabricated. A surface must
    // never be able to render a learned association without being able to show what produced it.
    expect(filesMatching(/\bprovenance\?\s*:|\bepistemics\?\s*:/, ["cognition"])).toEqual([]);
  });

  it("F22.11 · strength and confidence stay separate axes", () => {
    // Strength answers "how strongly?"; confidence answers "on what basis?". Deriving either from
    // the other alone produces one number that means neither.
    expect(
      filesMatching(
        /\bconfidence\s*[:=][^;\n]*\bstrength\b|\bstrength\s*[:=][^;\n]*\bconfidence\b/,
        ["cognition"]
      )
    ).toEqual([]);
  });

  it("F22.12 · declares no structural relationship — learned and structural stay apart by absence", () => {
    // A structural edge is a foreign key that exists on disk; it does not learn, decay, or carry
    // confidence. Keeping the vocabulary out entirely is stronger than a discriminant field: no
    // code path here can express a structural claim even by accident.
    expect(filesMatching(/\bGraphEdgeType\b|\bhas_project\b|\bwikilink\b/, ["cognition"])).toEqual([]);
  });

  it("F22.13 · cannot author a claim at fact or witnessed tier", () => {
    // The epistemic ladder made unrepresentable rather than merely documented. `fact` belongs to the
    // Vault and `witnessed` to the Event Spine; a derived layer asserting either is precisely the
    // fabrication the provenance rule (F21) forbids.
    expect(filesMatching(/\bepistemics\s*:\s*["'](fact|witnessed)["']/, ["cognition"])).toEqual([]);
  });
});