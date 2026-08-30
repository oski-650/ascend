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

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindTestAuthority, unbindTestAuthority } from "@/tests/support/operator-session";
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
import { createProspect } from "@/core/crm";
import { appendAudit } from "@/lib/audits";
import { dismissFiring } from "@/lib/automations";
import { emitEvent, readEvents } from "@/core/events";
import { routeForEntity } from "@/navigation/routing";
import { graphNodeIdFor } from "@/graph-view/contract";
import type { EventEnvelope } from "@/domain";

/**
 * These tests call data functions that touch owner-only storage, which since 2G.1 slice 2 require a
 * capability. Declaring the caller is the boundary working — a test is a caller like any other.
 */
beforeEach(() => bindTestAuthority("owner"));
afterAll(() => unbindTestAuthority());

let vaultDir: string;
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.ASCEND_VAULT_PATH;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-events-"));
  await fs.mkdir(path.join(vaultDir, ".ascend-os"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "01 - CRM & Clients", "fixture-client"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "04 - Documents"), { recursive: true });
  await fs.mkdir(path.join(vaultDir, "02 - Sales & Hit List"), { recursive: true });
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
    expect(await typesOf()).toEqual([
      "document.created",
      "document.sent",
      "document.superseded",
      "document.created",
    ]);
    const last = (await events()).at(-1)!;
    expect((last.data as { supersedes: string }).supersedes).toBe(v1.meta.doc_id);
  });

  it("a reversal records document.status_changed with its direction, in order", async () => {
    // The exact case the contract was extended for. `document.sent` is an ACT; a revert is not that
    // act, so it gets the direction-neutral type. The sequence must read correctly even though all
    // three events land in the same millisecond and the same log.
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "P" });
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "draft");

    const all = await events();
    expect(all.map((e) => e.type)).toEqual([
      "document.created",
      "document.sent",
      "document.status_changed",
    ]);
    const reversal = all[2];
    expect(reversal.data).toMatchObject({ from: "sent", to: "draft" });
    expect(reversal.subject).toEqual({ entity: "document", entity_id: doc.meta.doc_id });
  });

  it("an accepted → sent reversal is also status_changed, never a second document.sent", async () => {
    const doc = await createDocument({ type: "contract", client: "fixture-client", title: "C" });
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "accepted");
    await updateStatus(doc.meta.doc_id, "sent"); // backwards
    const all = await events();
    expect(all.map((e) => e.type)).toEqual([
      "document.created",
      "document.sent",
      "document.accepted",
      "document.status_changed",
    ]);
    expect(all.filter((e) => e.type === "document.sent")).toHaveLength(1);
    expect(all[3].data).toMatchObject({ from: "accepted", to: "sent" });
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
    // A SEQUENCE assertion, not a multiset: rotation revokes the old link and then issues a new
    // one, both inside one millisecond, and the reader must preserve that causal order.
    expect(await typesOf()).toEqual([
      "portal.invited",
      "portal.invite_revoked",
      "portal.invited",
    ]);
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
    expect(all.map((e) => e.type)).toEqual(["portal.invited", "portal.submitted"]);
    expect(all[1].subject).toEqual({ entity: "portal_submission", entity_id: sub.id });
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

describe("memory · prospects", () => {
  const MD = "---\nname: Fixture Roofing\nstatus: lead\n---\n\n## Notes\n";

  it("creating a prospect emits exactly one prospect.created", async () => {
    const r = await createProspect("fixture-roofing", MD);
    expect(r).toMatchObject({ slug: "fixture-roofing", existed: false, written: true });
    const all = await events();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("prospect.created");
    expect(all[0].subject).toEqual({ entity: "prospect", entity_id: "fixture-roofing" });
  });

  it("overwriting an existing prospect writes state but records no second birth", async () => {
    await createProspect("fixture-roofing", MD);
    const after = await typesOf();
    const r = await createProspect("fixture-roofing", MD + "\nupdated\n", { overwrite: true });
    expect(r).toMatchObject({ existed: true, written: true });
    // The file changed — a bulk re-import must not claim the prospect was created twice.
    expect(await typesOf()).toEqual(after);
  });

  it("a refused overwrite writes nothing and emits nothing", async () => {
    await createProspect("fixture-roofing", MD);
    const after = await typesOf();
    // Snapshot what creation actually persisted rather than comparing against the input literal.
    // Creation now injects the `prospect_id` anchor (D-4), so the file is legitimately not
    // byte-identical to MD — but this test is about the REFUSED OVERWRITE changing nothing, and
    // comparing before-vs-after states that directly instead of restating the file's expected
    // contents. It is the stronger assertion: it would also catch a partial or reordering rewrite.
    const file = path.join(vaultDir, "02 - Sales & Hit List", "fixture-roofing.md");
    const before = await fs.readFile(file, "utf8");

    const r = await createProspect("fixture-roofing", "DIFFERENT", { overwrite: false });
    expect(r).toMatchObject({ existed: true, written: false });
    expect(await typesOf()).toEqual(after);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("repeated creation of the same slug emits once, not once per call", async () => {
    for (let i = 0; i < 4; i++) await createProspect("fixture-roofing", MD, { overwrite: true });
    expect((await typesOf()).filter((t) => t === "prospect.created")).toHaveLength(1);
  });

  it("distinct prospects each emit their own creation, in append order", async () => {
    await createProspect("alpha-co", MD);
    await createProspect("beta-co", MD);
    await createProspect("gamma-co", MD);
    const all = await events();
    expect(all.map((e) => e.subject.entity_id)).toEqual(["alpha-co", "beta-co", "gamma-co"]);
  });

  it("the emitted subject resolves to the canonical prospect route and graph node", async () => {
    await createProspect("fixture-roofing", MD);
    const [e] = await events();
    expect(routeForEntity(e.subject.entity, e.subject.entity_id)).toBe("/sales/fixture-roofing");
    expect(graphNodeIdFor(e.subject.entity, e.subject.entity_id)).toBe("prospect:fixture-roofing");
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
describe("memory · ordering is recoverable from the log", () => {
  /**
   * THE INVARIANT (Increment 9, ruling A):
   *
   *   If B was appended after A to the same log, readEvents never returns B before A —
   *   even when occurred_at(A) === occurred_at(B).
   *
   * `readEvents` orders by occurred_at across logs, then by physical append position within a log.
   * `event_id` is identity and takes no part: it is a UUIDv7 whose sub-millisecond bits are random,
   * which inverted same-millisecond pairs ~52% of the time when it was used as the tiebreak.
   */
  it("preserves append order for same-millisecond events in one log", async () => {
    // Six events, one operation each, all in the documents log and almost certainly one millisecond.
    const doc = await createDocument({ type: "proposal", client: "fixture-client", title: "P" });
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "accepted");
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "draft");
    await updateStatus(doc.meta.doc_id, "sent");

    const all = await events();
    expect(all.map((e) => e.type)).toEqual([
      "document.created",
      "document.sent",
      "document.accepted",
      "document.status_changed", // accepted → sent
      "document.status_changed", // sent → draft
      "document.sent", // draft → sent, forward again
    ]);

    expect(all.every((e) => e.subject.entity_id === doc.meta.doc_id)).toBe(true);
  });

  it("holds under a FORCED timestamp collision — the case id-ordering could not survive", async () => {
    // Deterministic rather than racing the clock: ten events appended to one log with an IDENTICAL
    // occurred_at. Under the old event_id tiebreak this ordering was a ~52% coin flip; under append
    // ordering it must be exact, every run.
    const when = "2026-08-15T12:00:00.000Z";
    for (let i = 0; i < 10; i++) {
      await emitEvent({
        type: "document.status_changed",
        subject: { entity: "document", entity_id: "collision-doc" },
        data: { seq: i, from: "draft", to: "sent" },
        occurred_at: when,
      });
    }
    const all = await readEvents({ entity_id: "collision-doc" });
    expect(all).toHaveLength(10);
    expect(all.every((e) => e.occurred_at === when)).toBe(true); // a real collision, by construction
    expect(all.map((e) => (e.data as { seq: number }).seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Proof the order came from the LOG and not from the ids: the ids are not sorted.
    const ids = all.map((e) => e.event_id);
    expect(ids).not.toEqual([...ids].sort());
  });

  it("orders a document's own history correctly when read back by entity", async () => {
    const doc = await createDocument({ type: "sow", client: "fixture-client", title: "S" });
    await updateStatus(doc.meta.doc_id, "sent");
    await updateStatus(doc.meta.doc_id, "draft");
    const history = await readEvents({ entity: "document", entity_id: doc.meta.doc_id });
    expect(history.map((e) => e.type)).toEqual([
      "document.created",
      "document.sent",
      "document.status_changed",
    ]);
  });
});
