// THE 2G.4 GATE — integration of evidence, not another implementation slice.
//
// Same posture as `gate-2g1.test.ts` and, per §29.6, the same BINDING: **2G.4.6 DOES NO FIXING.**
// Every assertion here checks that the accounting in `gate-2g4.ts` is TOTAL and INTERNALLY HONEST.
// None of them can be satisfied by changing behaviour, because none of them looks at behaviour.
//
// What "honest" means here, concretely, and each has a test below:
//
//   • every frozen 2G.1 parked finding has exactly one disposition, matched VERBATIM
//   • no disposition names a finding that was never parked
//   • §8's eleven rows are all present, and the two rows with two halves keep both
//   • a withheld decision is never dressed as an obstacle (§26.2)
//   • everything 2G.4 carries forward names what would RETIRE it

import { describe, expect, it } from "vitest";
import { PARKED_FINDINGS } from "./gate-2g1";
import { CARRIED_FORWARD, DISPOSITIONS, MATRIX_ROWS } from "./gate-2g4";

describe("2G.4 GATE · every parked finding has exactly one disposition", () => {
  it("the disposition list and the FROZEN snapshot are the SAME SET, matched verbatim", () => {
    // Set equality in both directions, on the finding text itself. Paraphrase is the failure mode:
    // a finding reworded into something easier to close would silently satisfy a `startsWith` or a
    // keyword match, and §29.8's whole point is that the snapshot is history and does not move.
    const parked = PARKED_FINDINGS.map((p) => p.finding).sort();
    const disposed = DISPOSITIONS.map((d) => d.finding).sort();
    expect(disposed.filter((d) => !parked.includes(d)), "a disposition names no parked finding")
      .toEqual([]);
    expect(parked.filter((p) => !disposed.includes(p)), "a parked finding has no disposition")
      .toEqual([]);
  });

  it("no finding is disposed of twice", () => {
    expect(new Set(DISPOSITIONS.map((d) => d.finding)).size).toBe(DISPOSITIONS.length);
  });

  it("every disposition names WHO and points at WHAT — a claim about the past needs a witness", () => {
    for (const d of DISPOSITIONS) {
      expect(d.by.length, `${d.state} with no owner`).toBeGreaterThan(3);
      expect(d.evidence.length, `${d.by} disposed of a finding with no evidence`).toBeGreaterThan(60);
    }
  });

  it("the two findings 2G.4 OWNED are discharged, and the deferral says why it is not 'still parked'", () => {
    // Named individually rather than counted: "two are DISCHARGED" passes with the wrong two.
    const by = (needle: string) => DISPOSITIONS.find((d) => d.finding.includes(needle));
    expect(by("admin, admin/import, admin/wipe")?.state).toBe("DISCHARGED");
    expect(by("reaches the error boundary")?.state).toBe("DISCHARGED");
    // The deferral is the one that could rot into an excuse, so it must carry BOTH halves of
    // Ruling 4: a retirement condition, and the rule that now enforces it.
    const deferred = by("discoverClients/discoverSops");
    expect(deferred?.state).toBe("DEFERRED");
    expect(deferred?.evidence, "a deferral with no retirement condition is an excuse")
      .toMatch(/retirement condition|retires when/i);
    expect(deferred?.evidence, "the deferral does not name the rule that enforces its boundary")
      .toMatch(/F52/);
  });
});

describe("2G.4 GATE · §8's eleven rows are complete, and split rows stay split", () => {
  it("every row 1..11 appears", () => {
    const seen = new Set(MATRIX_ROWS.map((r) => r.row));
    const missing = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((n) => !seen.has(n));
    expect(missing, "a row of §8's matrix has no disposition").toEqual([]);
    expect([...seen].sort((a, b) => a - b), "a row outside 1..11 appeared")
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("rows 5 and 11 keep BOTH halves, and only those rows have halves", () => {
    // §29.3 Ruling 5: the two halves do not share a fate, and flattening them would let a row read
    // as proven because one half is. A row that lost a half would still pass the totality test above.
    const halves = (n: number) => MATRIX_ROWS.filter((r) => r.row === n).map((r) => r.half).sort();
    expect(halves(5)).toEqual(["local", "production"]);
    expect(halves(11)).toEqual(["local", "production"]);
    const withHalves = new Set(MATRIX_ROWS.filter((r) => r.half).map((r) => r.row));
    expect([...withHalves].sort((a, b) => a - b)).toEqual([5, 11]);
  });

  it("every row says what discharged it, and the pre-existing ones say they PREDATE 2G.4", () => {
    for (const r of MATRIX_ROWS) {
      expect(r.discharged.length, `row ${r.row}${r.half ? ` (${r.half})` : ""} has no witness`)
        .toBeGreaterThan(30);
    }
    // Rows 3, 4 and 8 were proven before this stage. Saying so is what stops 2G.4's closure summary
    // counting other stages' work as its own — the same rule §29.2 applied to its own inputs.
    for (const n of [3, 4, 8]) {
      const row = MATRIX_ROWS.find((r) => r.row === n);
      expect(row?.discharged, `row ${n} does not say it predates 2G.4`).toMatch(/PREDATES 2G\.4/);
    }
  });

  it("row 10 is PROVEN, BOUNDED — a bound named in the row, not in a footnote", () => {
    const row = MATRIX_ROWS.find((r) => r.row === 10);
    expect(row?.evidence).toBe("PROVEN, BOUNDED");
    expect(row?.discharged, "row 10's bound is not stated where the row is read")
      .toMatch(/STUB|PROBE|not closed by 2G\.4/i);
  });

  it("row 11's production half is WITHHELD and never BLOCKED — §26.2", () => {
    // The one assertion in this file with a security consequence. §26.2: *"Nothing prevented these
    // from running; they were withheld, and the manifest says so rather than borrowing the word
    // 'blocked.'"* Calling a decision an obstacle is how a choice stops being anybody's to make.
    const row = MATRIX_ROWS.find((r) => r.row === 11 && r.half === "production");
    expect(row?.evidence).toBe("PARKED — WITHHELD");
    expect(row?.discharged, "row 11's production half borrowed the word BLOCKED for a decision")
      .not.toMatch(/\bBLOCKED\b/);
    expect(row?.discharged, "it does not say what withholds it").toMatch(/Q2|decision/);
  });
});

describe("2G.4 GATE · what this stage carries forward is a known set, not a silence", () => {
  it("every carried item names an owner and what would RETIRE it", () => {
    expect(CARRIED_FORWARD.length).toBeGreaterThan(0);
    for (const c of CARRIED_FORWARD) {
      expect(c.owner.length, `${c.item} is carried with no owner`).toBeGreaterThan(3);
      expect(c.retires.length, `${c.item} has no retirement condition — nobody can close it`)
        .toBeGreaterThan(40);
    }
  });

  it("both production defects state that they fail CLOSED — the reason they are recorded, not fixed", () => {
    // §29.6b and §29.6e are recorded rather than repaired because each costs EVIDENCE, not
    // isolation. If a future carried defect does not fail closed, this assertion is where the
    // difference has to be argued rather than assumed.
    const defects = CARRIED_FORWARD.filter((c) => c.kind === "PRODUCTION DEFECT");
    expect(defects.length).toBeGreaterThan(0);
    for (const d of defects) {
      expect(`${d.item} ${d.retires}`, `${d.item} does not say which way it fails`)
        .toMatch(/fails CLOSED/i);
    }
  });

  it("Q1 is carried as an OPEN DECISION and this slice does not answer it", () => {
    // §29.10 BINDS the closure criterion's final wording to someone other than §29's author —
    // *"a contract author is the worst reader of their own clause."* A gate that wrote the criterion
    // and then asserted it would be the same author marking their own work, so it records the
    // question and stops.
    const q1 = CARRIED_FORWARD.find((c) => c.item.includes("§29.10 Q1"));
    expect(q1?.kind).toBe("OPEN DECISION");
    expect(q1?.owner).toBe("human");
    expect(q1?.retires).toMatch(/does NOT write it/);
  });

  it("Q2 was ANSWERED, and a declined decision is recorded rather than left silent", () => {
    // §29.11 made "declined" a valid outcome with one condition attached — that it be recorded as
    // declined. An unanswered question and a question answered "no" look identical in a repository
    // that only records what it did, which is the silence this assertion refuses.
    const q2 = CARRIED_FORWARD.find((c) => c.item.includes("§29.11 Q2"));
    expect(q2, "Q2 left the accounting entirely").toBeDefined();
    expect(q2?.owner, "Q2 is still carried as unanswered").toMatch(/ANSWERED/);
    expect(q2?.retires, "the decline is recorded without saying the local half still holds")
      .toMatch(/2G\.4\.1/);
    // It must still classify row 11's production half as WITHHELD. Only the POSITIVE property is
    // asserted, and that is a correction made twice while writing this test: a ban on the word
    // "BLOCKED" fired on the entry's own "never BLOCKED", and a ban on "prevented the run" fired on
    // "nothing prevented the run, a person decided against it". Both times the rule was flagging the
    // sentence that draws the distinction it exists to protect.
    //
    // The same lesson `gate-2g1`'s observed-only rule already records — *"policing the word 'proven'
    // was tried and rejected: honest text legitimately says 'proven in-process; here only observed',
    // and a rule that failed on that would push the next person toward vaguer wording, not safer
    // claims."* A source-text rule must match the CLASSIFICATION, never the prose explaining it.
    // The classification is enforced where it belongs: MATRIX_ROWS' row 11 test above.
    expect(q2?.retires, "Q2's decline no longer says row 11's production half is WITHHELD")
      .toMatch(/WITHHELD/);
  });

  it("prints the accounting 2G.4 closes on", () => {
    const states = (s: string) => DISPOSITIONS.filter((d) => d.state === s).length;
    console.info(
      `\n      2G.4 — PARTNER SECURITY ACCOUNTING\n` +
      `        parked findings DISCHARGED   ${states("DISCHARGED")}\n` +
      `        parked findings DEFERRED     ${states("DEFERRED")}  (retirement condition ENFORCED by F52)\n` +
      `        parked findings RETIRED      ${states("RETIRED")}  (2G.2, 2G.3 — predate 2G.4)\n` +
      `        parked findings STILL PARKED ${states("STILL PARKED")}  (Sheets intake, out of scope by contract)\n` +
      `        §8 matrix entries            ${MATRIX_ROWS.length}  across 11 rows\n` +
      `        carried forward              ${CARRIED_FORWARD.length}  each with a retirement condition\n`
    );
    expect(states("DISCHARGED") + states("DEFERRED") + states("RETIRED") + states("STILL PARKED"))
      .toBe(DISPOSITIONS.length);
  });
});
