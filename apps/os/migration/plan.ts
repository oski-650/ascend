// migration/plan — THE DETERMINISTIC CLASSIFIER. Reads the vault; writes nothing, ever.
//
// docs/HISTORICAL-BACKFILL-H5.md §1–§3. Produces a Manifest describing every intended change, so a
// human can inspect exactly what the migration means to do before one byte of the vault changes.
//
// DETERMINISM IS A CONTRACT, not an aspiration: no clock, no randomness, no iteration over
// unsorted directory listings without re-sorting. Identical vault ⇒ byte-identical manifest.

import "server-only";
import path from "node:path";
import { crmDir, documentsDir, timeLogPath, invoiceLogPath, auditsLogPath } from "@/core/vault/paths";
import { listSubdirs, readJsonlFile } from "@/core/vault/io";
import { readMarkdownFile, listMarkdownFiles } from "@/core/vault/markdown";
import { PHASE_KEYS } from "@/domain";
import {
  declaredFor,
  isExcluded,
  isSeededId,
  isSyntheticDuration,
  isSyntheticTimestamp,
} from "./evidence";
import { buildManifest, type Manifest, type ManifestEntry } from "./manifest";
import { rulesFor } from "./registry";

const SCAFFOLD = "scripts/scaffold-vault.mjs (script literal)";

/** Every entry is built through here, so no call site can omit a required column. */
function entry(e: Omit<ManifestEntry, "businessEvent">): ManifestEntry {
  return { ...e, businessEvent: "none" };
}

// ─── Projects: seeded phase state → unknown ────────────────────────────────────────────────────

async function planProjects(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const slugs = (await listSubdirs(crmDir())).sort();

  for (const slug of slugs) {
    if (isExcluded(slug)) continue;
    const declared = declaredFor(slug);
    if (!declared) continue;

    const md = await readMarkdownFile(path.join(crmDir(), slug, "production_state.md"));
    if (md.missing) continue;
    const fm = md.frontmatter as {
      launch_target?: unknown;
      industry_template?: unknown;
      phases?: Record<string, { status?: unknown }>;
    };

    for (const phase of PHASE_KEYS) {
      const current = fm.phases?.[phase]?.status;
      const currentStr = typeof current === "string" ? current : null;
      if (currentStr === "unknown") continue; // already migrated — idempotence

      // Elite Vac's launch is genuinely evidenced; only its PRE-launch phases are unknown. A
      // project whose history was authored wholesale demotes every phase.
      const seeded = declared.phaseHistorySeeded;
      const evidencedLaunch = !seeded && phase === "launch" && currentStr === "complete";
      if (evidencedLaunch) continue;
      if (!seeded && currentStr === null) continue; // absent already reads as unknown (H4)

      out.push(
        entry({
          entity: { kind: "project", id: slug },
          field: `phase.${phase}.status`,
          currentValue: currentStr,
          proposedValue: "unknown",
          classification: seeded ? "seeded" : "derived",
          disposition: "unknown",
          evidence: seeded
            ? `${SCAFFOLD} — ${declared.note}`
            : `no evidence establishes this phase; ${currentStr ?? "absent"} was the closest available enum`,
          confidence: seeded ? "certain" : "high",
          baseline: "required",
        })
      );
    }

    // ── phase dates ───────────────────────────────────────────────────────────────────────────
    // A seeded phase's `started`/`completed` are fabricated days and go with it. An EVIDENCED date
    // gains precision and source instead of being removed: Elite Vac's launch is known to the month
    // from a portfolio entry, and `2022-03-01` asserts a specific day nobody knows (H3.1 §3.2).
    const phaseTable = (fm.phases ?? {}) as Record<string, Record<string, unknown> | undefined>;
    for (const phase of PHASE_KEYS) {
      const meta = phaseTable[phase];
      if (!meta) continue;
      for (const key of ["started", "completed"] as const) {
        const raw = meta[key];
        if (typeof raw !== "string" || raw.trim() === "") continue;
        const seeded = declared.phaseHistorySeeded;
        if (seeded) {
          out.push(
            entry({
              entity: { kind: "project", id: slug },
              field: `phase.${phase}.${key}`,
              currentValue: raw,
              proposedValue: null,
              classification: "seeded",
              disposition: "removed",
              evidence: `${SCAFFOLD} — a fabricated day, removed with the phase it dated`,
              confidence: "certain",
              baseline: "required",
            })
          );
        } else if (meta[`${key}_precision`] === undefined) {
          // Evidenced but unqualified: keep the value, state what is actually known about it.
          out.push(
            entry({
              entity: { kind: "project", id: slug },
              field: `phase.${phase}.${key}_precision`,
              currentValue: null,
              proposedValue: "month",
              classification: "derived",
              disposition: "known",
              evidence: `${raw} is known to the month from a portfolio entry; the day is not evidenced`,
              confidence: "medium",
              baseline: "required",
            })
          );
        }
      }
    }

    // ── industry template ─────────────────────────────────────────────────────────────────────
    // A template CHOICE. Seeded for the scaffolded clients; `generic` was intake's default rather
    // than a decision. Removing it leaves the SOP engine reporting hasTemplate:false — honest.
    const template = typeof fm.industry_template === "string" ? fm.industry_template : null;
    if (template && (declared.phaseHistorySeeded || template === "generic")) {
      out.push(
        entry({
          entity: { kind: "project", id: slug },
          field: "industry_template",
          currentValue: template,
          proposedValue: null,
          classification: declared.phaseHistorySeeded ? "seeded" : "derived",
          disposition: "removed",
          evidence: declared.phaseHistorySeeded
            ? `${SCAFFOLD} — the template was chosen by the script`
            : `"generic" was a default, not a choice the operator made`,
          confidence: declared.phaseHistorySeeded ? "certain" : "high",
          baseline: "required",
        })
      );
    }

    // A seeded launch target is a fabricated date. It demotes exactly like a phase — a date is not
    // more objective for being well-formed (H5 §3).
    const target = typeof fm.launch_target === "string" ? fm.launch_target : null;
    if (declared.launchTargetSeeded && target !== null && target !== "") {
      out.push(
        entry({
          entity: { kind: "project", id: slug },
          field: "launch_target",
          currentValue: target,
          proposedValue: "",
          classification: "seeded",
          disposition: "unknown",
          evidence: `${SCAFFOLD} — the target was authored, not agreed with the client`,
          confidence: "certain",
          baseline: "required",
        })
      );
    }
  }
  return out;
}

// ─── Retired duplicates: project_scope.md loses its state-bearing keys ─────────────────────────
//
// SOURCE-AUTHORITY §4.5. These four fields asserted facts owned elsewhere, and two of them drove
// behaviour while being observed by nothing. Step 5 repointed every consumer; this removes the
// fields themselves.
//
// SAFE BECAUSE OF A1, NOT BECAUSE IT LOOKS TIDY: `tests/engines/authority-repair.test.ts` proves
// that changing these fields alone produces no behavioural change and no event. A field with no
// behavioural effect can be removed without a behavioural migration. `revenue_usd`, `deliverables`
// and the prose stay — only the duplicated state goes.

async function planRetiredScopeFields(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const retired = rulesFor("project_scope").filter((r) => r.treatment === "retire");
  const slugs = (await listSubdirs(crmDir())).sort();

  for (const slug of slugs) {
    if (isExcluded(slug)) continue;
    const md = await readMarkdownFile(path.join(crmDir(), slug, "project_scope.md"));
    if (md.missing) continue;

    for (const rule of retired) {
      const raw = (md.frontmatter as Record<string, unknown>)[rule.field];
      if (raw === undefined) continue; // already retired — idempotence
      out.push(
        entry({
          entity: { kind: "client", id: slug },
          field: `project_scope.${rule.field}`,
          currentValue: String(raw),
          proposedValue: null,
          classification: "seeded",
          disposition: "removed",
          evidence: `retired duplicate — ${rule.note}`,
          confidence: "certain",
          // project_scope.md is not observed by the reconciler, so removing a key from it cannot
          // produce a transition. The baseline is taken anyway: it costs one event and keeps the
          // guarantee from depending on which files happen to be observed today.
          baseline: "required",
        })
      );
    }

    // A contract value is the one commercial field that records an agreement rather than a catalog
    // lookup — but it is NOT rescued by its name. A scaffold-authored value is as fictional as a
    // scaffold-authored package, so it is classified like anything else. Absent everywhere today.
    const revenue = (md.frontmatter as Record<string, unknown>).revenue_usd;
    if (revenue !== undefined && String(revenue).trim() !== "" && declaredFor(slug)?.phaseHistorySeeded) {
      out.push(
        entry({
          entity: { kind: "client", id: slug },
          field: "project_scope.revenue_usd",
          currentValue: String(revenue),
          proposedValue: null,
          classification: "seeded",
          disposition: "unknown",
          evidence: `${SCAFFOLD} — a recorded-looking contract value on a scaffold-authored client; the field name is not evidence`,
          confidence: "high",
          baseline: "required",
        })
      );
    }
  }
  return out;
}

// ─── Clients: canonical domain corrections ─────────────────────────────────────────────────────

async function planClients(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const slugs = (await listSubdirs(crmDir())).sort();

  for (const slug of slugs) {
    if (isExcluded(slug)) continue;
    const declared = declaredFor(slug);
    if (!declared?.canonicalDomain) continue;

    const md = await readMarkdownFile(path.join(crmDir(), slug, "business_context.md"));
    if (md.missing) continue;
    const current = md.frontmatter.website;
    const currentStr = typeof current === "string" ? current : null;
    if (currentStr === declared.canonicalDomain) continue;

    out.push(
      entry({
        entity: { kind: "client", id: slug },
        field: "website",
        currentValue: currentStr,
        proposedValue: declared.canonicalDomain,
        classification: "confirmed",
        disposition: "known",
        evidence: "H0 inventory — canonical domain confirmed by the operator",
        confidence: "certain",
        // `website` is not part of the client's observed state, so no client.status_changed can
        // arise from it. The baseline is taken anyway: cheap, and it keeps §4.2's guarantee from
        // depending on which fields happen to be observed today.
        baseline: "required",
      })
    );
  }
  return out;
}

// ─── Documents: synthetic and seeded records are removed ───────────────────────────────────────

async function planDocuments(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const clients = (await listSubdirs(documentsDir())).sort();

  for (const client of clients) {
    if (isExcluded(client)) continue;
    const kinds = (await listSubdirs(path.join(documentsDir(), client))).sort();
    for (const kind of kinds) {
      const files = (await listMarkdownFiles(path.join(documentsDir(), client, kind))).sort();
      for (const file of files) {
        const md = await readMarkdownFile(path.join(documentsDir(), client, kind, file));
        if (md.missing) continue;
        const id = typeof md.frontmatter.doc_id === "string" ? md.frontmatter.doc_id : null;
        if (!id) continue;

        const created = typeof md.frontmatter.created_at === "string" ? md.frontmatter.created_at : undefined;
        const synthetic = isSyntheticTimestamp(created);

        if (isSeededId(id)) {
          out.push(
            entry({
              entity: { kind: "document", id },
              field: "*",
              currentValue: `${client}/${kind}/${file}`,
              proposedValue: null,
              classification: "seeded",
              disposition: "removed",
              evidence: `${SCAFFOLD} — fabricated document record`,
              confidence: "certain",
              baseline: "required",
            })
          );
        } else if (synthetic.hit) {
          out.push(
            entry({
              entity: { kind: "document", id },
              field: "*",
              currentValue: `${client}/${kind}/${file}`,
              proposedValue: null,
              classification: "synthetic",
              disposition: "removed",
              // Removed, NOT demoted to unknown: there is no underlying fact to be uncertain about.
              evidence: `created ${created} — inside a known test session (${synthetic.note})`,
              confidence: "high",
              baseline: "required",
            })
          );
        }
      }
    }
  }
  return out;
}

// ─── Sidecar records: seeded and synthetic rows are removed ────────────────────────────────────

type TimeEntryRow = { id?: string; client?: string; duration_seconds?: number; started?: string };
type InvoiceRow = { id?: string; client?: string; amount_usd?: number; label?: string };
type AuditRow = { id?: string; url?: string; client?: string };

async function planSidecars(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];

  const times = await readJsonlFile<TimeEntryRow>(timeLogPath());
  for (const t of times) {
    if (!t.id || (t.client && isExcluded(t.client))) continue;
    const seeded = isSeededId(t.id);
    const shortRun = isSyntheticDuration(t.duration_seconds);
    const inSession = isSyntheticTimestamp(t.started);
    if (!seeded && !shortRun) continue;

    out.push(
      entry({
        entity: { kind: "project", id: t.client ?? "unknown" },
        field: `time_entry.${t.id}`,
        currentValue: `${t.duration_seconds ?? "?"}s`,
        proposedValue: null,
        classification: seeded ? "seeded" : "synthetic",
        disposition: "removed",
        evidence: seeded
          ? `${SCAFFOLD} — "realistic historical entries" authored by the script`
          : `duration ${t.duration_seconds}s is below the ${5}s floor for real work` +
            (inSession.hit ? `; inside a known test session (${inSession.note})` : ""),
        confidence: seeded ? "certain" : "high",
        // Time entries are not observed by the reconciler, so removing them cannot emit anything.
        baseline: "not-required",
      })
    );
  }

  const invoices = await readJsonlFile<InvoiceRow>(invoiceLogPath());
  for (const inv of invoices) {
    if (!inv.id || !isSeededId(inv.id)) continue;
    if (inv.client && isExcluded(inv.client)) continue;
    out.push(
      entry({
        entity: { kind: "project", id: inv.client ?? "unknown" },
        field: `invoice.${inv.id}`,
        currentValue: `$${inv.amount_usd ?? "?"} ${inv.label ?? ""}`.trim(),
        proposedValue: null,
        classification: "seeded",
        disposition: "removed",
        evidence: `${SCAFFOLD} — fabricated financial record; it misstates revenue and has fired an automation`,
        confidence: "certain",
        baseline: "not-required",
      })
    );
  }

  const audits = await readJsonlFile<AuditRow>(auditsLogPath());
  for (const a of audits) {
    if (!a.id || !isSeededId(a.id)) continue;
    out.push(
      entry({
        entity: { kind: "project", id: a.client ?? a.url ?? "unknown" },
        field: `audit.${a.id}`,
        currentValue: a.url ?? "",
        proposedValue: null,
        classification: "seeded",
        disposition: "removed",
        evidence: `${SCAFFOLD} — fabricated PSI result`,
        confidence: "certain",
        baseline: "not-required",
      })
    );
  }

  return out;
}

/**
 * Build the migration plan. DRY RUN — this function performs no writes and has no write path.
 *
 * Applying requires `migration/apply`, which takes a Manifest as input: there is no code path in
 * which planning and mutating happen in the same pass.
 */
export async function planMigration(): Promise<Manifest> {
  const [projects, retired, clients, documents, sidecars] = await Promise.all([
    planProjects(),
    planRetiredScopeFields(),
    planClients(),
    planDocuments(),
    planSidecars(),
  ]);
  return buildManifest([...projects, ...retired, ...clients, ...documents, ...sidecars]);
}