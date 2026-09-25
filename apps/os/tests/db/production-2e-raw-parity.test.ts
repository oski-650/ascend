// Layer A — historical migration witness and bounded live-column drift.
//
// ─── WHY THIS EXISTS WHEN THE MIGRATION ALREADY VERIFIED ITSELF ────────────────────────────────
//
// The migration's decisive check compares `buildLedger(vault)` with `buildLedger(db)`. Both sides
// go through the SAME function, so any value the ledger flattens is invisible to it — and the
// ledger has been wrong before: its first version omitted `body`, reported parity, and was silently
// dropping the operator's call logs.
//
// This file shares no transformation with either side. It reads the markdown with `gray-matter` and
// the rows with SQL, then compares values under an EXPLICIT, DECLARED mapping. The frozen vault
// witnesses Stage 2E, while four reviewed difference locations mark subsequent live drift.
//
// ─── THE MAPPING IS THE ARGUMENT ───────────────────────────────────────────────────────────────
//
// A comparison between YAML and SQL cannot be byte-for-byte; the two type systems differ. What it
// can be is a mapping stated in advance, applied to ONE side only, and total — every field named,
// every equivalence justified, nothing normalised "just to make it match". Current production
// changes at the four reviewed locations are reported as drift, not certified as correct:
//
//   YAML absent           → SQL NULL          a key nobody wrote is not a value
//   YAML ""               → SQL ''            EMPTY STRING SURVIVES. Stage 2B lost this twice.
//   YAML true/false       → SQL boolean       the only lossless representation of a YAML bool
//   YAML "2026-06-10"     → SQL date          compared as ::text so no timezone is ever applied
//   YAML scalar           → SQL text          compared as written, including case and punctuation
//   markdown body         → prospects.notes   VERBATIM apart from the reader's boundary trim
//
// ONE DOCUMENTED EXCEPTION, and it is narrow: `first_contact` and `last_contact` are `date`
// columns, and Postgres cannot store `""` in one. `EMPTY_EQUALS_ABSENT` records that decision, and
// Stage 2B justified it by tracing all three consumers — `daysSince()`, `fmtScalar()` and the
// FactRow renderer all treat `""` and absent identically. Every OTHER field keeps `""` verbatim.
//
// The exception is asserted to be EXACTLY those two fields, so it cannot quietly grow.

import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Pool, type PoolClient } from "pg";
import { connectionConfigFor } from "@/core/db";
import { EMPTY_EQUALS_ABSENT, LEDGER_FIELDS } from "@/substrate-migration";

const DIRECT = process.env.ASCEND_DATABASE_URL_DIRECT;
const VAULT = process.env.ASCEND_VAULT_PATH;
const describeIfDb = DIRECT && VAULT ? describe : describe.skip;

/** Columns Postgres must hand back as text so no client-side type coercion can alter them. */
const DATE_FIELDS = ["first_contact", "last_contact"] as const;
const BOOL_FIELDS = ["decision_maker_access", "niche_alignment"] as const;

type VaultRecord = { slug: string; frontmatter: Record<string, unknown>; body: string };
type DbRecord = Record<string, string | boolean | null>;

// DB-PROOF-001 established these four *locations*, not that either current or frozen value is
// automatically correct. No current production value is encoded here. A fifth difference fails.
const OBSERVED_DRIFT = [
  "bay-area-custom-shirts-inc.website",
  "bay-area-custom-shirts-inc.website_quality",
  "tapia-tile-amp-marble-co.name",
  "tile-amp-marble-installation-in-bay-area.name",
].sort();

function unexpectedDrift(actual: readonly string[], reviewed: readonly string[]): string[] {
  return actual.filter((key) => !reviewed.includes(key)).sort();
}

function differsFromVault(v: VaultRecord, row: DbRecord, field: string): boolean {
  const present = Object.prototype.hasOwnProperty.call(v.frontmatter, field);
  const vaultValue = present ? v.frontmatter[field] : undefined;
  let expected: string | boolean | null;
  if (!present || vaultValue === null) {
    expected = null;
  } else if ((BOOL_FIELDS as readonly string[]).includes(field)) {
    expected = typeof vaultValue === "boolean" ? vaultValue : String(vaultValue) === "true";
  } else if ((DATE_FIELDS as readonly string[]).includes(field)) {
    const asWritten = vaultValue instanceof Date ? vaultValue.toISOString().slice(0, 10) : String(vaultValue);
    expected = asWritten === "" ? null : asWritten;
  } else {
    expected = String(vaultValue);
  }
  return row[field] !== expected;
}

describeIfDb("2E RAW PARITY — vault bytes vs production columns", () => {
  let vault: VaultRecord[];
  let db: Map<string, DbRecord>;

  beforeAll(async () => {
    // Same file-selection rule the vault reader uses (skip `_`-prefixed and README); the
    // independence that matters is in how values are EXTRACTED and COMPARED, not in which files.
    const dir = path.join(VAULT!, "02 - Sales & Hit List");
    vault = readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "README.md")
      .sort()
      .map((f) => {
        const m = matter(readFileSync(path.join(dir, f), "utf8"));
        return { slug: f.replace(/\.md$/, ""), frontmatter: m.data as Record<string, unknown>, body: m.content };
      });

    const pool = new Pool({ ...connectionConfigFor(DIRECT!, "migration"), max: 1 });
    const c: PoolClient = await pool.connect();
    try {
      // Dates cast to text IN SQL. The driver otherwise returns a JS Date at local midnight, which
      // renders as the PREVIOUS day anywhere ahead of UTC — the corruption this project already hit.
      const { rows } = await c.query<DbRecord>(
        `SELECT slug, prospect_id::text, identity_state, hold_reason, name, business_type, location,
                website, contact_name, contact_phone, contact_email, source, status, website_quality,
                decision_maker_access, project_urgency, niche_alignment,
                first_contact::text AS first_contact, last_contact::text AS last_contact, notes
         FROM prospects WHERE slug = ANY($1)`,
        [vault.map((v) => v.slug)]
      );
      db = new Map(rows.map((r) => [String(r.slug), r]));
    } finally { c.release(); await pool.end(); }
  }, 120_000);

  it("the historical six migration records still exist in live Postgres, keyed by slug", () => {
    // SCOPED to the vault's own slugs. Sibling suites commit their own fixtures to production while
    // this runs, and vitest executes files in parallel — an unscoped comparison measures the
    // scheduler. The claim being tested is "every vault record is present and matches", which the
    // scoping preserves exactly.
    expect(vault.map((v) => v.slug).sort()).toEqual([...db.keys()].sort());
    expect(vault).toHaveLength(6);
    expect(db.size).toBe(6);
    const historical = JSON.parse(readFileSync(path.join(process.cwd(), "docs/stage2e/post-migration-state.json"), "utf8")) as {
      rows: { prospects: string }; prospectIdentities: { slug: string }[];
    };
    expect(historical.rows.prospects).toBe("6");
    expect(vault.map((v) => v.slug).sort())
      .toEqual(historical.prospectIdentities.map((p) => p.slug).sort());
  });

  it("the documented empty-string exception covers EXACTLY the two date fields", () => {
    // Pinned so the exception cannot quietly grow to cover a field where "" is meaningful.
    expect([...EMPTY_EQUALS_ABSENT].sort()).toEqual(["first_contact", "last_contact"]);
  });

  it("every frontmatter field outside the four observed drift locations matches the frozen vault", () => {
    const diffs: string[] = [];

    for (const v of vault) {
      const row = db.get(v.slug)!;
      for (const field of LEDGER_FIELDS) {
        // The mapping applies to the VAULT side only; an unreviewed SQL value fails.
        if (differsFromVault(v, row, field)) {
          diffs.push(`${v.slug}.${field}`);
        }
      }
    }
    expect(unexpectedDrift(diffs, OBSERVED_DRIFT)).toEqual([]);
    // Keep the review boundary visible; a changed location is not silently normalized.
    expect(OBSERVED_DRIFT).toHaveLength(4);
  });

  it("adversarial field control: an unreviewed mutation cannot be waived", () => {
    const v = vault.find((record) => record.slug === "bay-area-custom-shirts-inc")!;
    const row = db.get(v.slug)!;
    const field = "contact_email";
    const mutation = `${v.slug}.${field}`;
    const mutated = { ...row, [field]: "__adversarial_field_regression__" };
    expect(differsFromVault(v, mutated, field)).toBe(true);
    expect(unexpectedDrift([mutation], OBSERVED_DRIFT)).toEqual([mutation]);
  });

  it("EMPTY STRINGS are actually present — the check above is not vacuous", () => {
    // If no prospect had an empty-string field, the assertion that "" survives would prove nothing.
    // This is the failure Stage 2B shipped twice, so the guard against a vacuous test is warranted.
    const empties: string[] = [];
    for (const v of vault) {
      const row = db.get(v.slug)!;
      for (const field of LEDGER_FIELDS) {
        if (v.frontmatter[field] === "" && !(DATE_FIELDS as readonly string[]).includes(field)) {
          empties.push(`${v.slug}.${field}`);
          expect(row[field], `${v.slug}.${field} collapsed "" to NULL`).toBe("");
        }
      }
    }
    expect(empties.length, "no empty-string fields exist; this check proves nothing").toBeGreaterThan(0);
    console.info(`      empty strings preserved: ${empties.length} — ${empties.slice(0, 4).join(", ")}…`);
  });

  it("NULL stays NULL — an absent key never becomes an empty string", () => {
    let absent = 0;
    for (const v of vault) {
      const row = db.get(v.slug)!;
      for (const field of LEDGER_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(v.frontmatter, field)) {
          absent++;
          expect(row[field], `${v.slug}.${field} invented a value for an absent key`).toBeNull();
        }
      }
    }
    // REPORTED, NOT REQUIRED. All six prospects carry every one of the 15 fields, so absence never
    // occurs in this dataset and this property is UNTESTED here rather than proven. Saying so is
    // better than a vacuous pass — and better than deleting the check, which would stop covering
    // the case the moment an incomplete record arrives from the Sheet.
    console.info(
      absent === 0
        ? "      absent keys: NONE in this dataset — property not exercised (all 15 fields present on all 6)"
        : `      absent keys preserved as NULL: ${absent}`
    );
  });

  it("DATES are identical as written — no timezone was applied to a value that has none", () => {
    let compared = 0;
    for (const v of vault) {
      const row = db.get(v.slug)!;
      for (const field of DATE_FIELDS) {
        const val = v.frontmatter[field];
        if (val === undefined || val === null || val === "") continue;
        const asWritten = val instanceof Date ? val.toISOString().slice(0, 10) : String(val);
        expect(row[field], `${v.slug}.${field} shifted`).toBe(asWritten);
        expect(String(row[field])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        compared++;
      }
    }
    expect(compared, "no dates present; this check proves nothing").toBeGreaterThan(0);
    console.info(`      dates compared as written: ${compared}`);
  });

  it("BODY survives into notes — every interior byte identical", () => {
    // The regression that made the first parity ledger a lie. These are the operator's call logs,
    // objections and pitch angles: the least reconstructible content in the system.
    //
    // MEASURED DIFFERENCE, stated exactly: `gray-matter` hands back the body with the blank line
    // that follows the frontmatter and the file's trailing newline still attached; the vault reader
    // trims both. Production stores what the READER produces, so it differs from the raw file by
    // one or two whitespace characters AT THE BOUNDARIES and by nothing else.
    //
    // That trim is pre-existing and belongs to the reader, not to this migration — every consumer
    // in the system has always seen the trimmed body. What matters, and what is asserted here, is
    // that no INTERIOR byte moved: no truncation, no re-encoding, no lost line.
    for (const v of vault) {
      const row = db.get(v.slug)!;
      expect(String(row.notes).trim(), `${v.slug}: body content differs`).toBe(v.body.trim());
      // And the only permitted difference really is whitespace at the edges.
      expect(row.notes, `${v.slug}: notes differ from the raw body by more than a boundary trim`)
        .toBe(v.body.trim());
    }
    const bytes = vault.reduce((n, v) => n + v.body.trim().length, 0);
    expect(bytes).toBeGreaterThan(4000);
    console.info(`      body content preserved: ${bytes} bytes across ${vault.length} prospects`);
  });

  it("BODY matches what the VAULT READER produces, exactly — that is what consumers see", async () => {
    // The stronger statement, against the system's own definition of "the body" rather than against
    // raw file bytes. If these ever diverge, a consumer reading Postgres would see different text
    // from one reading the vault — which is precisely the split-brain the flip must not create.
    const { readMarkdownFile } = await import("@/core/vault/markdown");
    const dir = path.join(VAULT!, "02 - Sales & Hit List");
    for (const v of vault) {
      const readerBody = (await readMarkdownFile(path.join(dir, `${v.slug}.md`))).body;
      expect(db.get(v.slug)!.notes, `${v.slug}: differs from the vault reader's body`).toBe(readerBody);
    }
  });

  it("IDENTITY fields match the vault's own answer, not a re-derived one", () => {
    for (const v of vault) {
      const row = db.get(v.slug)!;
      const vaultId = (v.frontmatter.prospect_id as string | undefined) ?? null;
      expect(row.prospect_id, `${v.slug}: prospect_id differs`).toBe(vaultId);
      expect(row.identity_state).toBe(vaultId === null ? "held" : "anchored");
      if (vaultId === null) expect(row.hold_reason, `${v.slug}: held without a reason`).toBeTruthy();
      else expect(row.hold_reason).toBeNull();
    }
  });
});
