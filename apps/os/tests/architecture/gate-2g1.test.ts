// THE FINAL 2G.1 GATE — integration of evidence, not another implementation slice.
//
// It adds no behaviour and fixes nothing. It asserts that the claims 2G.1 closes on are the claims
// the repository can actually support, and it FAILS CLOSED: a property claimed PROVEN whose suite
// did not run in this execution fails the gate rather than passing quietly.
//
// That failure mode is not hypothetical. During slice 5 a suite whose `beforeAll` threw was read as
// "skipped" — vitest prints a failed suite's tests exactly like a gated one — and the misreading
// survived two sessions and reached the contract, the ledger and memory before anyone checked it.

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { GATE_2G1, OBSERVED_ONLY, PARKED_FINDINGS, type Evidence, type Phase } from "./gate-2g1";

const APP_ROOT = path.resolve(__dirname, "..", "..");

/** Every test file on disk — derived, never a maintained list. */
function testFilesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      if (name.endsWith(".test.ts")) out.push(path.relative(APP_ROOT, abs));
    }
  };
  walk(path.join(APP_ROOT, "tests"));
  return out.sort();
}

const entries = Object.entries(GATE_2G1);
const byClass = (e: Evidence) => entries.filter(([, v]) => v.evidence === e);

describe("FINAL 2G.1 GATE · totality — no suite is unclassified", () => {
  it("the manifest and the filesystem are the SAME SET", () => {
    // A suite with no entry is an ERROR, not an implicit pass — the shape F49 uses for routes and
    // F51 for pages. A new security suite cannot arrive unclassified.
    expect(Object.keys(GATE_2G1).sort()).toEqual(testFilesOnDisk());
  });

  it("every entry explains itself", () => {
    const unexplained = entries.filter(([, v]) => v.why.trim().length < 16).map(([k]) => k);
    expect(unexplained, "an unexplained classification is not evidence").toEqual([]);
  });
});

describe("FINAL 2G.1 GATE · phases — the manifest says WHAT, the scripts enforce WHEN", () => {
  const PHASES: readonly Phase[] = ["static", "server", "db"];

  it("every entry declares a known phase", () => {
    const bad = entries.filter(([, v]) => !PHASES.includes(v.phase)).map(([k, v]) => `${k}: ${v.phase}`);
    expect(bad, "an unknown phase is not a schedule").toEqual([]);
    // PROVEN without a phase is the failure this guards: a proof nothing knows when to run.
    expect(byClass("PROVEN").filter(([, v]) => !v.phase)).toEqual([]);
  });

  it("the declared phase matches the directory the phase scripts actually target", () => {
    // The scripts select by directory. If a label and its directory disagree, the manifest is
    // describing a schedule that does not happen.
    const wrong: string[] = [];
    for (const [file, v] of entries) {
      const expected: Phase =
        file.startsWith("tests/render/") ? "server" : file.startsWith("tests/db/") ? "db" : "static";
      if (v.phase !== expected) wrong.push(`${file}: declared ${v.phase}, scripts run it in ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it("PHASE IS VALIDATED AGAINST BEHAVIOUR, not just stored as a label", () => {
    // MEASURED constraint A: only the server phase may write probe routes into app/ or boot a dev
    // server. A suite that starts doing so from another phase reintroduces the contamination that
    // made three architecture rules fail.
    const boots = (file: string) => /spawn\(\s*"npx"|["']next["']\s*,\s*["']dev["']|next dev/.test(
      readFileSync(`${APP_ROOT}/${file}`, "utf8"));
    for (const [file, v] of entries) {
      // The DETECTOR cannot detect itself: this file contains the pattern as a regex literal, so it
      // matches its own source. Pinned by name rather than loosened, so a second self-exclusion
      // would have to be argued for.
      if (file === "tests/architecture/gate-2g1.test.ts") continue;
      if (v.phase === "server") {
        expect(boots(file), `${file} is phase "server" but boots no server`).toBe(true);
      } else {
        expect(boots(file), `${file} boots a dev server outside the server phase`).toBe(false);
      }
    }
  });

  it("the two server-phase suites still coordinate through the dev-server lock", () => {
    // They share `.next/dev` even WITHIN their phase, so the lock is an invariant of those two
    // tests rather than of the invocation. Phasing does not replace it.
    for (const [file, v] of entries.filter(([, x]) => x.phase === "server")) {
      const src = readFileSync(`${APP_ROOT}/${file}`, "utf8");
      expect(src, `${file} boots a server without acquiring the lock`).toContain("acquireDevServer");
      expect(src, `${file} never releases the lock`).toContain("releaseDevServer");
      void v;
    }
  });
});

// ─── LEDGER DRIFT ──────────────────────────────────────────────────────────────────────────────
/**
 * A SUITE AND ITS MANIFEST ROW MUST NOT DISAGREE ABOUT WHETHER IT HAS RUN.
 *
 * The exact failure this catches, found by the 2G.3 committed-tree review:
 *
 *     §27.17 updated   →   test header updated   →   MANIFEST FORGOTTEN
 *
 * Three artifacts described the same event and one of them said the opposite. The manifest claimed
 * `production-2g2-acceptance` was "NOT AUTHORIZED to run" for two commits after it had been
 * authorized, run, and passed — and cited the superseded section while doing it.
 *
 * It under-claimed rather than over-claimed, which is the safer direction and is exactly why nothing
 * caught it: no assertion fails when the ledger is too modest. This one does.
 *
 * Deliberately narrow. It compares two texts about ONE question — has this suite executed? — and
 * does not attempt to verify classifications generally. A broader rule here would be a new
 * architecture project, and this is a consistency check.
 */
describe("FINAL 2G.1 GATE · the ledger does not contradict the suites it describes", () => {
  /** Phrases a suite uses to record that it HAS executed, in its own header. */
  const RAN = /\b(EXECUTED|RUN AND PASSED)\b/;
  /** Phrases a manifest row uses to record that it has NOT. */
  const NOT_RUN = /NOT AUTHORIZED to run|has never run|built but not run/i;

  it("no manifest row says 'not run' about a suite whose own header says it ran", () => {
    const contradictions: string[] = [];
    for (const [file, entry] of Object.entries(GATE_2G1)) {
      const header = readFileSync(`${APP_ROOT}/${file}`, "utf8").split("\n").slice(0, 12).join("\n");
      if (RAN.test(header) && NOT_RUN.test(entry.why)) {
        contradictions.push(`${file}: the suite records that it ran; the manifest says it did not`);
      }
    }
    expect(contradictions, "the evidence ledger contradicts a suite's own record").toEqual([]);
  });

  it("the check can fire — proven on a constructed pair, not assumed", () => {
    // Without this, a regex that stopped matching would leave the rule green forever, which is the
    // same class of defect the rule itself exists to catch.
    expect(RAN.test("// PRODUCTION 2G.2 — ROLLBACK-SCOPED ACCEPTANCE. AUTHORIZED, RUN AND PASSED")).toBe(true);
    expect(NOT_RUN.test("built but NOT AUTHORIZED to run — §27.16")).toBe(true);
    expect(NOT_RUN.test("one-shot; rollback-scoped acceptance EXECUTED against production")).toBe(false);
  });
});

describe("FINAL 2G.1 GATE · fail closed — PROVEN means it RAN", () => {
  it("every PROVEN suite's environment gate is satisfied in THIS run", () => {
    // The heart of the gate. Presence only, never values — the credential-incident rule.
    const unmet: string[] = [];
    for (const [file, entry] of byClass("PROVEN")) {
      for (const v of entry.requires ?? []) {
        if (!process.env[v]) unmet.push(`${file} claims PROVEN but ${v} is not set, so it did not run`);
      }
    }
    expect(unmet,
      "PROVEN is a claim that a controlled proof EXECUTED. Run the gate with the full environment, " +
      "or reclassify these as BLOCKED — do not let a skipped suite read as a pass."
    ).toEqual([]);
  });

  it("nothing is BLOCKED without a stated cause, and BLOCKED is never counted as passing", () => {
    for (const [file, entry] of byClass("BLOCKED")) {
      expect(entry.why.length, `${file} is BLOCKED with no cause recorded`).toBeGreaterThan(24);
      expect(entry.evidence).not.toBe("PROVEN");
    }
    // Recorded as a fact rather than a footnote, and DELIBERATELY updated: this set was 4 while the
    // IPv6-only direct endpoint was unreachable. Egress returned, all four executed and passed, and
    // leaving them BLOCKED would make the manifest contradict measured reality.
    //
    // The gate is meant to be sensitive to that network, not insulated from it: if egress drops
    // again those suites FAIL in phase C, loudly, instead of resting in a comfortable category.
    expect(byClass("BLOCKED").length, "the blocked set changed — reclassify deliberately").toBe(0);
  });

  it("the gate is not vacuous — it governs real, proven work", () => {
    expect(byClass("PROVEN").length).toBeGreaterThan(20);
    expect(Object.keys(GATE_2G1).length).toBeGreaterThan(55);
  });
});

describe("FINAL 2G.1 GATE · an observation is never promoted to a proof", () => {
  it("observed-only properties are held separately and none claims to be proven", () => {
    expect(OBSERVED_ONLY.length).toBeGreaterThan(0);
    for (const o of OBSERVED_ONLY) {
      expect(o.why.length, `${o.property} is listed as observed with no reasoning`).toBeGreaterThan(80);
      // Each one must NAME the missing control. Policing the word "proven" was tried and rejected:
      // honest text legitimately says "proven in-process; here only observed", and a rule that
      // failed on that would push the next person toward vaguer wording, not safer claims.
      expect(o.why, `${o.property} does not say why it falls short of proof`)
        .toMatch(/no control|not proof|only observed|consistent with/i);
    }
  });

  it("no observed property is also claimed as a proven suite", () => {
    // Cheap structural guard against the same fact being counted twice, once per class.
    const provenWhy = byClass("PROVEN").map(([, v]) => v.why).join(" ").toLowerCase();
    for (const o of OBSERVED_ONLY) {
      expect(provenWhy).not.toContain(o.property.toLowerCase());
    }
  });
});

describe("FINAL 2G.1 GATE · parked findings stay parked", () => {
  it("every parked finding names the layer that owns it", () => {
    expect(PARKED_FINDINGS.length).toBe(6);
    for (const p of PARKED_FINDINGS) {
      expect(p.owner, `${p.finding} is parked with no owner`).toMatch(/^(2G\.2|2G\.3|2G\.4|after 2G\.4)$/);
    }
  });

  it("none of them was quietly fixed inside 2G.1", () => {
    // The temptation this slice exists to resist: assembling the gate and "just tidying" a finding
    // while in the neighbourhood. If one is genuinely fixed, it must LEAVE this list deliberately.
    const owners = new Set(PARKED_FINDINGS.map((p) => p.owner));
    expect([...owners].sort()).toEqual(["2G.2", "2G.3", "2G.4", "after 2G.4"]);
  });
});

describe("FINAL 2G.1 GATE · the ledger", () => {
  it("prints the accounting this stage closes on", () => {
    const count = (e: Evidence) => byClass(e).length;
    console.info(
      `\n      FINAL 2G.1 — EVIDENCE LEDGER\n` +
      `        PROVEN          ${count("PROVEN")}   executed controlled proofs\n` +
      `        BLOCKED         ${count("BLOCKED")}   infrastructure prevented execution\n` +
      `        PARKED          ${count("PARKED")}   deliberately deferred to a later layer\n` +
      `        NOT_APPLICABLE  ${count("NOT_APPLICABLE")}  not a 2G.1 authorization property\n` +
      `        OBSERVED-only   ${OBSERVED_ONLY.length}   production behaviour, no control in the loop\n` +
      `        parked findings ${PARKED_FINDINGS.length}\n`
    );
    expect(count("PROVEN") + count("BLOCKED") + count("PARKED") + count("NOT_APPLICABLE"))
      .toBe(Object.keys(GATE_2G1).length);
  });
});
