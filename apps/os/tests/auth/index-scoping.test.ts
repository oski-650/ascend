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

// ─── C1 · the live leak ────────────────────────────────────────────────────────────────────────

describe("§23 C1 · /console assembles only what the caller is entitled to", () => {
  it("SALES · no client or SOP file is EVER OPENED", async () => {
    bindTestAuthority("sales");
    await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(clientReads(), "a sales render opened client files").toEqual([]);
    expect(sopReads(), "a sales render opened SOP files").toEqual([]);
  });

  it("SALES · and therefore no client or SOP material reaches the markup", async () => {
    bindTestAuthority("sales");
    const { html } = await renderPage(() => import("@/app/console/page"), { q: TERM });
    expect(html, "A CLIENT LEAKED INTO A SALES CONSOLE").not.toContain(CLIENT_NAME);
    expect(html).not.toContain(CLIENT_BODY);
    expect(html, "an owner-only SOP reached a sales console").not.toContain(SOP_TITLE);
  });

  it("SALES · still gets its own pipeline — this is scoping, not denial", async () => {
    // The half that stops "fix it by returning nothing" from passing.
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
});

// ─── C2 · built, then hidden ───────────────────────────────────────────────────────────────────

describe("§23 C2 · a DENIED render assembles nothing it was denied", () => {
  it("SALES · / opens ZERO client and ZERO SOP files, even though it correctly denies", async () => {
    // The construction-level property. Slice 3 already hides the outcome; the point here is that
    // `projectGraph`'s Promise.all cannot start an unscoped discovery alongside the guarded readers.
    bindTestAuthority("sales");
    const { html } = await renderPage(() => import("@/app/page"));
    expect(html, "/ stopped denying a sales principal").toMatch(/don|access/i);
    expect(clientReads(), "a DENIED render still opened client files").toEqual([]);
    expect(sopReads(), "a DENIED render still opened SOP files").toEqual([]);
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

    // And the scoped sales assembly, same fixture, same builder: only prospects.
    bindTestAuthority("sales");
    const { buildKnowledgeIndex } = await import("@/core/knowledge");
    const scoped = await buildKnowledgeIndex();
    expect([...new Set(scoped.registry.map((r) => r.entity))].sort()).toEqual(["prospect"]);
    expect(JSON.stringify(scoped)).not.toContain(CLIENT_NAME);
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
