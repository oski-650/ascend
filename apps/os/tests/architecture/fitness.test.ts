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
   * KNOWN VIOLATION — NOT FIXED IN THIS INCREMENT (D6): app/dashboard/page.tsx imports `rank` as a
   * VALUE and calls it directly, bypassing mission-control/assemble.assemblePriorityFeed. The
   * exemption is deliberately narrow so the violation stays visible and any NEW one fails.
   */
  const KNOWN_VIOLATION = { file: "app/dashboard/page.tsx", specifier: "@/engines/decision-engine" };

  it("reports exactly the one known value import, and no others", () => {
    const valueEdges = ["app", "components"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/engines\b/.test(e.specifier) && !e.typeOnly)
      .map((e) => ({ file: e.from, specifier: e.specifier }));
    expect(valueEdges).toEqual([KNOWN_VIOLATION]);
  });

  it("the known violation still exists exactly as recorded (fails if silently fixed or moved)", () => {
    const edge = importsOf(KNOWN_VIOLATION.file).find((e) => e.specifier === KNOWN_VIOLATION.specifier);
    expect(edge).toBeDefined();
    expect(edge?.typeOnly).toBe(false);
  });

  it("all other surface → engine imports are type-only", () => {
    const others = ["app", "components"]
      .flatMap(importsUnder)
      .filter((e) => /^@\/engines\b/.test(e.specifier) && e.from !== KNOWN_VIOLATION.file);
    expect(others.length).toBeGreaterThan(0);
    for (const edge of others) expect(edge.typeOnly).toBe(true);
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