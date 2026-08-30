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
import { readdirSync } from "node:fs";
import path from "node:path";
import { ROUTE_AUTHORIZATION } from "@/core/auth/routes";
import { can } from "@/core/auth/capabilities";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
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
      "migration",
      "onboarding",
      // Added with the directory it names. F12's own header records why: a new top-level directory
      // is invisible to every rule in this file until it is listed in one, so the listing is part of
      // creating the directory rather than a later tidy-up.
      "identity-backfill",
      "substrate-migration",
      // core/db is already covered by "core". Named here anyway when apps/sales lands, since that
      // surface will import the shared substrate and F12's protection is DIRECTORY-scoped: the
      // monorepo root already ships @anthropic-ai/sdk for the marketing site's onboarding chat, so
      // a new surface is exactly where the prohibition could be walked around without noticing.
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
    // `migration` is included because a new top-level directory is invisible to every rule in this
    // file until it is named in one, and the migration is the single largest durable writer ever
    // added to this system. It passes on its own terms: migration/apply.ts calls emitEvent for
    // `observation.captured` baselines. Leaving it unscanned would have been a hole precisely where
    // the provenance rule matters most.
    // `identity-backfill` is listed for the same reason `migration` is: an unscanned top-level
    // directory is a hole exactly where the provenance rule matters. It passes by having no write
    // primitive at all — every write it causes goes through core/crm.createProspect.
    const writers = filesMatching(WRITE_PRIMITIVE, [
      "core",
      "lib",
      "app",
      "migration",
      "onboarding",
      "identity-backfill",
      "substrate-migration",
      // core/db is already covered by "core". Named here anyway when apps/sales lands, since that
      // surface will import the shared substrate and F12's protection is DIRECTORY-scoped: the
      // monorepo root already ships @anthropic-ai/sdk for the marketing site's onboarding chat, so
      // a new surface is exactly where the prohibition could be walked around without noticing.
    ]);
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

  it("prospect creation has exactly one durable writer PER STORE", () => {
    /**
     * DUAL-STORE PERIOD — a real architectural state, recorded rather than papered over.
     *
     * Stage 2A adds the shared substrate WITHOUT flipping any reader: the vault stays authoritative
     * until Stage 2B has verified parity. So two writers legitimately exist, one per store, and each
     * is still the sole writer for its own. A THIRD entry here fails, which is the property that
     * matters.
     *
     * RETIREMENT: when Stage 2B flips prospect reads to Postgres and the vault writer is retired,
     * this returns to a single entry. An exemption that outlives its condition is a hole nobody is
     * watching (the F21 posture on stale exemptions), so this must shrink, not linger.
     */
    expect(definitionSites("createProspect", ["core", "lib", "app", "packages"]).sort()).toEqual([
      "core/crm/prospect.ts",   // vault  — authoritative today
      "core/db/prospects.ts",   // shared — built, not yet read from
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

// ─── F24 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * The working-surface ownership boundary (docs/WORKING-SURFACE.md, slice 1).
 *
 * A surface may RENDER a decision; it may never MAKE one. The notification queue is the first place
 * that distinction had teeth: "what needs my attention" is notification behaviour, and a hand-rolled
 * predicate over `status` in a component would quietly relocate it into the UI — where it could then
 * drift from the engine without anything failing.
 *
 * These rules make the ownership executable rather than documented, so that if the assembler ever
 * changes which notifications belong in the open queue, the surface follows it without notification
 * logic changing in `app/`.
 */
describe("F24 · surfaces render decisions, they do not make them", () => {
  it("the notification partition has exactly one owner, in mission-control", () => {
    expect(
      definitionSites("partitionNotifications", ["app", "components", "mission-control", "lib", "core"])
    ).toEqual(["mission-control/notifications.ts"]);
  });

  it("the attention surface consumes that partition rather than deriving its own", () => {
    expect(importsOf("app/signals/page.tsx").map((e) => e.specifier)).toContain("@/mission-control");
    expect(filesMatching(/partitionNotifications/, ["app"])).toEqual(["app/signals/page.tsx"]);
  });

  it("no surface decides notification membership by hand", () => {
    // Rendering a status as a label is presentation. Deciding QUEUE MEMBERSHIP from it is not.
    const offenders = filesMatching(
      /status\s*===\s*["'](raised|snoozed|dismissed)["']/,
      ["app", "components"]
    );
    expect(offenders).toEqual([]);
  });

  it("the snooze duration is owned by the engine, never by a surface", () => {
    // "Hide until T" determines when the engine considers an item eligible again — behaviour, not
    // presentation. A surface defining its own would be establishing domain semantics silently.
    expect(
      definitionSites("SNOOZE_DURATION_MS", ["engines", "app", "components", "mission-control", "lib", "core"])
    ).toEqual(["engines/notification-engine/index.ts"]);
    expect(filesMatching(/SNOOZE_MS|SNOOZE_DURATION_MS/, ["app", "components"])).toEqual([]);
  });

  it("notification state transitions stay in core, never in a route or action", () => {
    // F21 already requires durable writes to live in core/lib; this pins the specific case, because
    // an action that wrote the record itself is the exact arrangement that rule exists to prevent.
    expect(filesMatching(/\bemitEvent\b/, ["app/signals"])).toEqual([]);
    expect(importsOf("app/signals/actions.ts").map((e) => e.specifier)).toContain("@/core/notifications");
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
      "MAX_PROPAGATION_HOPS",
      "MAX_PATHS_PER_NODE",
      "MAX_PATHS_EXPLORED",
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
// ─── F25 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * THE MIGRATION IS A ONE-SHOT TOOL, NOT A CAPABILITY (docs/HISTORICAL-BACKFILL-H5.md).
 *
 * `migration/` rewrites the OS's account of its own past. That makes it the most dangerous module
 * in the system and the one most likely to be reached for casually later — "we already have code
 * that edits phase state" is exactly how a reviewed one-shot becomes an unreviewed runtime path.
 *
 * These rules keep it inert between deliberate, reviewed runs.
 */
describe("F25 · the historical migration stays a reviewed one-shot", () => {
  it("no surface, engine or runtime module imports it", () => {
    // If a route or engine can reach it, it is no longer a tool run under review.
    const offenders = ["app", "components", "engines", "mission-control", "core", "lib", "cognition", "relationships", "graph-view"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/migration\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("emits exactly one event type, and never a business event", () => {
    // THE HEADLINE INVARIANT, enforced against source text: historical correction may change what
    // Ascend believes; it may not claim the underlying business changed today.
    const emitted = filesMatching(/type:\s*["'](?!observation\.captured)[a-z_]+\.[a-z_]+["']/, ["migration"]);
    expect(emitted).toEqual([]);
  });

  it("always passes `actor` explicitly, never inheriting the operator default", () => {
    // core/events defaults actor to "operator". §19's adoption measurement is running concurrently,
    // so a migration event inheriting that default would corrupt the number it exists to measure.
    const src = sourceFiles("migration").map(read).join("\n");
    const emitCalls = (src.match(/emitEvent\s*\(/g) ?? []).length;
    const explicitSystemActors = (src.match(/actor:\s*["']system["']/g) ?? []).length;
    expect(emitCalls).toBeGreaterThan(0);
    expect(explicitSystemActors).toBeGreaterThanOrEqual(emitCalls);
  });

  it("planning cannot write — the write primitives live only in apply", () => {
    const WRITE = /\bwriteFileAtomic\b|\bwriteMarkdownFileAtomic\b|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b|\bfs\.writeFile\b|\bfs\.rm\b|\bemitEvent\b/;
    const writers = filesMatching(WRITE, ["migration"]);
    expect(writers).toEqual(["migration/apply.ts"]);
  });

  it("keeps the declared exclusion — Bay Area Custom Shirts is never migrated", () => {
    // H5 §6.6: its record asserts a lead became a client. Correcting that needs a vocabulary for
    // "entered in error" which the domain does not have. Its absence must stay deliberate.
    const src = read("migration/evidence.ts");
    expect(src).toMatch(/DECLARED_EXCLUSIONS[\s\S]*bay-area-custom-shirts-inc/);
    const subjects = src.slice(src.indexOf("DECLARED_SUBJECTS"), src.indexOf("DECLARED_EXCLUSIONS"));
    expect(subjects).not.toContain("bay-area-custom-shirts-inc");
  });
});

// ─── F26 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * AUTHORITY FOLLOWS OBSERVABILITY (docs/SOURCE-AUTHORITY.md §3, COMMERCIAL-PROVENANCE.md §4).
 *
 * Two facts were asserted by two files each, and in both pairs the field the OS ACTED on was not
 * the field the reconciler OBSERVED — behaviour with no provenance, which F21 forbids. A third
 * defect let a catalog price answer "what is this client worth".
 *
 * Step 5 repaired the consumers. These rules stop the old paths being reintroduced by anyone —
 * human or model — who finds `project_scope.md` and reasonably assumes it is authoritative.
 * Documents persuade; fitness rules hold.
 */
describe("F26 · behaviour reads the observed field, and a catalog is not a contract", () => {
  /** Files permitted to open project_scope.md at all, each for a non-behavioural reason. */
  const SCOPE_READERS = [
    "core/crm/client.ts", // declares the profile file set; creates the file on promotion
    "core/finance/revenue.ts", // reads `revenue_usd` — an explicitly recorded contract value
    "lib/compileOpportunityBrief.ts", // scope CONTENT (deliverables) for AI context
    // The migration must open the file in order to RETIRE the duplicated keys from it. It is the
    // one reader whose purpose is to make the others unnecessary, and F25 already keeps it out of
    // every runtime path.
    "migration/plan.ts",
    "migration/apply.ts",
  ];

  it("only declared readers open project_scope.md", () => {
    const readers = filesMatching(/project_scope\.md/, ["core", "lib", "engines", "app", "mission-control", "migration", "graph-view"]);
    expect(readers.sort()).toEqual([...SCOPE_READERS].sort());
  });

  it("F26.1/26.2 · the retired scope fields have no consumer anywhere", () => {
    // `phase`, `status`, `package` and `launch_target` on project_scope.md are retired
    // (SOURCE-AUTHORITY §4.5). Their authoritative homes are production_state.md and
    // structural_meta.json. Any reappearance of these access shapes is the old path returning.
    const offenders = filesMatching(
      /\bsfm\.(status|launch_target|package|phase)\b|\bscope\.(fm|frontmatter)\.(status|launch_target|package|phase)\b/,
      ["core", "lib", "engines", "app", "mission-control", "graph-view"]
    );
    expect(offenders).toEqual([]);
  });

  it("F26.3 · no revenue-producing module consults the price catalog", () => {
    // TIER_PRICES answers "what does this package list at". It may never answer "what was agreed".
    // `filesMatching` strips comments, so the prose explaining WHY the fallback was removed does
    // not itself trip the rule — an earlier draft of this assertion used raw text and flagged its
    // own documentation.
    const offenders = filesMatching(/\bTIER_PRICES\b/, ["core", "engines", "mission-control"]);
    expect(offenders).toEqual([]);
  });

  it("F26.4 · getClientRevenue is a single owner with no catalog fallback", () => {
    expect(definitionSites("getClientRevenue", ["core", "lib", "engines", "mission-control"])).toEqual([
      "core/finance/revenue.ts",
    ]);
    const src = stripComments(read("core/finance/revenue.ts"));
    expect(src).not.toMatch(/TIER_PRICES|normalizeTier/);
  });

  it("F26.5 · behaviour-bearing lifecycle rules read the OBSERVED identity anchor", () => {
    // The load-bearing rule. `structural_meta.json` is what core/reconciler observes, so a change
    // to it emits client.status_changed. If these two modules ever read client status from
    // anywhere else, the signals they raise stop having provenance.
    for (const f of ["engines/opportunity-engine/index.ts", "lib/opportunities.ts"]) {
      expect(stripComments(read(f))).toMatch(/structural_meta\.json|meta\.data|c\?\.meta/);
    }
  });

  it("F26.6 · the care-plan inference window is a named domain rule, not an inline literal", () => {
    // It decides which clients Ascend believes are on retainer; it may not be an anonymous `60`.
    expect(definitionSites("CARE_INVOICE_IMPLIES_ACTIVE_DAYS", ["core", "lib", "engines"])).toEqual([
      "core/finance/care.ts",
    ]);
    expect(stripComments(read("core/finance/care.ts"))).not.toMatch(/<=\s*60\b/);
  });
});

// ─── F27 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * RETROACTIVE ONBOARDING RECORDS EXISTENCE, NOT ACTIVITY (docs/RETROACTIVE-ONBOARDING.md).
 *
 * `onboarding/` creates client and project records for engagements Ascend never observed. The
 * danger is not that it writes — it is that writing an entity is one small step from writing a
 * history for it, and §19's adoption measurement is running while it does so.
 */
describe("F27 · onboarding is a reviewed one-shot that never fabricates activity", () => {
  it("no surface, engine or runtime module imports it", () => {
    const offenders = ["app", "components", "engines", "mission-control", "core", "lib", "cognition", "relationships", "graph-view", "migration"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/onboarding\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("passes actor explicitly at every creation call — never the operator default", () => {
    // core/events defaults actor to "operator". Reconstructing a client who has existed since May
    // is not the operator working in the OS today, and §19 counts exactly that difference.
    const src = sourceFiles("onboarding").map(read).join("\n");
    const creates = (src.match(/\bcreate(Client|Project)\s*\(/g) ?? []).length;
    const systemActors = (src.match(/actor:\s*["']system["']/g) ?? []).length;
    expect(creates).toBeGreaterThan(0);
    expect(systemActors).toBeGreaterThanOrEqual(creates);
  });

  it("proposes no historical business event of any kind", () => {
    // client.created / project.created are TRUE — Ascend really is creating these records now.
    // Anything describing what the BUSINESS did is not, because Ascend did not witness it.
    const offenders = filesMatching(
      /type:\s*["'](project\.(phase_\w+|launched)|invoice\.\w+|payment\.\w+|careplan\.\w+)["']/,
      ["onboarding"]
    );
    expect(offenders).toEqual([]);
  });

  it("does not write the retired scope keys back into a fresh client", () => {
    // SOURCE-AUTHORITY §4.5 retired phase/status/package/launch_target from project_scope.md.
    // Creating a client is the easiest place to reintroduce them without noticing.
    const src = stripComments(read("onboarding/apply.ts"));
    const scopeBlock = src.slice(src.indexOf("scope: {"), src.indexOf("meta: {"));
    for (const key of ["phase:", "status:", "package:", "launch_target:"]) {
      expect(scopeBlock, key).not.toContain(key);
    }
  });

  it("declares its subjects as data, so the universe cannot grow by accident", () => {
    expect(definitionSites("ONBOARDING_SUBJECTS", ["onboarding", "core", "lib", "migration"])).toEqual([
      "onboarding/subjects.ts",
    ]);
  });
});

// ─── F28 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * BULK WRITES ARE NOT OPERATOR ACTIVITY (D-3).
 *
 * `core/events` defaults `actor` to "operator". That default is correct for a person doing one
 * thing in the OS and catastrophic for a path that creates N records from one action:
 * COGNITION-OBSERVATION §19 is measuring operator-caused events per weekday against a pre-registered
 * threshold, and the event log is append-only, so a contaminated measurement cannot be repaired.
 *
 * F25 and F27 already assert this for `migration/` and `onboarding/`. Prospect intake is the third
 * such path — and the only one reachable from a route handler, which makes it the one most likely
 * to acquire a new bulk caller without anybody thinking about attribution.
 */
describe("F28 · prospect intake declares its actor and never inherits the operator default", () => {
  it("createProspect accepts an actor and forwards it to the event", () => {
    const src = stripComments(read("core/crm/prospect.ts"));
    expect(src).toMatch(/actor\?:\s*Actor/);
    // Forwarded, not dropped: the parameter existing is worthless if emitEvent never sees it.
    expect(src).toMatch(/\.\.\.\(options\.actor\s*\?\s*\{\s*actor:\s*options\.actor\s*\}/);
  });

  it("every bulk creation path passes an explicit system actor", () => {
    // A bulk path is one that calls createProspect from inside a loop. `filesMatching` strips
    // comments, so the prose explaining the decision does not itself satisfy the rule.
    const BULK = ["app/api/import/prospects/route.ts"];
    for (const file of BULK) {
      const src = stripComments(read(file));
      expect(src, file).toMatch(/actor:\s*["']system["']/);
    }
  });

  it("no route emits a prospect event directly — attribution has one owner", () => {
    // If a route could emit `prospect.created` itself it would bypass both the actor decision and
    // the exactly-once guarantee, exactly as the pre-Increment-9 routes did with fs.writeFile.
    const offenders = filesMatching(/emitEvent[\s\S]{0,80}prospect\./, ["app"]);
    expect(offenders).toEqual([]);
  });
});

// ─── F29 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * A PROSPECT'S IDENTITY IS NOT ITS FILENAME (D-4).
 *
 * Identity was `slugify(name)`, so renaming a business replaced it and two spellings of one company
 * were two companies. The live vault shows both failure modes at once:
 * `tapia-tile-amp-marble-co.md` and `tile-amp-marble-installation-in-bay-area.md` are one business,
 * recorded twice, both carrying `&amp;` in the identity because the name was slugified from
 * undecoded HTML.
 *
 * This mirrors F19 (graph identity has one owner) and the D1 `client_id` anchor.
 */
describe("F29 · prospect identity has one owner and one minting site", () => {
  it("the anchor is minted in exactly one module", () => {
    // Declared in the domain (the point — reserved vocabulary), consumed only by the sole writer.
    expect(definitionSites("newProspectId", ["packages"])).toEqual(["packages/domain/ids.ts"]);
    // One minting site PER STORE during the dual-store period (see F21's note and its retirement
    // condition). The factory itself still has exactly one definition, which is the invariant that
    // stops a second id format appearing.
    expect(
      filesMatching(/\bnewProspectId\b/, ["core", "lib", "app", "engines", "mission-control"]).sort()
    ).toEqual(["core/crm/prospect.ts", "core/db/prospects.ts"]);
  });

  it("the slug⟷id seam lives with the client seam it mirrors", () => {
    for (const symbol of ["buildProspectIdIndex", "resolveProspectId", "readProspectIdFrom"]) {
      expect(definitionSites(symbol, ["core", "lib", "engines", "app", "mission-control"]), symbol).toEqual([
        "core/vault/identity.ts",
      ]);
    }
  });

  it("resolveProspectId does not fall back to the slug", () => {
    // THE LOAD-BEARING ASSERTION. `resolveClientId` DOES fall back (a tolerated migration posture
    // for four stable folders). Copying that here would silently reinstate filename-as-identity for
    // every prospect that has not been backfilled — the precise defect this anchor removes.
    const src = stripComments(read("core/vault/identity.ts"));
    const fn = src.slice(src.indexOf("export async function resolveProspectId"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toMatch(/asProspectId\(slug\)|\?\?\s*slug\b/);
    expect(body).toMatch(/return\s+null|readProspectIdFrom/);
  });

  it("duplicate identities are surfaced, never merged", () => {
    // `findDuplicateCandidates` is a DETECTOR. If this layer ever gains a merge, one record's
    // history and its human judgments are destroyed by a rule no human reviewed.
    const src = stripComments(read("core/vault/identity.ts"));
    expect(src).not.toMatch(/\bmergeProspects?\b|\bdedupe(Prospects)?\s*\(/);
    expect(
      filesMatching(/\bwriteFile\w*|\bemitEvent\b|\bfs\.rm\b|\bfs\.unlink\b/, ["core/vault/identity.ts"])
    ).toEqual([]);
  });

  it("prospect writing never migrates into a route or an engine", () => {
    // Restates F21's guarantee at the identity layer: minting cannot leave core, whichever store it
    // targets. Both writers live in core/; a definition under app/ or engines/ fails.
    const sites = definitionSites("createProspect", ["core", "lib", "app", "packages"]);
    expect(sites.every((f) => f.startsWith("core/"))).toBe(true);
    expect(sites.sort()).toEqual(["core/crm/prospect.ts", "core/db/prospects.ts"]);
  });
});

// ─── F30 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * IDENTITY IS NOT HISTORY (docs/STAGE1-PROSPECT-IDENTITY.md).
 *
 * `identity-backfill/` writes one frontmatter line per prospect: a stable name for a record that
 * already exists. The danger is not the write — it is how SMALL the write is. A one-line change to
 * every record at once is the easiest place in this system to smuggle in a second change nobody
 * reviews, and the module sits one import away from the machinery that could turn a naming
 * operation into a business claim.
 *
 * The rules are stricter than F25's and F27's in one specific way, and deliberately: those two
 * one-shots MAY emit (`observation.captured`, `client.created`) because they genuinely create or
 * observe something. This one may emit NOTHING. Naming a record is not an event.
 */
describe("F30 · the identity backfill names records and records no history", () => {
  it("has source files — these rules must never pass because the layer is empty", () => {
    expect(sourceFiles("identity-backfill").length).toBeGreaterThan(0);
  });

  it("no surface, engine or runtime module imports it", () => {
    const offenders = ["app", "components", "engines", "mission-control", "core", "lib", "cognition", "relationships", "graph-view", "migration", "onboarding"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/identity-backfill\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("THE HEADLINE INVARIANT: it emits no event of any kind", () => {
    // Not "no business event" — none. F25 permits `observation.captured` because a migration really
    // does observe a new baseline. Anchoring an identity observes nothing and creates nothing, so
    // there is no event that would be true.
    expect(filesMatching(/\bemitEvent\b/, ["identity-backfill"])).toEqual([]);
    expect(filesMatching(/type:\s*["'][a-z_]+\.[a-z_]+["']/, ["identity-backfill"])).toEqual([]);
  });

  it("it owns no write primitive — every write goes through the canonical prospect writer", () => {
    const WRITE = /\bwriteFileAtomic\b|\bwriteMarkdownFileAtomic\b|\bwriteJsonFileAtomic\b|\bappendJsonlLine\b|\bfs\.writeFile\b|\bfs\.appendFile\b/;
    expect(filesMatching(WRITE, ["identity-backfill"])).toEqual([]);
    // And it does reach the one legitimate writer, so this rule is not passing by disuse.
    expect(filesMatching(/\bcreateProspect\b/, ["identity-backfill"])).toEqual(["identity-backfill/apply.ts"]);
  });

  it("it never renames, deletes or merges a record", () => {
    // The duplicate pair must survive intact. A rename would also break the slug addressing that
    // events and relationships still depend on until the Stage 2 gate.
    expect(
      filesMatching(/\bfs\.rename\b|\bfs\.rm\b|\bfs\.unlink\b|\bmerge[A-Z]\w*\s*\(|\bdeleteProspect\b/, [
        "identity-backfill",
      ])
    ).toEqual([]);
  });

  it("planning cannot write — the confirm gate lives only in apply", () => {
    expect(filesMatching(/\bcreateProspect\b|\bconfirm\b/, ["identity-backfill"])).toEqual([
      "identity-backfill/apply.ts",
    ]);
    expect(stripComments(read("identity-backfill/apply.ts"))).toMatch(/opts\.confirm/);
  });

  it("declared holds are data, so the held set cannot grow or shrink by accident", () => {
    expect(definitionSites("DECLARED_HOLDS", ["identity-backfill", "core", "lib", "migration", "onboarding"])).toEqual([
      "identity-backfill/holds.ts",
    ]);
    // Both halves of the known duplicate are named. Holding one and anchoring the other would be
    // the exact asymmetry that makes a later merge ambiguous.
    const src = read("identity-backfill/holds.ts");
    expect(src).toMatch(/tapia-tile-amp-marble-co/);
    expect(src).toMatch(/tile-amp-marble-installation-in-bay-area/);
  });

  it("it does not touch relationships, the reconciler, or the retired scope keys", () => {
    const offenders = importsUnder("identity-backfill").filter((e) =>
      /^@\/(relationships|graph-view|cognition|engines|mission-control)\b/.test(e.specifier)
    );
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });
});

// ─── F41 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * THE SHARED SUBSTRATE STAYS VENDOR-NEUTRAL AND KEEPS ITS PROVENANCE (Stage 2A).
 *
 * Decision 1 says Supabase is INFRASTRUCTURE, not the domain abstraction. That is a sentence until
 * something enforces it: the cheapest way to lose it is one `import { createClient } from
 * "@supabase/supabase-js"` inside a repository, after which the vendor is load-bearing and the
 * migration path this stage bought is gone.
 *
 * The second half closes a real gap rather than a theoretical one. F21 requires every durable writer
 * to emit an event, but its WRITE_PRIMITIVE regex only knows about the FILESYSTEM
 * (`writeFileAtomic`, `fs.writeFile`, `appendJsonlLine`). A module that writes to Postgres is
 * invisible to it — so the provenance rule that took the whole H-series to establish would simply
 * not apply to the new store unless it is named here.
 */
describe("F41 · core/db is vendor-neutral, append-only, and keeps F21's provenance rule", () => {
  it("has source files — these rules must never pass because the layer is empty", () => {
    expect(sourceFiles("core/db").length).toBeGreaterThan(0);
  });

  it("no vendor SDK is imported anywhere in the substrate", () => {
    const vendor = /^(@supabase\/|@prisma\/|prisma|drizzle-orm|kysely|@neondatabase\/|@vercel\/postgres)/;
    const offenders = importsUnder("core").filter((e) => vendor.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("no vendor-specific SQL is baked into the schema", () => {
    // `auth.uid()` is Supabase's. Policies keyed on it are not portable, and the tests could then
    // only exercise a stand-in rather than the real policy.
    // SQL comments stripped first. The prose in that file legitimately DISCUSSES Supabase — it
    // explains how a host maps its JWT claims onto the GUCs — and an earlier draft of this rule
    // flagged its own documentation. This file's header records that exact trap for TS; SQL needs
    // the same treatment.
    const schema = read("core/db/schema/001_substrate.sql")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(schema).not.toMatch(/auth\.uid\(\)|auth\.users|supabase/i);
    expect(schema).toMatch(/current_setting\('ascend\.org_id'/);
  });

  it("the SqlClient contract stays three methods — anything larger leaks a vendor", () => {
    const src = stripComments(read("core/db/client.ts"));
    const iface = src.slice(src.indexOf("export interface SqlClient"), src.indexOf("export type DbPrincipal"));
    expect(iface).toMatch(/query</);
    expect(iface).toMatch(/exec\(/);
    expect(iface).toMatch(/transaction</);
    expect(iface).not.toMatch(/\bfrom\(|\brpc\(|\bstorage\b|\bchannel\(/);
  });

  it("F21 EXTENDED: every DB writer emits an event", () => {
    // The gap this closes: F21 scans for filesystem primitives only, so a Postgres writer would
    // never have been checked. Any module issuing INSERT/UPDATE/DELETE must be able to say so.
    const DB_WRITE = /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    const writers = filesMatching(DB_WRITE, ["core/db"]);
    expect(writers.length).toBeGreaterThan(0);

    // Named, not silent. Each exemption states what it writes and why that is not a business fact:
    //
    //   organizations.ts  tenancy records — configuration, the same reasoning that exempts
    //                     core/vault's primitives in F21
    //   events.ts         the event writer itself; it cannot emit an event about emitting an event
    //   migrate.ts        `schema_migrations` — metadata ABOUT the schema, not about the business
    //   backup.ts         a RESTORE reinstates rows that were already facts. Emitting events for
    //                     them would fabricate a second history in which the business did
    //                     everything twice — see the dedicated rule below.
    const EXEMPT = new Set([
      "core/db/organizations.ts", "core/db/events.ts", "core/db/migrate.ts", "core/db/backup.ts",
    ]);
    const silent = writers.filter(
      (f) => !EXEMPT.has(f) && filesMatching(/\bappendEvent\b/, [f]).length === 0
    );
    expect(silent).toEqual([]);
  });

  it("a RESTORE never emits an event — it reinstates history, it does not author it", () => {
    // Stronger than the exemption above, and the reason it is safe. If `backup.ts` ever emitted
    // events for the rows it writes, a recovery would silently double the record: every restored
    // prospect would arrive with a fresh "created" event alongside its original one, and the event
    // spine would say the business did everything twice.
    const src = stripComments(read("core/db/backup.ts"));
    expect(src).not.toMatch(/\bappendEvent\b|\bemitEvent\b/);
    // …and it may not write to the events table by any route other than transcribing rows.
    expect(src).not.toMatch(/INSERT INTO\s+events\b/);
  });

  it("the substrate never mutates or deletes an event", () => {
    const src = stripComments(read("core/db/events.ts"));
    expect(src).not.toMatch(/UPDATE\s+events|DELETE\s+FROM\s+events/i);
    // And the schema enforces it, so this does not rest on the repository behaving.
    expect(read("core/db/schema/001_substrate.sql")).toMatch(/events are append-only/);
  });

  it("human judgment has no automated writer — enforced by GRANT, not by convention", () => {
    const schema = read("core/db/schema/001_substrate.sql");
    const automationGrant = schema.slice(schema.indexOf("GRANT SELECT, INSERT ON prospects TO ascend_automation"));
    expect(automationGrant).not.toMatch(/website_opportunity|assessed_by|assessed_at/);
  });

  it("every table carries organization_id and has RLS forced", () => {
    const schema = read("core/db/schema/001_substrate.sql");
    for (const table of ["prospects", "events", "memberships"]) {
      expect(schema, table).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`));
      expect(schema, table).toMatch(new RegExp(`ALTER TABLE ${table}\\s+FORCE ROW LEVEL SECURITY`));
    }
  });

  it("held prospects remain READABLE — a write barrier, not an information barrier", () => {
    // The single most important line in the schema. A SELECT policy narrowed to anchored rows would
    // silently turn every held record into a matching miss, and an import would create duplicates of
    // exactly the businesses a human flagged as already duplicated.
    const schema = read("core/db/schema/001_substrate.sql");
    const readPolicy = schema.slice(schema.indexOf("CREATE POLICY prospects_read"), schema.indexOf("CREATE POLICY prospects_write_owner"));
    expect(readPolicy).toMatch(/organization_id = current_org\(\)/);
    expect(readPolicy).not.toMatch(/identity_state/);
    // …while the UPDATE policies DO narrow to anchored.
    expect(schema).toMatch(/prospects_update_automation[\s\S]*identity_state = 'anchored'/);
  });

  it("the substrate is not wired to any surface yet", () => {
    const offenders = ["app", "components", "engines", "mission-control", "relationships", "graph-view", "cognition"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/core\/db\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });
});

// ─── F42 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * THE SUBSTRATE MIGRATION TRANSCRIBES; IT DOES NOT AUTHOR (Stage 2B).
 *
 * `substrate-migration/` carries prospects and the event spine from the vault into Postgres. It is
 * the fourth reviewed one-shot, and the strictest: F25 lets the historical migration emit
 * `observation.captured`, and F27 lets onboarding emit `client.created`, because each genuinely
 * creates or observes something. This one creates nothing — every row and every event it writes
 * already existed. It must therefore mint no id, stamp no clock, and append no event of its own.
 *
 * The failure it guards is specific and was found in live data: not one of the six prospects has a
 * `prospect.created` event, so their origin is genuinely unknown. A migration that inserted rows
 * and let `created_at` speak for them would convert "never witnessed" into "created on the
 * migration date" — the absence-into-fact conversion, committed at the one moment it is easiest.
 */
describe("F42 · the substrate migration transcribes and never authors", () => {
  it("has source files — these rules must never pass because the layer is empty", () => {
    expect(sourceFiles("substrate-migration").length).toBeGreaterThan(0);
  });

  it("no surface, engine or runtime module imports it", () => {
    const offenders = ["app", "components", "engines", "mission-control", "core", "lib", "cognition", "relationships", "graph-view", "migration", "onboarding", "identity-backfill"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/substrate-migration\b/.test(e.specifier));
    expect(offenders.map((o) => `${o.from}:${o.line} → ${o.specifier}`)).toEqual([]);
  });

  it("THE HEADLINE INVARIANT: it mints no identity and stamps no clock", () => {
    // `appendEvent` is deliberately absent: it mints an event_id and stamps occurred_at, which is
    // right for a new fact and wrong for a transcription. The originals must survive.
    const src = filesMatching(/\bnewProspectId\b|\bnewEventId\b|\bappendEvent\b|\bnew Date\(\)/, ["substrate-migration"]);
    expect(src).toEqual([]);
  });

  it("it proposes no prospect birth, and the validator refuses one", () => {
    const plan = stripComments(read("substrate-migration/plan.ts"));
    expect(plan).toMatch(/birthEventsForProspects/);
    expect(plan).toMatch(/origin is unknown and must stay unknown/);
  });

  it("planning cannot write — only apply and the constraint probes issue SQL writes", () => {
    /**
     * NARROW, NAMED EXEMPTION. `verify.ts` contains INSERT statements, and that is exactly the shape
     * that could hide a real write — so it is listed here deliberately rather than excluded from the
     * scan.
     *
     * What makes it safe is structural, not a promise: check 9 issues those statements ONLY inside a
     * SAVEPOINT that is unconditionally rolled back, so a probe cannot persist even when it succeeds
     * — and a probe succeeding is precisely the failure it exists to detect. Asserted below.
     */
    expect(filesMatching(/\bINSERT INTO\b|\bUPDATE\s+\w+\s+SET\b/, ["substrate-migration"]).sort()).toEqual([
      "substrate-migration/apply.ts",
      "substrate-migration/verify.ts",
    ]);
    expect(stripComments(read("substrate-migration/apply.ts"))).toMatch(/opts\.confirm/);

    const verify = stripComments(read("substrate-migration/verify.ts"));
    expect(verify).toMatch(/SAVEPOINT constraint_probe/);
    expect(verify).toMatch(/ROLLBACK TO SAVEPOINT constraint_probe/);
    // And nothing in verify may commit or write outside a probe.
    expect(verify).not.toMatch(/\bCOMMIT\b/);
  });

  it("it never writes to the vault", () => {
    // The vault is the ROLLBACK. A migration that could touch it would remove its own safety net.
    const WRITE = /\bwriteFileAtomic\b|\bwriteMarkdownFileAtomic\b|\bfs\.writeFile\b|\bfs\.rm\b|\bfs\.unlink\b/;
    expect(filesMatching(WRITE, ["substrate-migration"])).toEqual([]);
  });

  it("it carries prospects and events only — no client, project, invoice or document RECORD", () => {
    const src = filesMatching(/\bcreateClient\b|\bcreateProject\b|\bappendInvoice\b|\bcreateDocument\b/, ["substrate-migration"]);
    expect(src).toEqual([]);
    // Events ABOUT those entities do travel: the spine moves whole, and splitting it would break
    // the ordering contract Stage 2A preserved.
    expect(stripComments(read("substrate-migration/apply.ts"))).toMatch(/INSERT INTO events/);
  });

  it("the behavioural ledger is computed by ONE function for both stores", () => {
    // Two implementations could agree with each other while both were wrong. `buildLedger` is fed
    // by each store's reader and runs the scoring and duplicate detection exactly once.
    expect(definitionSites("buildLedger", ["substrate-migration", "core", "lib"])).toEqual([
      "substrate-migration/ledger.ts",
    ]);
    const verify = stripComments(read("substrate-migration/verify.ts"));
    expect(verify).toMatch(/vaultLedger/);
    expect(verify).toMatch(/dbLedger/);
  });
});

// ─── F43 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * ONE ENTITY → ONE STORE → ONE READER → ALL CONSUMERS (Stage 2C).
 *
 * The rule this encodes, stated once:
 *
 *   > A data migration is not complete when the destination contains the source's fields. It is
 *   > complete when every production consumer has been traced, migrated, and behaviourally verified
 *   > against the source.
 *
 * Stage 2C found ten prospect consumers. Nine reached data through `core/crm`; the tenth
 * (`core/knowledge`) opened the hit list directly. At six prospects that is untidy. At five thousand
 * it is a split brain embedded in the business — the knowledge index, the graph and /search served
 * from Obsidian while everything else read Postgres, with nothing reporting the disagreement.
 *
 * The rule is about DIRECT STORAGE ACCESS, not about layering: a consumer may not choose its own
 * store, because choosing the store is the canonical reader's job and only its job.
 */
describe("F43 · prospects have one canonical reader and no consumer bypasses it", () => {
  /**
   * The ONLY modules permitted to name the hit-list directory.
   *
   * Each owns storage rather than consuming it — the reader itself, the seam it resolves, the
   * writers, the observer, and the reviewed one-shots. A module that merely WANTS prospects belongs
   * nowhere on this list.
   */
  const STORAGE_OWNERS = [
    "core/vault/paths.ts",          // defines it
    "core/vault/identity.ts",       // the slug⟷id seam
    "core/crm/prospect.ts",         // THE canonical reader + the vault writer
    "core/crm/promote.ts",          // WRITER: marks the prospect closed-won on promotion
    "core/reconciler/observation.ts", // observes Obsidian-authored edits
    "identity-backfill/snapshot.ts",
    "identity-backfill/apply.ts",
    "substrate-migration/plan.ts",
    "lib/paths.ts",                 // re-export shim
    "app/api/import/prospects/route.ts",
    "app/api/prospects/from-url/route.ts",
    "app/api/prospects/[slug]/route.ts",
  ];

  it("no consumer reaches the hit list directly", () => {
    const readers = filesMatching(/\bhitListDir\b/, [
      "core", "lib", "app", "engines", "mission-control", "graph-view", "cognition",
      "relationships", "identity-backfill", "substrate-migration",
    ]);
    const rogue = readers.filter((f) => !STORAGE_OWNERS.includes(f));
    expect(rogue).toEqual([]);
  });

  it("core/knowledge in particular consumes the reader, not the filesystem", () => {
    // The specific regression: it built the knowledge index — and therefore the graph and /search —
    // by parsing the vault itself, which would have survived a source-of-truth flip unnoticed.
    const src = stripComments(read("core/knowledge/index.ts"));
    expect(src).not.toMatch(/\bhitListDir\b/);
    expect(src).toMatch(/listProspectSources/);
  });

  it("the store is chosen in exactly one place", () => {
    expect(definitionSites("resolveProspectSource", ["core", "lib", "app", "engines", "mission-control"])).toEqual([
      "core/crm/source.ts",
    ]);
    const consumers = filesMatching(/\bresolveProspectSource\b/, [
      "core", "lib", "app", "engines", "mission-control", "graph-view",
    ]);
    // Only the canonical reader asks. Everyone else inherits the answer.
    expect(consumers.sort()).toEqual(["core/crm/prospect.ts", "core/crm/source.ts"]);
  });

  it("the seam never falls back — an unavailable store throws", () => {
    const src = stripComments(read("core/crm/source.ts"));
    expect(src).toMatch(/ProspectSourceUnavailable/);
    // The dangerous direction: postgres selected, no connection. Degrading to the vault would
    // silently restore the second source of truth this stage exists to remove.
    // The seam became ASYNC in the Server Component bridge — ALS cannot cross a component
    // boundary, so a render resolves identity through `requireCapability` instead. What must not
    // change is that it REFUSES rather than degrading, which is what this asserts.
    expect(src).toMatch(/withProspectDb[\s\S]*throw new ProspectSourceUnavailable/);
  });
});

// ─── F44 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * DATABASE CONNECTIONS ARE ENCRYPTED **AND AUTHENTICATED** (Stage 2D).
 *
 * Three measured facts about the production database make this rule necessary rather than
 * decorative:
 *
 *   1. It ACCEPTS PLAINTEXT. A connection that omits TLS config does not fail — it succeeds, and
 *      ships the password and the entire commercial record in the clear.
 *   2. Its chain is rooted in a PRIVATE, self-signed CA, so the system trust store rejects it. The
 *      obvious unblock is `rejectUnauthorized: false`, which keeps the encryption and throws away
 *      the identity check — leaving a session confidential to whoever answered.
 *   3. `pg` assigns values parsed from a connection string OVER an explicit `ssl` config, and
 *      `sslmode=require` sets `rejectUnauthorized = false`. So a URL can silently undo the CA.
 *
 * Each failure is invisible at runtime: the query returns rows, the app works, and nothing reports
 * that verification was skipped. That is exactly the shape of defect a fitness rule exists to catch,
 * because no integration test will ever notice it.
 */
describe("F44 · every database connection is TLS-verified against a pinned CA", () => {
  it("has the modules these rules constrain — never pass because the layer is missing", () => {
    expect(sourceFiles("core/db")).toEqual(expect.arrayContaining(["core/db/tls.ts", "core/db/pool.ts"]));
  });

  it("certificate verification is never disabled, anywhere", () => {
    // The single most likely regression, and the one that looks harmless in a diff.
    //
    // Comments are stripped, and the kill-switch pattern requires an ASSIGNMENT (`=` not followed
    // by `=`). Both refinements are here because the first draft of this rule flagged its own
    // documentation: core/db/tls.ts necessarily NAMES `NODE_TLS_REJECT_UNAUTHORIZED=0` in prose and
    // COMPARES against it in the guard that refuses to run under it. F41's header records the same
    // trap. A rule that cannot tell "forbids X" from "does X" retires itself the first time someone
    // silences it.
    const FORBIDDEN = /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=(?!=)\s*["']?0/;
    const offenders = ["core", "lib", "app", "engines", "mission-control", "substrate-migration"]
      .flatMap(sourceFiles)
      .filter((f) => FORBIDDEN.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });

  it("the pool never hands `pg` a connection string — parsed URL values would override `ssl`", () => {
    const src = stripComments(read("core/db/pool.ts"));
    expect(src).not.toMatch(/connectionString/);
    // …and it refuses URLs that try to speak about SSL at all, rather than merging them.
    expect(src).toMatch(/sslmode/);
    expect(src).toMatch(/SSL_PARAMS/);
  });

  it("the TLS options are verified by construction, with no way to weaken them", () => {
    const src = stripComments(read("core/db/tls.ts"));
    expect(src).toMatch(/rejectUnauthorized:\s*true/);
    expect(src).toMatch(/minVersion:\s*"TLSv1\.2"/);
    // No parameter may switch verification off — `verifiedTlsOptions` takes no arguments.
    expect(src).toMatch(/export function verifiedTlsOptions\(\)/);
  });

  it("the trust anchor is pinned to a declared fingerprint, checked at load", () => {
    const src = stripComments(read("core/db/tls.ts"));
    expect(src).toMatch(/SUPABASE_ROOT_2021_CA_SHA256\s*=\s*\n?\s*"[0-9A-F:]{95}"/);
    // The PEM is unreadable by a human; the load-time comparison is what makes it reviewable.
    expect(src).toMatch(/fingerprint256 !== SUPABASE_ROOT_2021_CA_SHA256[\s\S]*throw new TlsConfigurationError/);
  });

  it("Node's process-wide verification kill-switch is refused, not ignored", () => {
    // `NODE_TLS_REJECT_UNAUTHORIZED=0` silently overrides `rejectUnauthorized: true`.
    const src = stripComments(read("core/db/tls.ts"));
    expect(src).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED[\s\S]*throw new TlsConfigurationError/);
    expect(stripComments(read("core/db/pool.ts"))).toMatch(/assertNodeTlsNotDisabled\(\)/);
  });

  it("TLS is asserted from the SOCKET, never from pg_stat_ssl", () => {
    // pg_stat_ssl describes the POOLER→POSTGRES hop, which is internal to the provider. It reads
    // false on a fully encrypted client session and could read true on a plaintext one. Measured:
    // through the pooler it reports false while the client socket is TLSv1.3.
    const gate = stripComments(read("tests/db/pooled-principal.test.ts"));
    const assertions = gate.split("\n").filter((l) => /expect\(/.test(l) && /pg_stat_ssl/.test(l));
    expect(assertions).toEqual([]);
    expect(gate).toMatch(/tlsSocketOf|assertVerifiedTls/);
  });
});


// ─── F45 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * THE APPLICATION LOGIN CANNOT BYPASS THE SECURITY BOUNDARY (Stage 2D.1).
 *
 * Measured on the live database: Supabase's `postgres` role holds BYPASSRLS, so while the
 * application connected as it, a bare `SELECT` returned every organization's rows. Tenant isolation
 * existed only inside `asPrincipal`, which made a forgotten wrapper a silent cross-tenant leak
 * rather than an error.
 *
 * `ascend_app` replaces that: a login with NO privilege of its own, which must assume a role before
 * it can read anything. The intended shape is
 *
 *   human identity → session → organization/user context → RLS → canonical reader
 *
 * and these rules keep the first link from quietly reverting to a shared, over-privileged account.
 */
describe("F45 · the application login holds no ambient authority", () => {
  it("provisioning creates AND alters the login with NOBYPASSRLS", () => {
    const src = stripComments(read("core/db/provision.ts"));
    // Matched through to the `%L` password placeholder, not to the first quote: the statement is
    // built from two concatenated string literals, and stopping at the quote captured only half of
    // it — the half that does not mention BYPASSRLS.
    const paths = src.match(/(CREATE|ALTER) ROLE %I[\s\S]*?%L/g) ?? [];
    expect(paths.length, "expected both a CREATE and an ALTER path").toBe(2);
    for (const p of paths) {
      expect(p, "a provisioning path does not clear BYPASSRLS").toMatch(/NOBYPASSRLS/);
      expect(p, "a provisioning path does not clear INHERIT").toMatch(/NOINHERIT/);
    }
  });

  it("provisioning REFUSES to report success on a dangerous login", () => {
    // SUPERUSER cannot be cleared by a non-superuser connection, so the only honest alternative to
    // checking is silently succeeding against a login that defeats every policy in the database.
    const src = stripComments(read("core/db/provision.ts"));
    expect(src).toMatch(/dangerous[\s\S]*throw new ProvisioningError/);
  });

  it("provisioning RECONCILES — it revokes privileges granted by hand", () => {
    // Without this, "the login holds no privileges of its own" is true only until someone types one
    // GRANT, and nothing would ever notice.
    const src = stripComments(read("core/db/provision.ts"));
    expect(src).toMatch(/REVOKE ALL PRIVILEGES ON ALL TABLES/);
  });

  it("no migration grants the application login anything directly", () => {
    // Its privileges must arrive ONLY through role membership, so that what the application may do
    // is described in exactly one place: the three ascend_* roles.
    const offenders = readdirSync(path.join(process.cwd(), "core", "db", "schema"))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const sql = read(`core/db/schema/${f}`).split("\n")
          .filter((l) => !l.trim().startsWith("--")).join("\n");
        return /\bGRANT\b[^;]*\bascend_app\b/.test(sql);
      });
    expect(offenders).toEqual([]);
  });
});


// ─── F50 ───────────────────────────────────────────────────────────────────────────────────────
/**
 * AUTHORITY IS REQUEST-SCOPED. THERE IS NO SLOT TO LEAK (Stage 2F, step 7).
 *
 * F46–F49 are reserved by STAGE2F §10 for the route-authorization work, so the rule §16 requires
 * alongside the request context takes the next free number.
 *
 * ─── THE DEFECT THIS FREEZES OUT ─────────────────────────────────────────────────────────────
 *
 * `core/crm/source.ts` used to hold
 *
 *     let binding: { client: SqlClient; principal: DbPrincipal } | null = null;
 *
 * — ONE SLOT, SHARED BY EVERY REQUEST, holding an identity, written at startup. With a single
 * operator it is invisible; it behaves correctly for as long as requests never overlap. With an
 * owner and a partner it IS the security boundary, and it is decided by whichever request wrote the
 * slot last. `tests/db/request-isolation.test.ts` demonstrates the failure against real Postgres:
 * restore that shape and two concurrent sales requests read the owner's organization's rows.
 *
 * ─── THE LINE THIS RULE HOLDS ────────────────────────────────────────────────────────────────
 *
 *   > `AsyncLocalStorage` is the request CONTEXT. `ResolvedPrincipal` is the AUTHORITY.
 *   > The former may carry the latter. It may never create or modify it.
 *
 * So the rule is not "no module-level state" in general — connection pools and configuration are
 * legitimately process-wide. It is specifically: no module-level PRINCIPAL, no second store, and no
 * way to set one outside the trust boundary.
 */
describe("F50 · authority is request-scoped — no module-level principal, anywhere", () => {
  const PRODUCTION_ROOTS = [
    "core", "lib", "app", "engines", "mission-control", "graph-view", "cognition",
    "relationships", "navigation", "onboarding", "migration", "identity-backfill",
    "substrate-migration", "components",
  ];

  it("nothing registers, sets, or stores a principal at module level", () => {
    // The banned SHAPES, named. Each one is a slot somebody could write once and every later
    // request would inherit — which is the defect, whatever it is called.
    const banned = /\b(setPrincipal|registerProspectDb|registerPrincipal|currentPrincipal|setCurrentUser|currentUser\s*=)\b/;
    expect(filesMatching(banned, PRODUCTION_ROOTS)).toEqual([]);
  });

  it("the prospect seam reads the REQUEST, and refuses when there is not one", () => {
    const src = stripComments(read("core/crm/source.ts"));
    // No module-level mutable binding survives in the seam.
    expect(src).not.toMatch(/^\s*let\s+binding/m);
    expect(src).not.toMatch(/^\s*(let|var)\s+\w*[Pp]rincipal/m);
    // And the principal is READ from the context rather than held.
    expect(src).toMatch(/peekRequestContext\(\)/);
    // The seam became ASYNC in the Server Component bridge — ALS cannot cross a component
    // boundary, so a render resolves identity through `requireCapability` instead. What must not
    // change is that it REFUSES rather than degrading, which is what this asserts.
    expect(src).toMatch(/withProspectDb[\s\S]*throw new ProspectSourceUnavailable/);
  });

  it("the context module holds no mutable module-level state of its own", () => {
    // The store is a `const`. A `let` here would be the same defect one layer down.
    const src = stripComments(read("core/auth/context.ts"));
    expect(src.match(/^\s*(let|var)\s+/gm) ?? []).toEqual([]);
  });

  it("the AsyncLocalStorage instance is never exported — `.enterWith` must be unreachable", () => {
    // `.enterWith()` sets the store for the REST OF THE CURRENT EXECUTION rather than for a scoped
    // callback: a module-level principal wearing an ALS costume. Keeping the instance private is
    // what makes `runInRequestContext` the only entry.
    const src = stripComments(read("core/auth/context.ts"));
    expect(src).toMatch(/^const store = new AsyncLocalStorage/m);
    expect(src).not.toMatch(/export\s+(const|let)\s+store\b/);
    expect(filesMatching(/\.enterWith\s*\(/, PRODUCTION_ROOTS)).toEqual([]);
  });

  it("there is exactly ONE request context — ALS never becomes a second authority system", () => {
    // A second store would be a second answer to "who is this?", and two answers is how a system
    // starts authorizing against whichever one the reader happened to import.
    expect(filesMatching(/new AsyncLocalStorage/, PRODUCTION_ROOTS)).toEqual(["core/auth/context.ts"]);
    expect(definitionSites("runInRequestContext", PRODUCTION_ROOTS)).toEqual(["core/auth/context.ts"]);
  });

  it("the context is established at the TRUST BOUNDARY and nowhere else", () => {
    // One door in. If a route could open a context itself, it could open one for a principal it
    // chose — and the point of the boundary is that the database chooses.
    expect(filesMatching(/\brunInRequestContext\b/, PRODUCTION_ROOTS)).toEqual([
      "core/auth/context.ts", "lib/request-context.ts",
    ]);
    const boundary = stripComments(read("lib/request-context.ts"));
    // The four links, in order, with no shortcut: session → user → membership → context.
    expect(boundary).toMatch(/verifySessionToken[\s\S]*resolvePrincipal[\s\S]*runInRequestContext/);
  });

  it("startup registers CONNECTIVITY and never IDENTITY", () => {
    // A principal registered at startup is one ambient identity every request inherits, so neither
    // the startup hook nor the connection registry may so much as NAME one.
    //
    // Matched on DECLARATIONS, not on the word: `stripComments` removes comments but not string
    // literals, and `core/auth/connection.ts` legitimately says "principal resolution" inside its
    // error message. A rule that fires on prose is a rule people learn to work around by rewording,
    // which is the opposite of what it is for. (F44 learned this twice.)
    const declaresAPrincipal = /\b(DbPrincipal|ResolvedPrincipal)\b|\bprincipal\s*[:,)=]/;
    for (const f of ["instrumentation.ts", "core/auth/connection.ts"]) {
      expect(stripComments(read(f)), `${f} holds a principal`).not.toMatch(declaresAPrincipal);
    }
    expect(stripComments(read("instrumentation.ts"))).toMatch(/registerAppDb/);
  });

  it("test-only principal construction never escapes tests/", () => {
    // The brand makes a forged role inexpressible; this keeps the one deliberate exception from
    // becoming a way to mint authority in production code.
    expect(filesMatching(/__unsafePrincipalForTests/, PRODUCTION_ROOTS))
      .toEqual(["core/auth/principal.ts"]); // its definition, and nothing else
  });
});


// ─── F46–F49 ───────────────────────────────────────────────────────────────────────────────────
/**
 * THE ROUTE AUTHORIZATION BOUNDARY (Stage 2F, step 7.4).
 *
 * Four rules from STAGE2F §10. They share a fixture — the route→capability map — so they are
 * defined together, but each one names a different way the boundary has historically been lost:
 *
 *   F46  somebody adds a route and forgets to authorize it
 *   F47  somebody starts trusting a role the request supplied
 *   F48  a migration hands credential material to an application role
 *   F49  a route looks safe because its data has not been migrated yet
 */
const ROUTE_FILES = sourceFiles("app/api").filter((f) => /\/route\.ts$/.test(f));

describe("F46 · every API route authorizes, and none invents its own way to do it", () => {
  it("every route file either checks a capability or is a DECLARED public route", () => {
    const missing = ROUTE_FILES.filter((f) => {
      const entry = ROUTE_AUTHORIZATION[f];
      if (entry?.kind === "public") return false;
      return !/\bauthorize\s*\(/.test(stripComments(read(f)));
    });
    expect(missing, "these routes reach the handler without a capability check").toEqual([]);
  });

  it("the capability a route CHECKS is the one the map ASSIGNS", () => {
    // The map and the implementation are two records of the same decision. Tying them together is
    // what stops the map from becoming documentation that drifts.
    const wrong: string[] = [];
    for (const f of ROUTE_FILES) {
      const entry = ROUTE_AUTHORIZATION[f];
      if (!entry || entry.kind === "public") continue;
      const used = [...stripComments(read(f)).matchAll(/\bauthorize\s*\(\s*\w+\s*,\s*"([^"]+)"/g)]
        .map((m) => m[1]);
      const unique = [...new Set(used)];
      if (unique.length !== 1 || unique[0] !== entry.capability) {
        wrong.push(`${f}: map says ${entry.capability}, code uses [${unique.join(", ")}]`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a PUBLIC route does not pretend to authorize", () => {
    // A public row that also called `authorize` would mean the map is lying about which credential
    // actually protects it — the confusing state in which nobody can say what guards a route.
    const lying = ROUTE_FILES.filter((f) =>
      ROUTE_AUTHORIZATION[f]?.kind === "public" && /\bauthorize\s*\(/.test(stripComments(read(f))));
    expect(lying).toEqual([]);
  });

  it("the map's public routes are EXACTLY the perimeter's public paths", () => {
    // Two files decide what is reachable without an operator session: middleware.ts (which lets the
    // request through) and the map (which says no capability is required). They must agree, or one
    // of them is describing a system that does not exist.
    const fromMap = Object.entries(ROUTE_AUTHORIZATION)
      .filter(([, v]) => v.kind === "public")
      .map(([k]) => "/" + k.replace(/^app\//, "").replace(/\/route\.ts$/, ""))
      .sort();
    const middleware = stripComments(read("middleware.ts"));
    const declared = [...middleware.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]).sort();
    expect(fromMap).toEqual(declared);
  });

  it("authorization happens in ONE place — no route re-implements the capability check", () => {
    // `can()` is the decision. If a route called it directly it would be deciding for itself, and
    // the 401/403 shape, the logging and the context would all become per-route conventions.
    expect(filesMatching(/\bcan\s*\(/, ["app"])).toEqual([]);
    expect(definitionSites("authorize", ["lib", "app", "core"])).toEqual(["lib/route-guard.ts"]);
    // And the guard is the only production caller of the store's authority accessor.
    expect(filesMatching(/\brequirePrincipal\s*\(/, ["app", "lib", "engines", "mission-control"]))
      .toEqual([]);
  });
});

describe("F47 · the session never carries a role", () => {
  it("a verified session establishes EXACTLY one field, and it is the user id", () => {
    const src = stripComments(read("lib/auth.ts"));
    const shape = src.match(/export type SessionIdentity = \{([^}]*)\}/);
    expect(shape, "SessionIdentity is no longer declared as an object type").toBeTruthy();
    expect(shape![1].trim()).toBe("userId: string");
  });

  it("the signed payload contains version, user and expiry — nothing else", () => {
    const src = stripComments(read("lib/auth.ts"));
    expect(src).toMatch(/const payload = `\$\{TOKEN_VERSION\}\.\$\{userId\}\.\$\{now \+ SESSION_TTL_MS\}`/);
  });

  it("NO source file reads a role or an organization from a session, token, cookie or claim", () => {
    // The attack this forecloses: a caller edits the cookie to add `"role":"owner"`. It fails
    // because the signature covers the payload — and, more durably, because no code path looks.
    const reads = /\b(session|token|claims?|payload|jwt|cookie)\w*[.?[\s]*(\[\s*")?(role|organization_?[Ii]d|orgId)\b/i;
    expect(filesMatching(reads, [
      "core", "lib", "app", "engines", "mission-control", "graph-view", "cognition",
      "relationships", "navigation", "onboarding", "migration",
    ])).toEqual([]);
  });

  it("authority is resolved from MEMBERSHIPS, and that is the only source", () => {
    const src = stripComments(read("core/auth/principal.ts"));
    expect(src).toMatch(/FROM users u\s*\n\s*LEFT JOIN memberships m/);
    // The role in a ResolvedPrincipal comes from the row, never from an argument.
    expect(src).not.toMatch(/function resolvePrincipal\([^)]*role/);
  });
});

describe("F48 · credential material is never reachable by an application role", () => {
  const SCHEMA_FILES = readdirSync(path.join(process.cwd(), "core", "db", "schema"))
    .filter((f) => f.endsWith(".sql")).sort();
  const sqlOf = (f: string) =>
    read(`core/db/schema/${f}`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("no migration grants a password column to an application role", () => {
    const offenders = SCHEMA_FILES.filter((f) => {
      const sql = sqlOf(f);
      return [...sql.matchAll(/\bGRANT\b[\s\S]*?;/g)].some((m) =>
        /password_(hash|algo|set_at)/.test(m[0]) &&
        /\bascend_(owner|sales|automation)\b/.test(m[0]));
    });
    expect(offenders).toEqual([]);
  });

  it("the application roles hold a COLUMN grant on users, never a table grant", () => {
    // A table grant covers columns added later — which is how `password_hash` would have become
    // readable by ascend_sales the moment it existed, with nobody writing a line of code.
    const all = SCHEMA_FILES.map(sqlOf).join("\n");
    expect(all).toMatch(/REVOKE SELECT ON users FROM ascend_owner, ascend_sales, ascend_automation/);
    const tableGrants = [...all.matchAll(/\bGRANT SELECT\s+ON users\b[^;]*;/g)];
    expect(tableGrants.map((m) => m[0]), "a bare table grant on users came back").toEqual([]);
  });

  it("only the auth layer names the credential columns", () => {
    // Confines the reachable surface, so "which code can read a hash?" is answerable by reading two
    // files rather than the repository.
    //
    // NOT A CLAIM THAT NOTHING ELSE EVER TOUCHES THEM. `core/db/backup.ts` enumerates a table's
    // columns from `information_schema` and therefore DOES carry `password_hash` into a snapshot —
    // correctly, because a backup that omits credentials is not restorable. It runs over the
    // administrative direct connection, never as an application role, and the resulting artifact is
    // credential-bearing and must be handled as such. This rule is about which source names the
    // columns deliberately; the grant rules above are what actually bound who can read them.
    const readers = filesMatching(/password_hash/, [
      "core", "lib", "app", "engines", "mission-control", "migration", "identity-backfill",
    ]);
    expect(readers.sort()).toEqual(["core/auth/credentials.ts", "core/auth/principal.ts"]);
  });
});

describe("F49 · no authorization-by-absence", () => {
  it("TOTAL COVERAGE: the map names every route file, and no others", () => {
    // No "n/a", no grouped row, no implicit default. A route with no entry is an ERROR, not an
    // allow — and an entry naming no file means the map is describing a system that moved on.
    expect(Object.keys(ROUTE_AUTHORIZATION).sort()).toEqual(ROUTE_FILES.sort());
    expect(ROUTE_FILES).toHaveLength(27);
  });

  it("no row is a wildcard or a pattern", () => {
    for (const key of Object.keys(ROUTE_AUTHORIZATION)) {
      expect(key, `${key} is a pattern, not a file`).not.toMatch(/\*/);
      expect(key).toMatch(/^app\/api\/.*\/route\.ts$/);
    }
  });

  it("DOUBLE ENTRY: every row's recorded sales verdict matches what the capability table produces", () => {
    // The map records the verdict; `can()` decides it. Checking them against each other catches a
    // row mapped to the wrong capability — which would otherwise read as intentional.
    const sales = __unsafePrincipalForTests("sales", "org" as never, "user" as never);
    const disagreements: string[] = [];
    for (const [route, entry] of Object.entries(ROUTE_AUTHORIZATION)) {
      if (entry.kind === "public") continue;
      const actual = can(sales, entry.capability);
      // `scoped` is a 200 whose CONTENTS are filtered, so the capability must be held.
      const expectedAllowed = entry.sales === "allow" || entry.sales === "scoped";
      if (actual !== expectedAllowed) {
        disagreements.push(`${route}: recorded ${entry.sales}, can() says ${actual ? "allow" : "deny"}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("every vault-backed route denied to sales is marked for the DOUBLE denial test", () => {
    // The rule this encodes: a route that returns nothing today because the server has no vault is
    // not authorized, it is empty. `backing` is what the security suite iterates to run each denial
    // twice — vault absent, then vault present — so the marking is load-bearing, not a note.
    const vaultDenied = Object.entries(ROUTE_AUTHORIZATION)
      .filter(([, v]) => v.kind === "capability" && v.backing === "vault" && v.sales === "deny");
    expect(vaultDenied.length, "no vault-backed denials are marked — the double test would be empty")
      .toBeGreaterThanOrEqual(15);
  });

  it("the AUTHORIZED surface never uses the unscoped knowledge index", () => {
    // The named gap stays where it is: server-rendered pages have no request context until 2G. It
    // must not spread to anything under app/api, which does.
    expect(filesMatching(/UNSCOPED_INTERNAL_INDEX/, ["app/api"])).toEqual([]);
  });

  it("search is SCOPED AT ASSEMBLY, not denied at the route", () => {
    // The distinction §9 exists to make: `sales` gets a 200 whose contents are filtered where they
    // are built. A route-level 403 here would be the wrong answer and would teach the wrong lesson.
    const route = stripComments(read("app/api/console/search/route.ts"));
    expect(route).toMatch(/authorize\(\s*request\s*,\s*"search"/);
    expect(route).toMatch(/buildKnowledgeIndex\(visibilityFor\(principal\)\)/);
    const knowledge = stripComments(read("core/knowledge/index.ts"));
    // Excluded material is NEVER DISCOVERED — stronger than filtering a result set.
    expect(knowledge).toMatch(/visibility\.clients \? discoverClients\(\) : none/);
    expect(knowledge).toMatch(/visibility\.sops \? discoverSops\(\) : none/);
    // And there is no default visibility to inherit.
    expect(knowledge).toMatch(/buildKnowledgeIndex\(visibility: KnowledgeVisibility\)/);
  });
});
