// Layer A — Approvals Awareness (Phase 8) contract tests.
//
// Frozen contract: a FACTUAL blocking-status read-model. It classifies + groups; it never ranks,
// never recommends, never acts (no score/priority — prioritising "who to chase" is Decision;
// signing is the portal write authority). Status logic is REUSED from domain.deriveApprovalStatus
// and never duplicated (DA-2). `now` is INJECTED, so every case below is deterministic.

import { describe, expect, it } from "vitest";
import { buildApprovalsDigest } from "@/engines/approvals-engine";
import { deriveApprovalStatus, type ApprovalKind, type ApprovalRequest } from "@/domain";

const NOW = new Date("2026-06-15T12:00:00.000Z");

const approval = (over: Partial<ApprovalRequest> & Pick<ApprovalRequest, "id">): ApprovalRequest =>
  ({
    client_slug: "acme",
    kind: "design" as ApprovalKind,
    title: "Approve the design",
    description: "",
    created_at: "2026-06-01T00:00:00.000Z",
    due_at: undefined,
    approved_at: null,
    approved_by_name: null,
    signature_text: null,
    ...over,
  }) as ApprovalRequest;

describe("approvals-engine · empty", () => {
  it("returns honest empty groups and zero counts", () => {
    expect(buildApprovalsDigest([], NOW)).toEqual({
      overdue: [],
      pending: [],
      approved: [],
      counts: { overdue: 0, pending: 0, approved: 0, total: 0 },
    });
  });
});

describe("approvals-engine · DA-2 status is delegated, not duplicated", () => {
  it("agrees with domain.deriveApprovalStatus for every record", () => {
    const records = [
      approval({ id: "past-due", due_at: "2026-06-01T00:00:00.000Z" }),
      approval({ id: "future-due", due_at: "2026-12-01T00:00:00.000Z" }),
      approval({ id: "no-due" }),
      approval({ id: "signed", approved_at: "2026-06-10T00:00:00.000Z" }),
    ];
    const digest = buildApprovalsDigest(records, NOW);
    const all = [...digest.overdue, ...digest.pending, ...digest.approved];
    // The engine must never disagree with the shared deriver — that would mean a second implementation.
    for (const record of records) {
      const expected = deriveApprovalStatus(record, NOW);
      expect(all.find((e) => e.id === record.id)?.status).toBe(expected);
    }
  });
});

describe("approvals-engine · missing due date is never overdue", () => {
  it("classifies an approval with no due_at as pending", () => {
    const digest = buildApprovalsDigest([approval({ id: "no-due" })], NOW);
    expect(digest.pending.map((e) => e.id)).toEqual(["no-due"]);
    expect(digest.overdue).toEqual([]);
    expect(digest.pending[0].due).toBeNull();
  });
});

describe("approvals-engine · grouping", () => {
  it("routes each record to exactly one group and keeps counts consistent", () => {
    const digest = buildApprovalsDigest(
      [
        approval({ id: "a", due_at: "2026-06-01T00:00:00.000Z" }),
        approval({ id: "b", due_at: "2026-12-01T00:00:00.000Z" }),
        approval({ id: "c", approved_at: "2026-06-10T00:00:00.000Z" }),
      ],
      NOW
    );
    const total = digest.overdue.length + digest.pending.length + digest.approved.length;
    expect(total).toBe(3);
    expect(digest.counts).toEqual({
      overdue: digest.overdue.length,
      pending: digest.pending.length,
      approved: digest.approved.length,
      total: 3,
    });
  });

  it("counts total as the input length regardless of grouping", () => {
    const digest = buildApprovalsDigest([approval({ id: "a" }), approval({ id: "b" })], NOW);
    expect(digest.counts.total).toBe(2);
  });
});

describe("approvals-engine · ordering guarantees", () => {
  it("orders by earliest due first within a group", () => {
    const digest = buildApprovalsDigest(
      [
        approval({ id: "later", due_at: "2026-12-01T00:00:00.000Z" }),
        approval({ id: "sooner", due_at: "2026-07-01T00:00:00.000Z" }),
      ],
      NOW
    );
    expect(digest.pending.map((e) => e.id)).toEqual(["sooner", "later"]);
  });

  it("places undated records after dated ones", () => {
    const digest = buildApprovalsDigest(
      [approval({ id: "undated" }), approval({ id: "dated", due_at: "2026-12-01T00:00:00.000Z" })],
      NOW
    );
    expect(digest.pending.map((e) => e.id)).toEqual(["dated", "undated"]);
  });

  it("breaks an identical-due tie by id ascending", () => {
    const due = "2026-12-01T00:00:00.000Z";
    const digest = buildApprovalsDigest(
      [approval({ id: "zzz", due_at: due }), approval({ id: "aaa", due_at: due })],
      NOW
    );
    expect(digest.pending.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });

  it("breaks a tie between two undated records by id ascending", () => {
    const digest = buildApprovalsDigest([approval({ id: "zzz" }), approval({ id: "aaa" })], NOW);
    expect(digest.pending.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });
});

describe("approvals-engine · injected clock determinism", () => {
  it("reclassifies purely as a function of the injected now — no hidden system clock", () => {
    const record = approval({ id: "a", due_at: "2026-06-10T00:00:00.000Z" });
    const before = buildApprovalsDigest([record], new Date("2026-06-01T00:00:00.000Z"));
    const after = buildApprovalsDigest([record], new Date("2026-06-20T00:00:00.000Z"));
    expect(before.pending.map((e) => e.id)).toEqual(["a"]);
    expect(after.overdue.map((e) => e.id)).toEqual(["a"]);
  });

  it("produces identical output for identical (records, now)", () => {
    const records = [approval({ id: "a", due_at: "2026-07-01T00:00:00.000Z" }), approval({ id: "b" })];
    expect(buildApprovalsDigest(records, NOW)).toEqual(buildApprovalsDigest(records, NOW));
  });
});

describe("approvals-engine · ownership boundary", () => {
  it("exposes no score, priority, or recommendation on an entry", () => {
    const digest = buildApprovalsDigest([approval({ id: "a" })], NOW);
    expect(Object.keys(digest.pending[0]).sort()).toEqual(
      ["clientSlug", "due", "id", "kind", "status", "title"].sort()
    );
  });

  it("emits no ranking/recommendation vocabulary anywhere in the digest", () => {
    const serialized = JSON.stringify(buildApprovalsDigest([approval({ id: "a" })], NOW)).toLowerCase();
    for (const forbidden of ["priority", "score", "rank", "recommend", "severity", "action"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});