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
    const offenders = ["engines", "core", "lib", "mission-control", "app", "components", "packages"]
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
    const consumers = filesMatching(/\bAgentJob(Id|Status)\b/, [
      "engines",
      "core",
      "lib",
      "mission-control",
      "app",
      "components",
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
      /^@\/(graph-view\/projection|core|lib|mission-control)\b/.test(e.specifier)
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
   * NARROW, NAMED exemption. `app/crm/[client]/**` is the LEGACY client detail route that predates
   * the canonical `/clients/:slug` view; it survives only because it still owns two capabilities
   * the new view does not render (the profile prose, and portal invite/approval management). Its
   * portal page imports `node:path` for `path.basename` on a stored path — string formatting, not
   * filesystem access.
   *
   * RETIREMENT: fold the profile sections into app/clients/[slug] and move portal management to
   * app/clients/[slug]/portal, then delete app/crm/[client]/** AND this exemption. Any OTHER fs
   * import anywhere under the entity surfaces still fails.
   */
  const F18_FS_EXEMPT = ["app/crm/[client]/portal/page.tsx"];

  it("performs no filesystem access — all I/O belongs to a canonical reader", () => {
    const offenders = ENTITY_SURFACES.flatMap((dir) =>
      importsUnder(dir).filter(
        (e) =>
          /^(node:|fs$|fs\/promises$|path$)/.test(e.specifier) && !F18_FS_EXEMPT.includes(e.from)
      )
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