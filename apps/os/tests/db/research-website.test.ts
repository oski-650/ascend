// THE RESEARCH RUNNER, against a real Postgres — and the one property that matters most.
//
// ─── THE NEGATIVE IS THE SUBJECT ───────────────────────────────────────────────────────────────
//
// Finding a website is the easy half. The half this suite exists for is what happens when nothing
// answers: `website_quality` must stay NULL.
//
// `computeScore` pays +30 for `website_quality: 'none'` — exactly the `warm` threshold — and its own
// header records the last time an unchecked blank was read as an assertion: *"at the scale of a bulk
// import it makes the entire ranking meaningless."* A failed probe is consistent with the business
// having no site AND with slow DNS, a blocked crawler, or a domain nobody guessed. So the runner may
// record that it LOOKED and never that there is nothing there.
//
// Every probe here is a stub. The suite tests the RULE, not the internet — a test whose result
// depended on a real DNS lookup would be measuring the network.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type TestDb } from "./pglite";
import { asPrincipal, createOrganization, createProspect, createUser, addMembership } from "@/core/db";
import { readEvents } from "@/core/db/events";
import { registerAppDb, clearAppDb } from "@/core/auth/connection";
import { registerAuthorityResolver, clearAuthorityResolver } from "@/core/auth/authority";
import { __unsafePrincipalForTests } from "@/core/auth/principal";
import { researchProspectWebsite } from "@/core/research/website";
import type { OrganizationId, UserId } from "@/domain";

let handle: TestDb;
let db: TestDb["client"];
let org: OrganizationId;
let owner: UserId;

const asOwner = () => __unsafePrincipalForTests("owner", org, owner);

/** Answers for the domains named; refuses everything else. Never touches the network. */
const stubFetch = (answers: Record<string, number>) =>
  (async (url: string) => {
    const host = new URL(url).hostname;
    const status = answers[host];
    if (status === undefined) throw new Error("ENOTFOUND");
    return { status, url } as unknown as Response;
  }) as unknown as NonNullable<Parameters<typeof researchProspectWebsite>[1]>["fetchImpl"];

const prospectRow = async (id: string) =>
  (await asPrincipal(db, asOwner(), (tx) =>
    tx.query<{ website: string | null; website_quality: string | null; status: string | null }>(
      `SELECT website, website_quality, status FROM prospects WHERE id = $1`, [id]))).rows[0];

const researchEvents = async () =>
  asPrincipal(db, asOwner(), (tx) => readEvents(tx, { types: ["prospect.website_researched"] }));

beforeEach(async () => {
  handle = await freshDb();
  db = handle.client;
  org = await createOrganization(db, "acme", "Acme");
  owner = await createUser(db, "owner@test", "Owner");
  await addMembership(db, owner, org, "owner");
  registerAppDb((fn) => fn(db));
  registerAuthorityResolver(async () => ({ ok: true, principal: asOwner() }));
});
afterEach(async () => {
  clearAppDb();
  clearAuthorityResolver();
  await handle.close();
});

describe("a site that answers", () => {
  it("records the website and says which basis found it", async () => {
    const p = await createProspect(db, org,
      { name: "Prop Shop", contactEmail: "info@propshoprichmond.com" }, { kind: "system" });

    const result = await researchProspectWebsite(p.id, {
      fetchImpl: stubFetch({ "propshoprichmond.com": 200 }),
    });

    expect(result).toEqual({
      kind: "found", website: "https://propshoprichmond.com", basis: "contact_email_domain",
    });
    expect((await prospectRow(p.id)).website).toBe("https://propshoprichmond.com");
  });

  it("never overwrites a website the record already states", async () => {
    const p = await createProspect(db, org,
      { name: "Prop Shop", contactEmail: "info@propshoprichmond.com", website: "https://stated.example" },
      { kind: "system" });

    const result = await researchProspectWebsite(p.id, {
      fetchImpl: stubFetch({ "propshoprichmond.com": 200 }),
    });

    expect(result.kind).toBe("already_known");
    expect((await prospectRow(p.id)).website).toBe("https://stated.example");
    expect(await researchEvents(), "an untouched record produced an event").toHaveLength(0);
  });

  it("prefers the email domain over a name guess that also answers", async () => {
    const p = await createProspect(db, org,
      { name: "Minear Electric", contactEmail: "hi@minear-electric-co.com" }, { kind: "system" });

    const result = await researchProspectWebsite(p.id, {
      fetchImpl: stubFetch({ "minear-electric-co.com": 200, "minearelectric.com": 200 }),
    });

    expect(result).toMatchObject({ basis: "contact_email_domain" });
    expect((await prospectRow(p.id)).website).toBe("https://minear-electric-co.com");
  });
});

describe("NOTHING ANSWERS — the rule this module exists for", () => {
  it("leaves website_quality NULL, so the score cannot move", async () => {
    const p = await createProspect(db, org,
      { name: "Ghost Roofing", contactEmail: "owner@ghostroofing.com" }, { kind: "system" });

    const result = await researchProspectWebsite(p.id, { fetchImpl: stubFetch({}) });
    expect(result.kind).toBe("not_found");

    const row = await prospectRow(p.id);
    expect(row.website, "a failed probe wrote a website").toBeNull();
    // THE ASSERTION. `none` here is worth +30 — exactly the warm threshold — and nothing has
    // established it. A machine that could not reach a server has not learned that none exists.
    expect(row.website_quality, "a failed probe asserted the business has no website").toBeNull();
    expect(row.status, "a failed probe invented a pipeline position").toBeNull();
  });

  it("records that Ascend LOOKED, with what it tried and how each failed", async () => {
    const p = await createProspect(db, org,
      { name: "Ghost Roofing", contactEmail: "owner@ghostroofing.com" }, { kind: "system" });
    await researchProspectWebsite(p.id, { fetchImpl: stubFetch({}) });

    const events = await researchEvents();
    expect(events).toHaveLength(1);
    // `system`, not `operator`: the machine did the looking, and §19's operator count must not
    // absorb it.
    expect(events[0].actor).toBe("system");
    const data = events[0].data as { outcome: string; candidates: unknown[]; probes: { domain: string }[] };
    expect(data.outcome).toBe("not_found");
    expect(data.candidates.length).toBeGreaterThan(0);
    expect(data.probes.map((x) => x.domain)).toContain("ghostroofing.com");
  });

  it("a 404 from a live server is still not-found, and still asserts nothing", async () => {
    const p = await createProspect(db, org,
      { name: "Ghost Roofing", contactEmail: "owner@ghostroofing.com" }, { kind: "system" });

    // A server answered and declined. That is not a reachable site — and not proof of absence.
    const result = await researchProspectWebsite(p.id, { fetchImpl: stubFetch({ "ghostroofing.com": 404 }) });
    expect(result.kind).toBe("not_found");
    expect((await prospectRow(p.id)).website_quality).toBeNull();
  });

  it("says so plainly when the record gives it nothing to try", async () => {
    const p = await createProspect(db, org,
      { name: "2K", contactEmail: "someone@gmail.com" }, { kind: "system" });
    const result = await researchProspectWebsite(p.id, { fetchImpl: stubFetch({}) });
    expect(result.kind).toBe("no_candidates");
    expect(await researchEvents(), "a run with nothing to try still emitted an observation")
      .toHaveLength(0);
  });
});

describe("the writer is automation, and automation may not judge", () => {
  it("the research write cannot touch website_opportunity — the grant forbids it", async () => {
    const p = await createProspect(db, org, { name: "Prop Shop" }, { kind: "system" });
    // Proven at the DATABASE, not by reading the runner: whatever a future code path attempted,
    // `ascend_automation` holds no UPDATE privilege on the three judgment columns.
    await expect(
      asPrincipal(db, { role: "automation", organizationId: org, userId: null }, (tx) =>
        tx.query(`UPDATE prospects SET website_opportunity = 'red' WHERE id = $1`, [p.id]))
    ).rejects.toThrow();

    // THE CONTROL — the same role CAN write the column research actually uses.
    await expect(
      asPrincipal(db, { role: "automation", organizationId: org, userId: null }, (tx) =>
        tx.query(`UPDATE prospects SET website = 'https://x.example' WHERE id = $1`, [p.id]))
    ).resolves.toBeTruthy();
  });
});
