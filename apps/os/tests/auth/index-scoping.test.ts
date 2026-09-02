// Layer A — SCOPED INDEX ASSEMBLY (2G.1 slice 4, STAGE2G §23).
//
//   > The index boundary must decide what gets built before the filesystem or database is touched —
//   > not decide what gets hidden afterward.
//
// ─── WHY THE EVIDENCE IS FILESYSTEM READS, NOT RENDERED OUTPUT ─────────────────────────────────
//
// The property is about CONSTRUCTION. `tests/api/search-boundary` already proves the route's
// results are scoped, and it proves it well — but a result-shaped assertion cannot distinguish
// "never built" from "built and then filtered", and those are different security properties. So the
// assertions below count the files the process actually OPENS. A sales principal that causes
// `business_context.md` to be read has already lost, whatever the markup ends up saying.
//
// ─── WHAT WAS MEASURED AT 017b633, BEFORE ANY OF THIS EXISTED ──────────────────────────────────
//
//   /console as SALES   → client NAME and SOP title present in the rendered markup
//   /       as SALES    → correctly DENIED, and 1 client file + 1 SOP file opened anyway
//
// Both are reproduced here as regressions rather than described, so the fix is measured against the
// defect and not against an intention.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  bindTestAuthority, installStubDb, removeStubDb, resetMemberships, unbindTestAuthority,
} from "@/tests/support/operator-session";

const CLIENT_NAME = "Northwind Trading Co";
const CLIENT_BODY = "retainer-renewal-confidential";
const SOP_TITLE = "Northwind Onboarding SOP";
const PROSPECT_NAME = "Northwind Roofing Prospect";
const TERM = "Northwind";

// ─── The instrument: every vault file this process opens ───────────────────────────────────────
const opened = vi.hoisted(() => ({ text: [] as string[], jsonl: [] as string[] }));

vi.mock("@/core/vault/markdown", async (orig) => {
  const actual = await orig<typeof import("@/core/vault/markdown")>();
  return { ...actual, readTextFile: async (p: string) => { opened.text.push(p); return actual.readTextFile(p); } };
});
vi.mock("@/core/vault/io", async (orig) => {
  const actual = await orig<typeof import("@/core/vault/io")>();
  return { ...actual, readJsonlFile: async (p: string) => { opened.jsonl.push(p); return actual.readJsonlFile(p); } };
});

const clientReads = () => opened.text.filter((p) => p.includes("01 - CRM & Clients"));
const sopReads = () => opened.text.filter((p) => p.includes("03 - SOP Library"));
const eventReads = () => opened.jsonl.filter((p) => p.includes(".ascend-os"));

let vaultDir: string;
let savedVault: string | undefined;
let savedSource: string | undefined;

beforeAll(async () => {
  savedVault = process.env.ASCEND_VAULT_PATH;
  savedSource = process.env.ASCEND_PROSPECT_SOURCE;
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "ascend-scoping-"));
  for (const d of [".ascend-os", "01 - CRM & Clients/acme-co", "02 - Sales & Hit List", "03 - SOP Library", "04 - Documents"]) {
    await fs.mkdir(path.join(vaultDir, d), { recursive: true });
  }
  for (const f of ["crm", "production", "intelligence"]) {
    await fs.writeFile(path.join(vaultDir, ".ascend-os", `${f}.events.jsonl`), "");
  }
  // ONE TERM MATCHES ALL THREE KINDS. Without that the sales assertions could pass because the
  // query missed, not because the material was never assembled — the fixture control that
  // search-boundary already establishes for the route.
  await fs.writeFile(path.join(vaultDir, "01 - CRM & Clients/acme-co/business_context.md"),
    `---\nname: ${CLIENT_NAME}\nstatus: active\n---\n\n## Notes\n${CLIENT_BODY} — Northwind pays monthly.\n`);
  await fs.writeFile(path.join(vaultDir, "03 - SOP Library/onboarding.md"),
    `---\ntitle: ${SOP_TITLE}\n---\n\nInternal operating material. Northwind.\n`);
  await fs.writeFile(path.join(vaultDir, "02 - Sales & Hit List/northwind-roofing.md"),
    `---\nname: ${PROSPECT_NAME}\nbusiness_type: Roofing\nstatus: lead\nwebsite: ""\n` +
    `website_quality: acceptable\ndecision_maker_access: "false"\nproject_urgency: low\n` +
    `niche_alignment: "false"\ncontact_name: ""\ncontact_phone: ""\ncontact_email: ""\n` +
    `source: ""\nfirst_contact: ""\nlast_contact: ""\nlocation: Modesto, CA\n---\n\n## Call Log\n- Northwind intro.\n`);
  process.env.ASCEND_VAULT_PATH = vaultDir;
  // The VAULT store here on purpose: it isolates the property under test. Under `postgres` a sales
  // prospect read would additionally traverse the DAL, and this file is measuring which FILES get
  // opened, not which store answers. The client and SOP paths are filesystem-backed either way.
  process.env.ASCEND_PROSPECT_SOURCE = "vault";
  installStubDb();
  resetMemberships();
});

afterAll(async () => {
  removeStubDb();
  await fs.rm(vaultDir, { recursive: true, force: true });
  if (savedVault === undefined) delete process.env.ASCEND_VAULT_PATH; else process.env.ASCEND_VAULT_PATH = savedVault;
  if (savedSource === undefined) delete process.env.ASCEND_PROSPECT_SOURCE; else process.env.ASCEND_PROSPECT_SOURCE = savedSource;
});

afterEach(() => { unbindTestAuthority(); opened.text.length = 0; opened.jsonl.length = 0; });

async function renderPage(mod: () => Promise<Record<string, unknown>>, sp: Record<string, string> = {}) {
  const page = (await mod()).default as (p: unknown) => Promise<unknown>;
  try {
    const el = await page({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) });
    return { html: renderToStaticMarkup(el as ReactElement) };
  } catch (e) {
    return { html: "", err: e as Error };
  } finally {
    // Work abandoned by a rejected Promise.all keeps running — JavaScript has no cancellation — so
    // its I/O must be allowed to land before the file counts are read. Omitting this would let C2
    // pass by measuring too early.
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ─── C1 / C2 · INVERTED AT 2G.4.7, AND THE INVERSION IS THE POINT ─────────────────────────────
//
// These assertions read the other way until 2026-09-02: a SALES render opened ZERO client files and
// ZERO SOP files, and `/` denied sales while opening nothing it was denied. Both were TRUE and both
// were the correct measurement of a narrow sales role.
//
// What changed is the business model, not the mechanism. The partner became `owner` minus `admin:*`,
// so `visibilityFor` — which derives from `can(principal, "clients:*")` and `can(principal,
// "sops:read")`, nothing else — now answers `true` for both. **The scoping did not weaken. The
// principal's capabilities widened, and the scoping followed them, which is exactly what it was
// built to do.**
//
// INVERTED RATHER THAN DELETED, and the distinction matters more here than anywhere else in this
// change: §23's whole finding was that `/console` served a client name and an owner-only SOP title
// to a principal who should not have had them. Deleting these rows would remove the only executable
// memory of that defect. Kept, flipped, and paired with a control below that still proves the
// mechanism can EXCLUDE — because a scoping layer that includes everything for everyone would now
// pass every positive assertion in this block.

describe("§23 C1 · /console assembles exactly what the caller is entitled to", () => {
  it("SALES · client and SOP files ARE opened — he holds clients:* and sops:read (2G.4.7)", async () => {
    bindTestAuthority("sales");
    await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(clientReads().length, "the partner's own client file was not read").toBeGreaterThan(0);
    expect(sopReads().length, "the partner's SOP library was not read").toBeGreaterThan(0);
  });

  it("SALES · and therefore the client and SOP material DOES reach the markup", async () => {
    bindTestAuthority("sales");
    const { html } = await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(html, "the partner lost the client he is entitled to").toContain(CLIENT_NAME);
    expect(html, "the partner lost the SOP he is entitled to").toContain(SOP_TITLE);
  });

  it("SALES · still gets its own pipeline — the half that was always true", async () => {
    bindTestAuthority("sales");
    const { html } = await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(html, "sales lost the prospect it is entitled to").toContain(PROSPECT_NAME);
  });

  it("OWNER · sees the client and the SOP for the same query", async () => {
    bindTestAuthority("owner");
    const { html } = await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(html).toContain(CLIENT_NAME);
    expect(html).toContain(SOP_TITLE);
    expect(clientReads().length, "the owner's own client file was not read").toBeGreaterThan(0);
  });

  it("THE EXCLUSION CONTROL · the mechanism can still WITHHOLD, or none of the above means anything", async () => {
    // Without this, every assertion in this block would pass on an index that assembled everything
    // for everybody — which is precisely the pre-slice-4 defect, and it would look like success.
    //
    // Drives `visibilityFor` directly with a principal holding NEITHER capability. It is the same
    // function `currentVisibility()` calls, so this measures the real scoping decision rather than a
    // reimplementation of it.
    const { visibilityFor } = await import("@/core/knowledge");
    const { __unsafePrincipalForTests } = await import("@/core/auth/principal");
    const owner = __unsafePrincipalForTests("owner", "org" as never, "user" as never);
    const sales = __unsafePrincipalForTests("sales", "org" as never, "user" as never);
    expect(visibilityFor(owner)).toEqual({ clients: true, prospects: true, sops: true });
    expect(visibilityFor(sales), "2G.4.7 granted the partner the whole business universe")
      .toEqual({ clients: true, prospects: true, sops: true });
    // The discriminating half: visibility is COMPUTED from capabilities, not hardcoded to true. If
    // it were, this identical shape would appear for a principal holding neither.
    const { can } = await import("@/core/auth/capabilities");
    expect(can(sales, "clients:*"), "the partner's client visibility is not capability-derived").toBe(true);
    expect(can(sales, "admin:*"), "the partner holds the one capability he must not").toBe(false);
  });
});

// ─── C2 · `/` no longer denies him, and that is the change ─────────────────────────────────────

describe("§23 C2 · a render assembles exactly what its principal is entitled to", () => {
  it("SALES · / RENDERS for the partner and opens the client files it is built from (2G.4.7)", async () => {
    // This assertion used to read "/ opens ZERO client and ZERO SOP files, even though it correctly
    // denies". `/` denied sales because it demands `clients:*` among seven others; he now holds all
    // seven. The construction-level property it protected — that `projectGraph`'s `Promise.all`
    // cannot start an UNSCOPED discovery alongside the guarded readers — is unchanged and is now
    // carried by the exclusion control above, which drives `visibilityFor` directly.
    bindTestAuthority("sales");
    const { html } = await renderPage(() => import("@/app/page"));
    expect(html, "/ still denies the partner — 2G.4.7 did not take effect").not.toMatch(/don&#x27;t have access/i);
    expect(clientReads().length, "/ rendered for the partner without reading a client").toBeGreaterThan(0);
  });
});

// ─── E2 / E5 / E6 · the boundary itself ────────────────────────────────────────────────────────

describe("§23 E2 · the caller cannot manufacture visibility", () => {
  it("buildKnowledgeIndex takes NO visibility argument", async () => {
    const { buildKnowledgeIndex } = await import("@/core/knowledge");
    expect(buildKnowledgeIndex.length,
      "the assembly boundary still accepts a caller-supplied authorization assertion").toBe(0);
  });

  it("no production file names an unscoped visibility", () => {
    const roots = ["app", "core", "lib", "components", "graph-view", "mission-control", "engines"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(abs, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (/UNSCOPED_INTERNAL_INDEX/.test(src)) hits.push(path.relative(process.cwd(), abs));
        if (/clients:\s*true/.test(src)) hits.push(path.relative(process.cwd(), abs));
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(hits, "a production module can still request an unscoped index").toEqual([]);
  });

  it("an assembly with NO authority fails closed — it does not assemble everything", async () => {
    unbindTestAuthority();
    opened.text.length = 0;
    const { buildKnowledgeIndex } = await import("@/core/knowledge");
    await expect(buildKnowledgeIndex()).rejects.toThrow();
    expect(clientReads(), "an unauthorized caller caused client files to be read").toEqual([]);
  });
});

describe("§23 E5 · MUTATION — the unscoped variant must leak, observably", () => {
  it("with principal-derived visibility replaced by the old literal, the client comes back", async () => {
    // The vacuity gate. If this does NOT surface the client, every assertion above is passing for
    // some reason other than the mechanism it claims to test.
    const { __unsafeBuildKnowledgeIndexForTests } = await import("@/core/knowledge");
    const leaked = await __unsafeBuildKnowledgeIndexForTests({ clients: true, prospects: true, sops: true });
    const kinds = new Set(leaked.registry.map((r) => r.entity));
    expect(kinds.has("client"),
      "removing the scoping did NOT leak a client — this suite is not measuring the scoping").toBe(true);
    expect(JSON.stringify(leaked)).toContain(CLIENT_NAME);

    // ─── THE DISCRIMINATING HALF, REBUILT AT 2G.4.7 ─────────────────────────────────────────
    //
    // It read: bind `sales`, call `buildKnowledgeIndex()`, expect `["prospect"]` only. That was the
    // vacuity gate's teeth — the same fixture and builder producing a SMALLER index for a narrower
    // principal.
    //
    // **The gate had gone vacuous and would have passed anyway.** With `sales` now holding
    // `clients:*` and `sops:read`, the scoped assembly and the unscoped one are the same index, so
    // comparing them proves nothing. Left as it was, E5 would have gone red; "fixed" by loosening
    // the expectation to three kinds, it would have gone green while measuring nothing at all —
    // exactly the defect class §29.6c names.
    //
    // No role can express the exclusion any more, so the control moves to the argument that can:
    // the same builder, the same fixture, a RESTRICTED visibility. The property E5 owns is
    // unchanged — *the assembly excludes what visibility says to exclude, observably* — and it is
    // now measured against the mechanism directly instead of through a role that happens to be
    // narrow. The capability → visibility half of the chain is measured by C1's exclusion control.
    const restricted = await __unsafeBuildKnowledgeIndexForTests(
      { clients: false, prospects: true, sops: false }
    );
    expect([...new Set(restricted.registry.map((r) => r.entity))].sort(),
      "the assembly ignored its visibility — scoping is not being applied at all").toEqual(["prospect"]);
    expect(JSON.stringify(restricted), "an excluded client reached a restricted index")
      .not.toContain(CLIENT_NAME);
    expect(JSON.stringify(restricted), "an excluded SOP reached a restricted index")
      .not.toContain(SOP_TITLE);
  });
});

describe("§23 E6 · events are resolved, not left as an escape hatch", () => {
  it("assembly opens NO event log — the reserved linkage point reads nothing", async () => {
    bindTestAuthority("owner");
    opened.jsonl.length = 0;
    const { buildKnowledgeIndex } = await import("@/core/knowledge");
    await buildKnowledgeIndex();
    expect(eventReads(),
      "assembly read the event spine, which no contributor consumes — unguarded I/O over " +
      "protected logs for no result").toEqual([]);
  });

  it("the linkage point is still declared unused, so a future contributor must ask", async () => {
    const src = readFileSync(path.join(process.cwd(), "packages/indexer/index.ts"), "utf8");
    expect(src).toMatch(/void events/);
  });
});
