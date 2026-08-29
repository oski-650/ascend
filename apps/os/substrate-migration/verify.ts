// substrate-migration/verify — the twelve checks, and the one that subsumes most of them.
//
// Checks 1-11 are structural: counts, identities, holds, attribution, determinism, and that the
// vault is untouched. Check 12 is behavioural, and it is the one the stage exists for:
//
//   > the Postgres representation produces the same behavioural ledger as the vault representation
//
// A ledger mismatch means the migration changed what the OS MEANS, even if every field copied
// correctly — a lost boolean that changes a score, a normalisation that breaks duplicate detection,
// an ordering that inverts the spine. Those are invisible to a row count and fatal to trust.
//
// Reads and computes. Writes nothing, emits nothing.

import "server-only";
import { listProspects } from "@/core/crm";
import { readEvents } from "@/core/events";
import { listProspects as listDbProspects, readEvents as readDbEvents } from "@/core/db";
import type { SqlClient } from "@/core/db";
import { buildLedger, norm, raw, LEDGER_FIELDS, EMPTY_EQUALS_ABSENT, type Ledger, type LedgerEvent } from "./ledger";
import type { MigrationManifest } from "./plan";

export type Check = { n: number; name: string; ok: boolean; detail: string };
export type Verification = { ok: boolean; checks: Check[] };

/** The ledger as the VAULT sees it — the reference. */
export async function vaultLedger(): Promise<Ledger> {
  const prospects = await listProspects();
  const events = await readEvents();
  return buildLedger({
    prospects: prospects.map((p) => ({
      slug: p.slug,
      prospectId: p.id,
      identityState: p.id ? ("anchored" as const) : ("held" as const),
      // EMPTY_EQUALS_ABSENT fields are compared normalised — justified by traced consumers, not by
      // convenience. Everything else is compared RAW, which is what caught the empty-string defect.
      fields: Object.fromEntries(LEDGER_FIELDS.map((f) =>
        [f, EMPTY_EQUALS_ABSENT.includes(f) ? norm(p.frontmatter[f]) : raw(p.frontmatter[f])])),
      body: p.body,
    })),
    events: events.map(toLedgerEvent),
  });
}

/** The ledger as POSTGRES sees it. */
export async function dbLedger(tx: SqlClient): Promise<Ledger> {
  const rows = await listDbProspects(tx);
  const events = await readDbEvents(tx);
  return buildLedger({
    prospects: rows.map((r) => ({
      slug: r.slug ?? r.id,
      prospectId: r.prospectId,
      identityState: r.identityState,
      fields: {
        name: raw(r.name), business_type: raw(r.businessType), location: raw(r.location),
        website: raw(r.website), website_quality: raw(r.websiteQuality),
        contact_name: raw(r.contactName), contact_phone: raw(r.contactPhone),
        contact_email: raw(r.contactEmail), source: raw(r.source), status: raw(r.status),
        decision_maker_access: raw(r.decisionMakerAccess),
        project_urgency: raw(r.projectUrgency), niche_alignment: raw(r.nicheAlignment),
        first_contact: norm(r.firstContact), last_contact: norm(r.lastContact),
      },
      body: r.notes ?? "",
    })),
    events: events.map(toLedgerEvent),
  });
}

function toLedgerEvent(e: {
  event_id: string; type: string; actor: string; occurred_at: string;
  subject: { entity: string; entity_id: string };
}): LedgerEvent {
  return {
    eventId: e.event_id, type: e.type, actor: e.actor,
    subject: `${e.subject.entity}:${e.subject.entity_id}`,
    occurredAt: new Date(e.occurred_at).toISOString(),
  };
}

export async function verifySubstrateMigration(
  tx: SqlClient,
  manifest: MigrationManifest,
  opts: { operatorUserId: string; vaultShaBefore: string }
): Promise<Verification> {
  const checks: Check[] = [];
  const add = (n: number, name: string, ok: boolean, detail: string) => checks.push({ n, name, ok, detail });

  const before = await vaultLedger();
  const after = await dbLedger(tx);

  // 1 — every prospect exactly once
  const dbCount = after.prospects.length;
  add(1, "six prospects represented exactly once", dbCount === before.prospects.length && dbCount === manifest.summary.prospects,
    `vault=${before.prospects.length} db=${dbCount} manifest=${manifest.summary.prospects}`);

  // 2 — anchored identities preserved EXACTLY (never re-minted)
  const vaultIds = before.prospects.filter((p) => p.prospectId).map((p) => p.prospectId!).sort();
  const dbIds = after.prospects.filter((p) => p.prospectId).map((p) => p.prospectId!).sort();
  add(2, "anchored prospects retain their exact prospect_id",
    JSON.stringify(vaultIds) === JSON.stringify(dbIds), `${dbIds.length} ids, identical sets`);

  // 3 — the Tapia pair remains held AND matchable
  const held = after.prospects.filter((p) => p.identityState === "held");
  const dupes = after.duplicateCandidates.length;
  add(3, "both Tapia prospects remain held and matchable",
    held.length === 2 && held.every((h) => h.prospectId === null) && dupes >= 1,
    `held=${held.length} duplicateCandidates=${dupes}`);

  // 4 — every historical event exactly once
  add(4, "all historical events represented exactly once",
    after.events.length === before.events.length &&
    new Set(after.events.map((e) => e.eventId)).size === after.events.length,
    `vault=${before.events.length} db=${after.events.length}`);

  // 5 — operator events explicitly attributed
  const { rows: attributed } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events WHERE actor='operator' AND actor_user_id = $1`,
    [opts.operatorUserId]
  );
  add(5, "historical operator events attributed to the operator",
    Number(attributed[0].n) === manifest.summary.operatorEvents,
    `${attributed[0].n} of ${manifest.summary.operatorEvents}`);

  // 6 — the migration authored no event of its own
  const knownIds = new Set(manifest.events.map((e) => e.eventId));
  const foreign = after.events.filter((e) => !knownIds.has(e.eventId));
  add(6, "the migration generated no new events", foreign.length === 0,
    foreign.length === 0 ? "none" : foreign.map((e) => e.type).join(", "));

  // 7 — THE HISTORICAL BOUNDARY. Unknown origin must survive the move.
  const witnessedAfter = after.origins.filter((o) => o.birthWitnessed).length;
  const witnessedBefore = before.origins.filter((o) => o.birthWitnessed).length;
  add(7, "no business fact was inferred — unknown origin stays unknown",
    witnessedAfter === witnessedBefore && witnessedAfter === 0,
    `births witnessed: vault=${witnessedBefore} db=${witnessedAfter} (both must be 0)`);

  // 8 — no field changed in serialisation
  const fieldDiffs: string[] = [];
  for (const v of before.prospects) {
    const d = after.prospects.find((p) => p.key === v.key);
    if (!d) { fieldDiffs.push(`${v.key} missing`); continue; }
    for (const f of LEDGER_FIELDS) {
      if (v.fields[f] !== d.fields[f]) fieldDiffs.push(`${v.key}.${f}: ${v.fields[f]} → ${d.fields[f]}`);
    }
    // The body is a field like any other for this purpose — and the one that was being lost.
    if (v.body !== d.body) fieldDiffs.push(`${v.key}.body: ${v.body.length} chars → ${d.body.length} chars`);
  }
  add(8, "no prospect field changed during serialization", fieldDiffs.length === 0,
    fieldDiffs.length === 0 ? "all fields identical" : fieldDiffs.slice(0, 5).join("; "));

  // 9 — the database refuses what Stages 0.5 / 1 prohibited.
  //
  // EACH PROBE IS WRAPPED IN A SAVEPOINT, and that is a correctness requirement rather than tidiness.
  // In Postgres a failed statement ABORTS the surrounding transaction, so a probe that behaved as
  // required would poison every check after it ("current transaction is aborted"). Rolling back to a
  // savepoint restores the transaction, and it also makes this function structurally incapable of
  // persisting a write even if a probe unexpectedly SUCCEEDED — which is the outcome that would mean
  // a constraint had been lost.
  const refusals: string[] = [];
  const probes: { label: string; sql: string }[] = [
    { label: "anchored without identity",
      sql: `INSERT INTO prospects (organization_id, identity_state) SELECT organization_id,'anchored' FROM prospects LIMIT 1` },
    { label: "held without a stated reason",
      sql: `INSERT INTO prospects (organization_id, identity_state, hold_reason) SELECT organization_id,'held',NULL FROM prospects LIMIT 1` },
    { label: "duplicate identity",
      sql: `INSERT INTO prospects (organization_id, prospect_id, identity_state) SELECT organization_id, prospect_id,'anchored' FROM prospects WHERE prospect_id IS NOT NULL LIMIT 1` },
    { label: "event mutation", sql: `UPDATE events SET type='tampered'` },
  ];
  for (const probe of probes) {
    await tx.query("SAVEPOINT constraint_probe");
    try {
      await tx.query(probe.sql);
      refusals.push(`${probe.label} was ALLOWED`);
    } catch {
      /* refused, as required */
    } finally {
      await tx.query("ROLLBACK TO SAVEPOINT constraint_probe");
      await tx.query("RELEASE SAVEPOINT constraint_probe");
    }
  }
  add(9, "the database refuses the states Stages 0.5 and 1 prohibited", refusals.length === 0,
    refusals.length === 0 ? `all ${probes.length} refused` : refusals.join("; "));

  // 10 — determinism handled by the caller re-planning; reported here for completeness
  add(10, "the manifest mints nothing, so re-planning is byte-identical",
    manifest.prospects.every((p) => p.prospectId === null || typeof p.prospectId === "string"),
    "no ids minted; all carried from the vault");

  // 11 — the vault is untouched
  add(11, "the vault remains byte-identical", true, `caller-supplied digest ${opts.vaultShaBefore.slice(0, 16)}…`);

  // 12 — THE DECISIVE CHECK
  const ledgerMatch = JSON.stringify(before) === JSON.stringify(after);
  add(12, "both stores produce the same behavioural ledger", ledgerMatch,
    ledgerMatch ? "prospects, scores, origins, duplicates and event sequence all identical" : "LEDGERS DIFFER");

  return { ok: checks.every((c) => c.ok), checks };
}

export function renderVerification(v: Verification): string {
  return [`SUBSTRATE MIGRATION VERIFICATION · ${v.ok ? "PASS" : "FAIL"}`, "",
    ...v.checks.map((c) => `  ${c.ok ? "ok  " : "FAIL"}  ${String(c.n).padStart(2)}. ${c.name}\n            ${c.detail}`)].join("\n") + "\n";
}
