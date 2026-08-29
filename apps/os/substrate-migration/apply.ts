// substrate-migration/apply — write the manifest into the substrate, and nothing else.
//
// Requires an explicit `confirm`, like every reviewed one-shot before it.
//
// IT EMITS NOTHING. Not "no business event" — the migration appends no event of its own at all. The
// 41 events it inserts are the vault's OWN events, carried across with their original `event_id`,
// `occurred_at`, actor and subject. Nothing new is created, so there is nothing new to claim.
//
// That is also why `appendEvent` is not used here: that function MINTS an id and stamps the clock,
// which is right for a new fact and wrong for a transcription. Preserving the originals is what
// keeps the spine's history intact rather than re-dating it to the migration.
//
// ORDER IS PRESERVED BY INSERTION ORDER. `seq` is a BIGSERIAL, so inserting in the vault reader's
// authoritative sequence reproduces that sequence in Postgres — the ordering contract carried
// across rather than re-derived.

import "server-only";
import type { OrganizationId } from "@/domain";
import type { SqlClient } from "@/core/db";
import { validateManifest, type MigrationManifest } from "./plan";
import { EMPTY_EQUALS_ABSENT } from "./ledger";

export type MigrationReport = {
  prospectsInserted: number;
  eventsInserted: number;
  skipped: { subject: string; reason: string }[];
  /** Events the migration created on its own behalf. Structurally zero; reported so a regression shows. */
  eventsAuthoredByMigration: 0;
};

export class MigrationRefused extends Error {}

/** `""` → null, for the narrow, evidence-backed set in EMPTY_EQUALS_ABSENT only. */
const emptyToNull = (v: string | null): string | null => (v === "" ? null : v);
void EMPTY_EQUALS_ABSENT;

export async function applySubstrateMigration(
  tx: SqlClient,
  organizationId: OrganizationId,
  manifest: MigrationManifest,
  opts: { confirm: boolean }
): Promise<MigrationReport> {
  if (!opts.confirm) {
    throw new MigrationRefused("applySubstrateMigration requires { confirm: true } — dry run is the default");
  }
  const issues = validateManifest(manifest);
  if (issues.length > 0) {
    throw new MigrationRefused(
      `manifest failed validation; nothing was written:\n${issues.map((i) => `  ${i.subject}: ${i.problem}`).join("\n")}`
    );
  }

  const report: MigrationReport = {
    prospectsInserted: 0, eventsInserted: 0, skipped: [], eventsAuthoredByMigration: 0,
  };

  for (const p of manifest.prospects) {
    // IDEMPOTENT. An anchored prospect already present is skipped rather than duplicated; the
    // UNIQUE index would refuse it anyway, but reporting the skip is more useful than an exception.
    if (p.prospectId) {
      const { rows } = await tx.query(`SELECT 1 FROM prospects WHERE prospect_id = $1`, [p.prospectId]);
      if (rows.length > 0) {
        report.skipped.push({ subject: p.slug, reason: "already present" });
        continue;
      }
    } else {
      // Held rows have no identity to key on, so they are matched by their vault slug within the org.
      const { rows } = await tx.query(
        `SELECT 1 FROM prospects WHERE organization_id = $1 AND slug = $2`, [organizationId, p.slug]
      );
      if (rows.length > 0) {
        report.skipped.push({ subject: p.slug, reason: "already present" });
        continue;
      }
    }

    const f = p.fields;
    await tx.query(
      `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug,
         name, business_type, location, website, contact_name, contact_phone, contact_email,
         source, status, website_quality,
         decision_maker_access, project_urgency, niche_alignment, first_contact, last_contact,
         notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NULL)`,
      [
        organizationId, p.prospectId, p.identityState, p.holdReason, p.slug,
        f.name, f.business_type, f.location, f.website, f.contact_name, f.contact_phone,
        f.contact_email, f.source, f.status, f.website_quality,
        // Booleans are carried as the vault stated them. An ABSENT value stays NULL rather than
        // becoming `false`, because `false` is a claim that somebody checked (D-1, one field over).
        f.decision_maker_access === null ? null : f.decision_maker_access === "true",
        f.project_urgency,
        f.niche_alignment === null ? null : f.niche_alignment === "true",
        // See EMPTY_EQUALS_ABSENT: a date column cannot hold "", and all three consumers
        // treat "" and absent identically. Every other field keeps its empty string verbatim.
        emptyToNull(f.first_contact), emptyToNull(f.last_contact), p.body,
      ] as never
    );
    report.prospectsInserted += 1;
  }

  for (const e of manifest.events) {
    const { rows } = await tx.query(`SELECT 1 FROM events WHERE event_id = $1`, [e.eventId]);
    if (rows.length > 0) {
      report.skipped.push({ subject: e.eventId, reason: "already present" });
      continue;
    }
    await tx.query(
      `INSERT INTO events (event_id, organization_id, type, occurred_at, actor, actor_user_id,
                           subject_entity, subject_entity_id, data, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.eventId, organizationId, e.type, e.occurredAt, e.actor, e.actorUserId,
        e.subjectEntity, e.subjectEntityId, e.data ? JSON.stringify(e.data) : null, e.correlationId,
      ] as never
    );
    report.eventsInserted += 1;
  }

  return report;
}
