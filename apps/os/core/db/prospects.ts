// core/db/prospects — the prospect repository on the shared substrate.
//
// SIGNATURES MIRROR core/crm/prospect.ts DELIBERATELY. Nine modules call `listProspects()` and none
// of them read a field this store cannot provide, so re-homing later is a change of import path
// rather than a change of contract. Stage 2A does NOT flip those callers; the vault stays
// authoritative until Stage 2B has verified parity.
//
// WHAT THE DATABASE NOW ENFORCES THAT CODE USED TO. Three rules from Stages 0.5 and 1 are
// constraints here, so this file does not re-check them and could not weaken them if it tried:
//
//   anchored ⟺ prospect_id IS NOT NULL          `anchored_iff_identified`
//   held     ⟺ hold_reason IS NOT NULL          `held_states_its_reason`
//   a judgment carries its author and time      `assessment_has_provenance`
//
// And two it enforces through GRANTS rather than logic: automation cannot write
// `website_opportunity`, and no role may UPDATE a held row (P3).
//
// THE O(N²) CORRECTION LIVES HERE. `createProspect` in the vault called `buildProspectIdIndex()`,
// which read every prospect file, so importing N rows cost O(N²) reads — measured at 14.3 ms/row by
// N=400 and extrapolating to ~15 minutes at 5,000. Here uniqueness is a UNIQUE index: one probe,
// and race-safe, which the filesystem version could not be at any cost.

import "server-only";
import type {
  IdentityState, OrganizationId, ProspectId, ProspectStatus, UserId, WebsiteQuality,
} from "@/domain";
import { newProspectId } from "@/domain";
import type { SqlClient } from "./client";
import { appendEvent } from "./events";

export type ProspectRow = {
  id: string;
  prospectId: ProspectId | null;
  identityState: IdentityState;
  holdReason: string | null;
  slug: string | null;
  name: string | null;
  website: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: ProspectStatus | null;
  websiteQuality: WebsiteQuality | null;
  websiteOpportunity: "green" | "yellow" | "red" | null;
  // Qualification + sales history. Nullable throughout: an unstated boolean is NOT false, and
  // `false` here would be a positive claim that we checked (the D-1 lesson, one field over).
  decisionMakerAccess: boolean | null;
  projectUrgency: "low" | "medium" | "high" | null;
  nicheAlignment: boolean | null;
  firstContact: string | null;
  lastContact: string | null;
  businessType: string | null;
  location: string | null;
  contactName: string | null;
  source: string | null;
  /** The markdown body: call log, friction, objections. Human-authored. */
  notes: string | null;
  assignedTo: UserId | null;
  createdBy: UserId | null;
};

const SELECT = `
  SELECT id, prospect_id, identity_state, hold_reason, slug, name, website,
         contact_name, contact_phone, contact_email, business_type, location, source,
         status, website_quality, website_opportunity,
         decision_maker_access, project_urgency, niche_alignment,
         -- FORMATTED IN SQL, DELIBERATELY. A date column arrives at the driver as a JS Date at
         -- UTC midnight, and rendering that in a timezone behind UTC yields the PREVIOUS DAY:
         -- 2026-06-10 read back as "Jun 09". The behavioural ledger caught it: a business fact
         -- silently changing during serialisation, which is exactly the class of defect the parity
         -- gate exists to find. to_char keeps the column queryable as a real date while
         -- guaranteeing the round trip.
         to_char(first_contact, 'YYYY-MM-DD') AS first_contact,
         to_char(last_contact,  'YYYY-MM-DD') AS last_contact,
         notes, assigned_to, created_by
    FROM prospects`;

type Raw = Record<string, unknown>;
const toRow = (r: Raw): ProspectRow => ({
  id: String(r.id),
  prospectId: (r.prospect_id as ProspectId | null) ?? null,
  identityState: r.identity_state as IdentityState,
  holdReason: (r.hold_reason as string | null) ?? null,
  slug: (r.slug as string | null) ?? null,
  name: (r.name as string | null) ?? null,
  website: (r.website as string | null) ?? null,
  contactPhone: (r.contact_phone as string | null) ?? null,
  contactEmail: (r.contact_email as string | null) ?? null,
  status: (r.status as ProspectStatus | null) ?? null,
  websiteQuality: (r.website_quality as WebsiteQuality | null) ?? null,
  websiteOpportunity: (r.website_opportunity as ProspectRow["websiteOpportunity"]) ?? null,
  decisionMakerAccess: (r.decision_maker_access as boolean | null) ?? null,
  projectUrgency: (r.project_urgency as ProspectRow["projectUrgency"]) ?? null,
  nicheAlignment: (r.niche_alignment as boolean | null) ?? null,
  firstContact: (r.first_contact as string | null) ?? null,
  lastContact: (r.last_contact as string | null) ?? null,
  businessType: (r.business_type as string | null) ?? null,
  location: (r.location as string | null) ?? null,
  contactName: (r.contact_name as string | null) ?? null,
  source: (r.source as string | null) ?? null,
  notes: (r.notes as string | null) ?? null,
  assignedTo: (r.assigned_to as UserId | null) ?? null,
  createdBy: (r.created_by as UserId | null) ?? null,
});

export async function listProspects(tx: SqlClient): Promise<ProspectRow[]> {
  const { rows } = await tx.query<Raw>(`${SELECT} ORDER BY name NULLS LAST, id`);
  return rows.map(toRow);
}

/** Held prospects — visible to everyone, writable by no automated path. */
export async function listHeldProspects(tx: SqlClient): Promise<ProspectRow[]> {
  const { rows } = await tx.query<Raw>(`${SELECT} WHERE identity_state = 'held' ORDER BY id`);
  return rows.map(toRow);
}

export async function findByProspectId(tx: SqlClient, id: ProspectId): Promise<ProspectRow | null> {
  const { rows } = await tx.query<Raw>(`${SELECT} WHERE prospect_id = $1`, [id]);
  return rows.length ? toRow(rows[0]) : null;
}

/**
 * Prospects that corroborate any of the supplied identity signals — INCLUDING held ones.
 *
 * THE P4 SEAM, and the reason this function exists at all. A hold is a write barrier, not an
 * information barrier: if held prospects were filtered out here, an import row for a held business
 * would find no match, be classified `new`, and create a THIRD record of a company already recorded
 * twice — the quarantine manufacturing the duplicate it exists to prevent.
 *
 * Name is deliberately NOT a match key. Dozens of businesses share one, and a name-only match is
 * how a matcher starts merging unrelated companies.
 */
export async function findCorroborating(
  tx: SqlClient,
  signals: { website?: string | null; phone?: string | null; email?: string | null }
): Promise<ProspectRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: string) => {
    params.push(value);
    clauses.push(clause.replace("?", `$${params.length}`));
  };
  if (signals.website) add("lower(website) = lower(?)", signals.website);
  if (signals.phone) add("contact_phone = ?", signals.phone);
  if (signals.email) add("lower(contact_email) = lower(?)", signals.email);
  if (clauses.length === 0) return [];

  const { rows } = await tx.query<Raw>(
    `${SELECT} WHERE ${clauses.join(" OR ")} ORDER BY id`,
    params as never
  );
  return rows.map(toRow);
}

export type CreateProspectInput = {
  slug?: string | null;
  name?: string | null;
  website?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  businessType?: string | null;
  location?: string | null;
  source?: string | null;
  status?: ProspectStatus | null;
  websiteQuality?: WebsiteQuality | null;
  contactName?: string | null;
  decisionMakerAccess?: boolean | null;
  projectUrgency?: "low" | "medium" | "high" | null;
  nicheAlignment?: boolean | null;
  firstContact?: string | null;
  lastContact?: string | null;
  notes?: string | null;
  /** Supply to preserve an identity that already exists (migration); omit to mint a new one. */
  prospectId?: ProspectId;
  /** Create WITHOUT an identity, stating why. The Stage 1 hold, expressed at creation. */
  hold?: { reason: string };
  createdBy?: UserId | null;
};

/**
 * Create a prospect and record its birth, in ONE transaction.
 *
 * ATOMIC BY CONSTRUCTION. The vault could not do this: `writeFileAtomic` then `emitEvent` are two
 * operations, and a crash between them left a prospect with no memory of being created. Here the
 * row and its event commit together or neither does.
 *
 * `actorUserId` is required for an operator-authored creation and forbidden for a system one — the
 * schema's CHECK enforces both directions, so a bulk import cannot silently attribute 600 births to
 * a human (D-3), and a human action cannot hide behind "system".
 */
export async function createProspect(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: CreateProspectInput,
  actor: { kind: "operator"; userId: UserId } | { kind: "system" }
): Promise<ProspectRow> {
  const held = input.hold !== undefined;
  // A held prospect is created WITHOUT an identity. Assigning one would assert it is an independent
  // business, which is exactly the claim a hold exists to withhold.
  const prospectId = held ? null : (input.prospectId ?? newProspectId());

  const { rows } = await tx.query<Raw>(
    `INSERT INTO prospects (organization_id, prospect_id, identity_state, hold_reason, slug, name,
                            website, contact_name, contact_phone, contact_email, business_type,
                            location, source, status, website_quality, created_by,
                            decision_maker_access, project_urgency, niche_alignment,
                            first_contact, last_contact, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id, prospect_id, identity_state, hold_reason, slug, name, website,
               contact_name, contact_phone, contact_email, business_type, location, source,
               status, website_quality, website_opportunity,
               decision_maker_access, project_urgency, niche_alignment,
               to_char(first_contact, 'YYYY-MM-DD') AS first_contact,
               to_char(last_contact,  'YYYY-MM-DD') AS last_contact,
               notes, assigned_to, created_by`,
    [
      organizationId, prospectId, held ? "held" : "anchored", input.hold?.reason ?? null,
      input.slug ?? null, input.name ?? null, input.website ?? null, input.contactName ?? null,
      input.contactPhone ?? null, input.contactEmail ?? null, input.businessType ?? null,
      input.location ?? null, input.source ?? null, input.status ?? null,
      input.websiteQuality ?? null,
      actor.kind === "operator" ? actor.userId : (input.createdBy ?? null),
      input.decisionMakerAccess ?? null, input.projectUrgency ?? null, input.nicheAlignment ?? null,
      input.firstContact ?? null, input.lastContact ?? null, input.notes ?? null,
    ] as never
  );
  const row = toRow(rows[0]);

  await appendEvent(tx, organizationId, {
    type: "prospect.created",
    subject: { entity: "prospect", entity_id: row.prospectId ?? row.id },
    ...(actor.kind === "operator"
      ? { actor: "operator" as const, actor_user_id: actor.userId }
      : { actor: "system" as const }),
    data: { identity_state: row.identityState, ...(held ? { hold_reason: input.hold?.reason } : {}) },
  });

  return row;
}

/**
 * Record a human's website-opportunity judgment.
 *
 * OPERATOR-ONLY BY GRANT, not by check. `ascend_automation` holds no UPDATE privilege on
 * `website_opportunity`, `assessed_by` or `assessed_at`, so a research path that tried to call this
 * fails at the database. The three columns move together because the schema requires it — a
 * judgment that cannot name its author is not recorded at all.
 */
export async function assessWebsiteOpportunity(
  tx: SqlClient,
  organizationId: OrganizationId,
  prospectRowId: string,
  assessment: "green" | "yellow" | "red",
  userId: UserId
): Promise<void> {
  const { rows } = await tx.query<Raw>(
    `UPDATE prospects
        SET website_opportunity = $1, assessed_by = $2, assessed_at = now(), updated_at = now()
      WHERE id = $3
      RETURNING prospect_id, id`,
    [assessment, userId, prospectRowId]
  );
  if (rows.length === 0) return; // held or out-of-org: RLS filtered it. No event for a no-op.

  await appendEvent(tx, organizationId, {
    type: "prospect.assessed",
    actor: "operator",
    actor_user_id: userId,
    subject: { entity: "prospect", entity_id: String(rows[0].prospect_id ?? rows[0].id) },
    data: { website_opportunity: assessment },
  });
}
