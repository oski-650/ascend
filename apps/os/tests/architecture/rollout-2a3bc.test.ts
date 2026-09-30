// ROLLOUT-2A3BC-1 — the deploy smoke's release model, WITHOUT a database or a server.
//
// The smoke proves discrimination by requiring the checks new in a rollout to FAIL on the old build.
// Until 2A.3bc that marker was a boolean, which tied the script to the 2A.3a rollout. It now names the
// release, and the run names the release it executes. This file holds that model by source text,
// plus one real run of the refusal path (it exits before reading any environment or opening any
// connection).

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../..");
const SCRIPT = path.join(APP, "scripts/deploy-smoke.mjs");
const SMOKE = readFileSync(SCRIPT, "utf8");

/** The source of one `check("ID", …)` call, up to its closing `);`. */
function checkCall(id: string): string {
  const at = SMOKE.indexOf(`check("${id}"`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = SMOKE.indexOf("(", at); i < SMOKE.length; i++) {
    if (SMOKE[i] === "(") depth++;
    else if (SMOKE[i] === ")" && --depth === 0) return SMOKE.slice(at, i + 1);
  }
  return "";
}

const NEW_IN_2A3BC = ["A6", "E1", "E2", "E3", "E4", "E5", "R6", "R7", "R8", "R9"];

describe("the release is named by the run", () => {
  it("--baseline and --post refuse to run without a known --release, before touching anything", () => {
    for (const args of [["--baseline", "--record", "/nonexistent/x.json"], ["--post", "--since", "/nonexistent/x.json"],
                        ["--baseline", "--release", "2a3z", "--record", "/nonexistent/x.json"]]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, timeout: 20_000 });
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr, args.join(" ")).toMatch(/--release is required/);
      expect(r.stdout, "the run got past the release check").not.toContain("DEPLOYMENT SMOKE");
    }
  });

  it("knows exactly the two rollouts, and 2a3bc's old build already runs on 010", () => {
    expect([...SMOKE.matchAll(/^\s+"(2a3[a-z]+)": \{ old:/gm)].map((m) => m[1])).toEqual(["2a3a", "2a3bc"]);
    expect(SMOKE).toMatch(/"2a3a": \{ old: L009, new: L010, oldSalesTables: false, oldB5: false, zeroArchived: true, partnerRedirect: false \}/);
    expect(SMOKE).toMatch(/"2a3bc": \{ old: L010, new: L010, oldSalesTables: true, oldB5: true, zeroArchived: false, partnerRedirect: true \}/);
  });

  it("a check is expected to fail only in a baseline run for ITS release", () => {
    expect(SMOKE).toContain('const expectedFail = MODE === "baseline" && release !== null && release === RELEASE_NAME;');
    expect(SMOKE).not.toMatch(/newBuild/);
  });

  it("every marker names a known release", () => {
    const markers = [...SMOKE.matchAll(/\{ release: "([^"]+)" \}/g)].map((m) => m[1]);
    expect(markers.length).toBeGreaterThanOrEqual(NEW_IN_2A3BC.length + 10);
    for (const m of markers) expect(["2a3a", "2a3bc"], m).toContain(m);
  });
});

/** Source ranges of every `if (applies("X")) { … }` block, by brace matching. */
function appliesBlocks(): { release: string; from: number; to: number }[] {
  const out: { release: string; from: number; to: number }[] = [];
  for (const m of SMOKE.matchAll(/if \(applies\("([^"]+)"\)\) \{/g)) {
    let depth = 0;
    for (let i = m.index! + m[0].length - 1; i < SMOKE.length; i++) {
      if (SMOKE[i] === "{") depth++;
      else if (SMOKE[i] === "}" && --depth === 0) { out.push({ release: m[1], from: m.index!, to: i }); break; }
    }
  }
  return out;
}

describe("a selected release runs only its own and earlier checks (r1 finding HISTORICAL-SMOKE)", () => {
  it("releases are ordered as they shipped, and a check applies up to the selected release", () => {
    expect(SMOKE).toContain("const RELEASE_ORDER = Object.keys(RELEASES);");
    expect(SMOKE).toContain('const applies = (release) => RELEASE_ORDER.indexOf(release) <= RELEASE_ORDER.indexOf(RELEASE_NAME ?? "2a3bc");');
  });

  it("every check marked for a release after 2a3a runs only inside that release's applies() guard", () => {
    // A6 is the one exception: under 2a3a it is the frozen "/partner loads" check, and its 2a3bc form
    // is selected by RELEASES.partnerRedirect (asserted in the A6 test below).
    const blocks = appliesBlocks();
    const marked = [...SMOKE.matchAll(/check\("([A-Z]+\d+)"/g)]
      .map((m) => ({ id: m[1], at: m.index!, call: checkCall(m[1]) }))
      .filter((c) => /\{ release: "(?!2a3a")[^"]+" \}/.test(c.call) && c.id !== "A6");
    expect(marked.map((c) => c.id).sort()).toEqual(NEW_IN_2A3BC.filter((id) => id !== "A6").sort());
    for (const c of marked) {
      const release = /\{ release: "([^"]+)" \}/.exec(c.call)![1];
      expect(blocks.some((b) => b.release === release && b.from < c.at && c.at < b.to), `${c.id} runs outside applies("${release}")`).toBe(true);
    }
  });

  it("2a3a-marked checks are never gated: they apply to every release", () => {
    for (const b of appliesBlocks()) expect(b.release).not.toBe("2a3a");
  });
});

describe("the 2A.3bc checks", () => {
  it("every check new in 2A.3bc is marked for 2a3bc, so the old build proves it discriminates", () => {
    for (const id of NEW_IN_2A3BC) {
      const call = checkCall(id);
      expect(call, `${id} is missing`).not.toBe("");
      expect(call, id).toContain('{ release: "2a3bc" }');
    }
  });

  it("A6 asserts the /partner redirect under 2a3bc, and keeps the frozen 2a3a expectation otherwise", () => {
    const a6 = checkCall("A6");
    expect(a6).toContain('r.status === 307 && dest === "/sales"');
    expect(SMOKE).toMatch(/if \(p === "\/partner" && R\.partnerRedirect\) \{/);
    // The 2a3a path still reaches the generic "loads authenticated" check for /partner.
    expect(SMOKE).toMatch(/\["\/", "\/galaxy", "\/sales", "\/partner", "\/crm", "\/tasks", "\/signals"\]/);
    expect(SMOKE).toContain('check(`A${3 + i}`, `${p} loads authenticated`, r.status === 200');
  });

  it("the stage links are required in the viewer's own scope: team for the owner, mine for the partner", () => {
    expect(checkCall("E3")).toContain('scopedStages(links, "team")');
    expect(checkCall("R7")).toContain('scopedStages(plinks, "mine")');
    expect(SMOKE).toContain('["lead", "contacted", "proposal"].every((st, i) => links[i] === `/sales/list?scope=${scope}&stage=${st}`)');
  });

  it("absence checks require the page to have loaded, so an error page cannot pass them", () => {
    expect(checkCall("E5")).toContain("home.status === 200 && !linksPartner(home.text) && !linksPartner(queue.text)");
    expect(checkCall("R9")).toContain("pq.status === 200 && !linksPartner(pq.text)");
  });

  it("the 2A.3bc blocks only read: every request they make is a GET", () => {
    const owner = SMOKE.slice(SMOKE.indexOf('console.log("--- SALES / 2A.3bc (owner) ---")'), SMOKE.indexOf("// ─── SALES · the partner"));
    const partner = SMOKE.slice(SMOKE.indexOf('check("R5"'), SMOKE.indexOf("cookie = ownerCookie;"));
    for (const block of [owner, partner]) {
      const reqs = [...block.matchAll(/req\("([A-Z]+)"/g)].map((m) => m[1]);
      expect(reqs.length).toBeGreaterThan(0);
      expect(new Set(reqs)).toEqual(new Set(["GET"]));
    }
  });

  it("archival is ordinary work after 2A.3a: D2/D3 hold the count still rather than at zero, per release", () => {
    expect(SMOKE).toMatch(/if \(R\.zeroArchived\) \{[\s\S]*check\("D2", "zero prospects archived"/);
    expect(SMOKE).toContain('check("D2", "no prospect archived or restored during the smoke", after.archived === state.archived');
  });
});
