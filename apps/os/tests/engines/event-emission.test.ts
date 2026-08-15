// Layer A — MEMORY INTEGRITY. Every persistent writer, proven against a real fixture vault.
//
// Increment 9 gave four modules the ability to record what they did. These tests exist because an
// event spine you cannot trust is worse than none: a missing event is silent memory loss, and a
// duplicated or premature event is a false memory. Both are asserted here, per writer.
//
// THE FIVE PROPERTIES, for every mutation:
//   1. successful mutation      → exactly one event
//   2. failed / absent target   → zero events
//   3. no-op mutation           → zero events AND no rewrite
//   4. repeated real transitions→ one event each
//   5. the emitted subject      → resolves through canonical routing / graph identity
//
// NO PRODUCTION SEAM (D4, as in Increment 7). `vaultPath()` reads ASCEND_VAULT_PATH at call time,
// so a temp directory exercises the real resolver, reader, writer and emitter. Nothing is mocked.
// The operator's live vault is never addressed: the env var is set in beforeEach and restored in
// afterEach, and the fixture is removed.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocument, updateStatus, createNewVersion } from "@/lib/documents";
import {
  createInvite,
  revokeInvite,
  createSubmission,
  createApprovalRequest,
  signApproval,
} from "@/lib/portal";
import { appendAudit } from "@/lib/audits";
import { dismissFiring } from "@/lib/automations";
import { readEvents } from "@/core/events";
import { routeForEntity } from "@/navigation/routing";
import { graphNodeIdFor } from "@/graph-view/contract";
import type { EventEnvelope } from "@/domain";

let vaultDir: string;
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-events-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "01 - CRM & Clients", "fixture-client"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "04 - Documents"), { recursive: true });
  process.env.ASCEND_VAULT_PATH = vaultDir;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.ASCEND_VAULT_PATH;
  else process.env.ASCEND_VAULT_PATH = saved;
  await fs.rm(vaultDir, { recursive: true, force: true });
});

/** All events currently in the spine, oldest first — through the canonical reader, not the files. */
async function events(): Promise<EventEnvelope[]> {
  return readEvents();
}
async function typesOf(): Promise<string[]> {
  return (await events()).map((e) => e.type);
}

describe("memory · documents", () => {
  it("creating a document emits exactly one document.created", async () => {
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "Build" });
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("document.created");
    expect(all[0].subject).toEqual({ entity: "document", entity_id: doc.meta.doc_id });
    expect((all[0].data as { client: string }).client).toBe("fixture-client");
  });

  it("each real status transition emits once; re-applying the same status emits nothing", async () => {
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "Build" });
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "accepted");
    expect(await typesOf()).toEqual(["document.created", "document.sent", "document.accepted"]);

    // No-op: already accepted. No write, no event.
    const before = await fs.readFile(doc.filePath, "utf8").catch(() => "");
    await updateStatus(doc.meta.doc_id, "accepted");
    expect(await typesOf()).toHaveLength(3);
    if (before) expect(await fs.readFile(doc.filePath, "utf8")).toBe(before);
  });

  it("a missing document emits nothing", async () => {
    expect(await updateStatus("no-such-doc", "sent")).toBeNull();
    expect(await events()).toEqual([]);
  });

  it("versioning emits one supersede and one create — two real transitions", async () => {
    const v1 = await createDocument({ type: "sow", client: "fixture-client", title: "SOW" });
    await updateStatus(v1.meta.doc_id, "sent");
    const v2 = await createNewVersion(v1.meta.doc_id);
    expect(v2).not.toBeNull();
    expect([...(await typesOf())].sort()).toEqual(
      ["document.created", "document.created", "document.sent", "document.superseded"].sort()
    );
    const last = (await events()).at(-1)!;
    expect((last.data as { supersedes: string }).supersedes).toBe(v1.meta.doc_id);
  });

  it("KNOWN GAP: a reversal writes state but records no memory", async () => {
    // sent → draft is a real transition the UI offers ("Back to draft"), and packages/domain has no
    // event type for it. This test PINS the gap rather than hiding it: emitting `document.sent` for
    // a revert would be a false memory. If a type is later added, this expectation must change.
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "P" });
    await updateStatus(doc.meta.doc_id, "sent");
    const before = await typesOf();
    await updateStatus(doc.meta.doc_id, "draft"); // real state change, uncovered by the contract
    expect(await typesOf()).toEqual(before);
  });
});

describe("memory · portal", () => {
  it("issuing access emits exactly one portal.invited", async () => {
    const inv = await createInvite("fixture-client");
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("portal.invited");
    expect(all[0].subject).toEqual({ entity: "portal_invite", entity_id: inv.id });
  });

  it("rotation records BOTH the revocation and the new issue", async () => {
    await createInvite("fixture-client");
    await createInvite("fixture-client"); // rotate
    // Compared as a MULTISET, not a sequence: the revoke and the re-issue happen in the same
    // millisecond, and same-millisecond order is not currently recoverable (see the pinned
    // ordering defect at the end of this file). What must hold is that both facts were recorded.
    expect([...(await typesOf())].sort()).toEqual(
      ["portal.invite_revoked", "portal.invited", "portal.invited"].sort()
    );
  });

  it("revoking twice emits once — the second call is a no-op", async () => {
    const inv = await createInvite("fixture-client");
    await revokeInvite(inv.id);
    const after = await typesOf();
    await revokeInvite(inv.id);
    expect(await typesOf()).toEqual(after);
    expect(after.filter((t) => t === "portal.invite_revoked")).toHaveLength(1);
  });

  it("revoking an unknown invite emits nothing", async () => {
    expect(await revokeInvite("no-such-invite")).toBeNull();
    expect(await events()).toEqual([]);
  });

  it("a submission emits exactly one portal.submitted", async () => {
    const inv = await createInvite("fixture-client");
    const sub = await createSubmission({
      clientSlug: "fixture-client",
      inviteId: inv.id,
      fields: { goals: "more leads" },
      files: [],
    });
    const all = await events();
    expect([...all.map((e) => e.type)].sort()).toEqual(["portal.invited", "portal.submitted"]);
    const submitted = all.find((e) => e.type === "portal.submitted")!;
    expect(submitted.subject).toEqual({ entity: "portal_submission", entity_id: sub.id });
  });

  it("an approval emits on request and on signature, and signing twice emits once", async () => {
    const req = await createApprovalRequest({
      clientSlug: "fixture-client",
      kind: "design",
      title: "Approve homepage",
      description: "v2",
    });
    await signApproval({ id: req.id, by_name: "Pilar", signature_text: "Pilar" });
    const after = await typesOf();
    expect(after).toEqual(["approval.requested", "approval.approved"]);

    // Immutable once signed.
    await signApproval({ id: req.id, by_name: "Someone Else", signature_text: "x" });
    expect(await typesOf()).toEqual(after);
  });

  it("signing an unknown approval emits nothing", async () => {
    expect(await signApproval({ id: "nope", by_name: "x", signature_text: "y" })).toBeNull();
    expect(await events()).toEqual([]);
  });
});

describe("memory · audits and automations", () => {
  it("recording an audit emits exactly one audit.recorded", async () => {
    const a = await appendAudit({
      client: "fixture-client",
      url: "https://example.com",
      strategy: "mobile",
      run_at: new Date().toISOString(),
      scores: { performance: 61, accessibility: 84, best_practices: 100, seo: 91 },
      cwv: { lcp_ms: 2200, cls: 0.01, ttfb_ms: 300, inp_ms: null, fcp_ms: null },
      opportunities: [],
      source: "psi",
    });
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("audit.recorded");
    expect(all[0].subject).toEqual({ entity: "audit", entity_id: a.id });
  });

  it("dismissing a firing emits once; dismissing it again emits nothing", async () => {
    await dismissFiring("rule-a::fixture-client", "rule-a", { client_slug: "fixture-client" });
    const after = await typesOf();
    expect(after).toEqual(["automation.dismissed"]);
    await dismissFiring("rule-a::fixture-client", "rule-a", { client_slug: "fixture-client" });
    expect(await typesOf()).toEqual(after);
  });
});

describe("memory · every emitted subject is inspectable", () => {
  it("resolves to a canonical route or is honestly non-navigable, never invented", async () => {
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "P" });
    await updateStatus(doc.meta.doc_id, "sent");
    await createInvite("fixture-client");
    await createApprovalRequest({
      clientSlug: "fixture-client",
      kind: "design",
      title: "T",
      description: "d",
    });

    for (const e of await events()) {
      // Every event carries a subject the routing owner can be ASKED about. A null answer is a
      // legitimate result (that entity kind has no detail view) — what must never happen is an
      // event whose subject cannot be interrogated at all.
      expect(e.subject).toHaveProperty("entity");
      expect(e.subject).toHaveProperty("entity_id");
      expect(e.subject.entity_id.length).toBeGreaterThan(0);
      expect(() => routeForEntity(e.subject.entity, e.subject.entity_id)).not.toThrow();
      expect(() => graphNodeIdFor(e.subject.entity, e.subject.entity_id)).not.toThrow();

      // Every event about a client-owned object carries that client, so the operator always has
      // somewhere to stand even when the object itself has no detail route.
      expect((e.data as { client?: string } | undefined)?.client).toBe("fixture-client");
    }

    // The document subject specifically IS navigable, and agrees with graph identity.
    const created = (await events()).find((e) => e.type === "document.created")!;
    expect(routeForEntity("document", created.subject.entity_id)).toBe(
      `/documents/${created.subject.entity_id}`
    );
    expect(graphNodeIdFor("document", created.subject.entity_id)).toBe(
      `document:${created.subject.entity_id}`
    );
  });

  it("the log is append-only and ordered, and earlier events survive later writes", async () => {
    const first = await createDocument({ type: "proposal", client: "fixture-client", title: "One" });
    const firstEvent = (await events())[0];
    for (let i = 0; i < 3; i++) {
      await createDocument({ type: "sow", client: "fixture-client", title: `S${i}` });
    }
    const all = await events();
    expect(all).toHaveLength(4);
    // The original event is byte-identical after three subsequent appends.
    expect(all[0]).toEqual(firstEvent);
    expect(all[0].subject.entity_id).toBe(first.meta.doc_id);
    // occurred_at is non-decreasing. (event_id is NOT asserted monotonic — see below.)
    const stamps = all.map((e) => e.occurred_at);
    expect([...stamps].sort()).toEqual(stamps);
  });
});
describe("memory · KNOWN DEFECT · same-millisecond ordering is not recoverable", () => {
  /**
   * PINNED, NOT FIXED — reported to the operator before any temporal UI is built on it.
   *
   * `readEvents` sorts by `occurred_at`, then tie-breaks on `event_id`. `occurred_at` is
   * millisecond-resolution (`Date.now()`), and `newEventId()` is a UUIDv7 whose sub-millisecond
   * bits are pure `crypto.getRandomValues` — the timestamp only occupies bytes 0-5. So two events
   * emitted in the same millisecond sort in RANDOM order: measured at ~52% inversion, i.e. the
   * tiebreak carries no ordering information whatsoever.
   *
   * WHY IT MATTERS: a single operator action can emit two causally ordered events — rotating a
   * portal invite revokes the old link and issues a new one; versioning a document supersedes v1
   * and creates v2. Read back, those pairs can invert, and a "what changed" surface would then
   * state the effect before the cause.
   *
   * This test asserts only what is currently TRUE, so it will not silently start passing for the
   * wrong reason. When ordering is fixed, this test should be replaced by a sequence assertion.
   */
  it("two events emitted in one operation share a millisecond and cannot be sequenced", async () => {
    await createInvite("fixture-client");
    await createInvite("fixture-client"); // revoke + issue, same operation
    const all = await events();
    const sameMs = new Set(all.map((e) => e.occurred_at)).size < all.length;
    expect(all).toHaveLength(3);
    // The events exist and are individually trustworthy; only their relative order is not.
    expect(sameMs).toBe(true);
  });
});
