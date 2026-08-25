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
  const [projects, clients, documents, sidecars] = await Promise.all([
    planProjects(),
    planClients(),
    planDocuments(),
    planSidecars(),
  ]);
  return buildManifest([...projects, ...clients, ...documents, ...sidecars]);
}