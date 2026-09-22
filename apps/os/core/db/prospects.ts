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
import { newProspectId, uuidv7 } from "@/domain";
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
  /**
   * D1b · ARCHIVAL. ISO-8601 when this prospect left the active hit list, null while it is active.
   *
   * Null is not "never archived" — it is the ABSENCE of an archival, the same distinction every
   * other nullable column on this row carries.
   */
  archivedAt: string | null;
  /** The human who archived it. Non-null exactly when `archivedAt` is (`archival_has_provenance`). */
  archivedBy: UserId | null;
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
         notes, assigned_to, created_by, archived_at, archived_by
    FROM prospects`;

type Raw = Record<string, unknown>;

/**
 * A `timestamptz` as a stable ISO string, whatever the driver handed back.
 *
 * `pg` returns a JS `Date`; PGlite can return a string. Both are correct and neither is the shape a
 * route body or a comparison wants, so the normalisation happens ONCE here rather than at each of
 * the readers. Note this is NOT the `to_char` treatment `first_contact` gets six lines up — that
 * exists because a `date` at UTC midnight renders as the previous day in a timezone behind UTC. A
 * `timestamptz` carries its instant unambiguously; only its spelling varies.
 */
const toIso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
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
  archivedAt: toIso(r.archived_at),
  archivedBy: (r.archived_by as UserId | null) ?? null,
});

// ─── D1b · THE ACTIVE SET ──────────────────────────────────────────────────────────────────────
//
// WHY EXCLUSION IS A READER DECISION AND NOT AN RLS ONE. `prospects_read` deliberately shows every
// row of the organization to every role, archived included, for the same reason 001 gives for held
// rows: "a hold is a WRITE barrier, not an information barrier". The identity matcher, the audit
// paths and the note readers all NEED archived rows. Only the operator's working surface does not.
//
// So the default is exclusion and the exception is explicit — and the direction matters. A forgotten
// flag hides a row from a list, which is visible and recoverable. The opposite default would put
// archived prospects back in the operator's queue, which is the regression this dependency exists
// to prevent.
const ACTIVE_ONLY = ` WHERE archived_at IS NULL`;

export type ReadScope = {
  /**
   * Include rows that have been archived.
   *
   * Pass `true` ONLY from a path that is auditing, reconciling, or MATCHING IDENTITY. An archived
   * business is still that business: `core/intake/import.ts` passes it because a matcher that cannot
   * see an archived record classifies its import row as `new` and creates a duplicate.
   */
  includeArchived?: boolean;
};

/**
 * Every prospect of the organization — ACTIVE ONLY unless the caller states otherwise (D1b).
 *
 * This is the reader nine consumers inherit, so the default is what the sales surface sees. The one
 * caller that MUST opt out is the identity matcher; see `ReadScope.includeArchived`.
 */
export async function listProspects(tx: SqlClient, scope: ReadScope = {}): Promise<ProspectRow[]> {
  const { rows } = await tx.query<Raw>(
    `${SELECT}${scope.includeArchived ? "" : ACTIVE_ONLY} ORDER BY name NULLS LAST, id`);
  return rows.map(toRow);
}

/**
 * Held prospects — visible to everyone, writable by no automated path.
 *
 * Active only by default: this is a WORK QUEUE ("resolve these identities"), and an archived held
 * row is work somebody already decided not to do.
 */
export async function listHeldProspects(tx: SqlClient, scope: ReadScope = {}): Promise<ProspectRow[]> {
  const { rows } = await tx.query<Raw>(
    `${SELECT} WHERE identity_state = 'held'${scope.includeArchived ? "" : " AND archived_at IS NULL"}
      ORDER BY id`);
  return rows.map(toRow);
}

/**
 * One prospect by its ANCHOR — archived rows included, always.
 *
 * NO active-set filter here, deliberately. This is the identity lookup: promotion reads a row back
 * through it, and the reconciliation check that derives an incomplete promotion ("a client names
 * anchor X while row X is not closed-won") has to reach archived rows or an incomplete promotion
 * becomes permanently invisible the moment somebody archives the prospect.
 */
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
 *
 * D1b: ARCHIVED ROWS ARE INCLUDED, and there is no option to exclude them. The P4 argument applies
 * unchanged — an archived business is still that business, and a matcher blind to it would report
 * `new` for a company already on file and create a second record. Archival removes a prospect from
 * the operator's list; it does not release its identity.
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
               notes, assigned_to, created_by, archived_at, archived_by`,
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

// ─── D1a · MUTATION IDENTITY AND THE PROMOTION MARK ────────────────────────────────────────────
//
// WHY A SEPARATE RESOLVER FROM THE READERS. `getProspect` answers "show me this prospect" and takes
// the FIRST row whose slug matches (`core/crm/prospect.ts`), which is the right shape for a page and
// the wrong shape for a mutation: promoting or archiving the wrong business is not recoverable by
// reloading. So a mutation resolves through here, where "more than one" is an OUTCOME rather than a
// silent choice.
//
// IDENTITY IS `prospect_id`, THE ANCHOR — never the slug, and never the surrogate `id`.
//
// Measured against production (2026-09-20, one read-only aggregate): 3,108 rows, of which only 6
// carry a slug and 3,102 carry NULL. So the reference a route receives is a SLUG for the six
// migrated prospects and the ROW ID for everything imported since (`slug ?? id`, the reader's own
// addressing). Both forms resolve here; neither becomes the identity that is written down.

/** One prospect, resolved unambiguously, with the anchor a mutation will key on. */
export type MutationTarget = {
  id: string;
  prospectId: ProspectId;
  slug: string | null;
  name: string | null;
  status: ProspectStatus | null;
  /**
   * D1b. Carried on the target so a caller sees archival state without a second query — and so that
   * "archived" is a STATE the caller reasons about, never a resolution failure. Collapsing it into
   * `not_found` would be the "read a filtered zero-row result as already-done" error this whole
   * resolver exists to prevent.
   */
  archivedAt: string | null;
};

export type MutationResolution =
  | { ok: true; target: MutationTarget }
  /** `ambiguous` carries the count so a refusal can state what it saw, never which rows. */
  | { ok: false; reason: "not_found" | "ambiguous" | "held"; matches: number };

/**
 * Resolve a route's reference to EXACTLY ONE anchored prospect, or refuse.
 *
 * A held row resolves to `held` rather than `ok`: it has no `prospect_id` (the anchor is NULL by
 * construction, `001_substrate.sql`), so there is nothing durable to key a promotion on — and
 * `prospects_update_sales`/`_automation` refuse it at the database anyway. Refusing here means the
 * operator is told why, instead of reading a policy-filtered zero-row UPDATE as "already done".
 */
export async function resolveProspectForMutation(tx: SqlClient, ref: string): Promise<MutationResolution> {
  type Row = { id: string; prospect_id: string | null; slug: string | null; name: string | null;
               status: ProspectStatus | null; identity_state: IdentityState; archived_at: unknown };
  // Slug first, then the surrogate id — the same precedence `findProspectRef` uses, for the same
  // reason: a slug is the more specific claim. NO `LIMIT`, deliberately. The limit is what turns a
  // duplicate into an invisible choice, and this function exists to see it.
  const bySlug = await tx.query<Row>(
    `SELECT id, prospect_id, slug, name, status, identity_state, archived_at
       FROM prospects WHERE slug = $1`, [ref]);
  let rows = bySlug.rows;
  if (rows.length === 0) {
    // Only rows WITHOUT a slug are addressed by id, matching the reader's `slug ?? id`. A row that
    // has a slug is not reachable by its surrogate, so one prospect never has two addresses.
    const byId = await tx.query<Row>(
      `SELECT id, prospect_id, slug, name, status, identity_state, archived_at
         FROM prospects WHERE slug IS NULL AND id::text = $1`, [ref]);
    rows = byId.rows;
  }
  if (rows.length === 0) return { ok: false, reason: "not_found", matches: 0 };
  if (rows.length > 1) return { ok: false, reason: "ambiguous", matches: rows.length };
  const row = rows[0];
  if (row.identity_state === "held" || row.prospect_id === null) {
    return { ok: false, reason: "held", matches: 1 };
  }
  return {
    ok: true,
    target: {
      id: row.id, prospectId: row.prospect_id as ProspectId, slug: row.slug, name: row.name,
      status: row.status, archivedAt: toIso(row.archived_at),
    },
  };
}

// ─── D1b · THE PROSPECT-SCOPED LOCK ────────────────────────────────────────────────────────────
//
// WHAT THIS CLOSES. D1a's compare-and-set guarantees one `closed-won` transition and one
// `prospect.promoted` event. It does NOT guarantee one CLIENT, because `promoteInPostgres` ran as
// three steps — resolve (transaction 1), find-or-create the client (FILESYSTEM, no transaction),
// mark (transaction 2) — and the client write sits outside both transactions. Two concurrent
// promotions therefore both scan for `promoted_from_prospect_id`, both find nothing, and both create
// a client; the loser is then told `already_marked` next to the duplicate it just made. That is
// defect P2 returning, and two submissions are one double-click apart.
//
// ─── WHY A TRANSACTION-SCOPED LOCK, NOT A SESSION-SCOPED ONE ───────────────────────────────────
//
// The obvious answer is `pg_advisory_lock` (session-scoped) taken in step 1 and released after
// step 3. IT IS WRONG HERE, and `core/db/pool.ts` says why: the application endpoint is the
// TRANSACTION POOLER, which "multiplexes transactions across backends, so session-scoped state does
// not survive it". A session lock taken during one transaction may be held on a backend the next
// transaction never sees — so it would fail to exclude anything AND leak, permanently, with no
// session left to release it.
//
// `pg_advisory_xact_lock` has neither problem. The pooler pins a backend for the duration of a
// transaction — a transaction IS the unit that gives us a stable backend — and the lock is released
// by COMMIT or ROLLBACK, including the rollback a crashed request causes. A leaked lock is not
// representable.
//
// The cost is that the critical section becomes ONE transaction spanning the client's filesystem
// write. That is four small files and a rename — single-digit milliseconds — and at one production
// user it is not a contention concern. It is the honest trade: holding a backend slightly longer, in
// exchange for an invariant that cannot be expressed any other way through a transaction pooler.
//
// KEY DERIVATION uses only documented functions. `hashtext()` would be shorter but is an internal
// with no stability guarantee; md5 → bit(32) → int is portable and behaves identically on PGlite.
// The first argument is an application namespace, so these locks cannot collide with anyone else's.
const LOCK_NAMESPACE = 4919;

/**
 * Take the prospect-scoped lock for the REST OF THIS TRANSACTION, waiting if another holds it.
 *
 * Keyed on the ANCHOR, never the slug or the surrogate: the anchor is the identity two racing
 * requests actually share, and a slug is renameable.
 */
export async function lockProspect(tx: SqlClient, prospectId: string): Promise<void> {
  await tx.query(
    `SELECT pg_advisory_xact_lock($1, ('x' || substr(md5($2), 1, 8))::bit(32)::int)`,
    [LOCK_NAMESPACE, `prospect:${prospectId}`]
  );
}

export type PromotionMark =
  | { state: "marked" }
  | { state: "already_marked" }
  /** The row is visible but the UPDATE changed nothing: RLS or a column grant refused it. */
  | { state: "refused"; reason: string };

/**
 * Mark a prospect promoted: compare-and-set the status, and append `prospect.promoted` — IN ONE
 * TRANSACTION, because `tx` is the caller's.
 *
 * ─── WHY COMPARE-AND-SET RATHER THAN A PLAIN UPDATE ────────────────────────────────────────────
 *
 * Promotion is retried by operators (the button stays visible) and by the D1a retry path, and two
 * concurrent submissions are one double-click apart. `WHERE status IS DISTINCT FROM 'closed-won'`
 * makes the SECOND writer change zero rows, so it cannot append a second `prospect.promoted` for a
 * prospect that was already promoted. Idempotency comes from the state itself; no key table exists
 * to get out of step with it.
 *
 * ─── ZERO ROWS IS AMBIGUOUS, SO IT IS DISAMBIGUATED ────────────────────────────────────────────
 *
 * An UPDATE refused by row-level security also returns zero rows — identical, from here, to "already
 * promoted". Reading the row back separates them: still visible and still not won means the database
 * refused this principal (a sales principal on a held row is the live example), which is a refusal to
 * report, not a success to claim.
 */
export async function markProspectPromoted(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: {
    target: MutationTarget;
    clientSlug: string;
    clientId: string;
    correlationId: string;
    actorUserId: UserId;
    /** True when this call completes a promotion whose client already existed (a retry). */
    completedAfterIncomplete?: boolean;
  }
): Promise<PromotionMark> {
  // `archived_at IS NULL` is D1b's addition, and it is DEFENCE IN DEPTH — stated plainly, because
  // the mutation probes measured it rather than assuming it.
  //
  // The guard that actually stops an archived prospect being promoted is the re-check inside
  // `promoteInPostgres`, which runs under the prospect-scoped advisory lock: removing THAT turns
  // T15 red. Removing THIS predicate turns nothing red, because the lock means no archival can
  // commit between the re-check and this UPDATE — there is no window left for it to guard.
  //
  // It is kept anyway, and the reason is specific rather than superstitious: it is the guard that
  // still holds if the lock is ever removed or its critical section is ever narrowed, and it costs
  // one predicate on a statement that already takes the row lock. Probe M12 is therefore recorded as
  // NOT CAUGHT in the checkpoint, which is the honest classification for a redundant safeguard —
  // not evidence of a missing test.
  // 2A.1b · the stage now changes ONLY through `ascend_transition_stage` (010): no application role
  // holds UPDATE on `status`, and every change writes exactly one `prospect_stage_transitions` row.
  // The caller holds the prospect lock, so the status read here is the status the function sees; its
  // own compare-and-set (`p_expected_from`) is the second line, and a mismatch is reported, not won.
  const { rows: current } = await tx.query<{ status: ProspectStatus | null; archived_at: unknown }>(
    `SELECT status, archived_at FROM prospects WHERE id = $1`, [input.target.id]);
  if (current.length === 0) return { state: "refused", reason: "the prospect is no longer visible to this principal" };
  // Checked BEFORE archival, as before: an archived row that is already closed-won was promoted
  // earlier and archived since, and "already promoted" is the truthful answer to a retry.
  if (current[0].status === "closed-won") return { state: "already_marked" };
  if (current[0].archived_at !== null && current[0].archived_at !== undefined) {
    return { state: "refused", reason: "the prospect was archived before this promotion could be marked" };
  }
  const from = current[0].status;
  const transitionId = uuidv7();
  // closed-lost → closed-won is allowed here and only here (owner decision D-2): a terminal business
  // exception, not a reopening. `p_touch_last_contact` keeps D1's `last_contact` behaviour, moved to
  // GREATEST so the projection can never go backwards (D-3).
  const applied = await tx.query<{ r: string }>(
    `SELECT public.ascend_transition_stage($1, $2, $3, $4, $5, 'closed-won', 'promotion', NULL, NULL, true) AS r`,
    [input.target.id, input.actorUserId, transitionId, input.correlationId, from]);
  if (applied.rows[0].r !== "applied") {
    return { state: "refused", reason: "the prospect's stage changed before this promotion could be marked" };
  }

  // One correlation id for the transition, the stage event and the promotion event.
  await appendEvent(tx, organizationId, {
    type: "prospect.status_changed",
    subject: { entity: "prospect", entity_id: input.target.prospectId },
    actor: "operator",
    actor_user_id: input.actorUserId,
    data: { transition_id: transitionId, from, to: "closed-won", cause: "promotion" },
    correlation_id: input.correlationId,
  });
  await appendEvent(tx, organizationId, {
    type: "prospect.promoted",
    // The anchor, matching `prospect.created` in this file — never the slug the route carried.
    subject: { entity: "prospect", entity_id: input.target.prospectId },
    actor: "operator",
    actor_user_id: input.actorUserId,
    data: {
      client_slug: input.clientSlug,
      client_id: input.clientId,
      ...(input.completedAfterIncomplete ? { completed_after_incomplete: true } : {}),
    },
    correlation_id: input.correlationId,
  });
  return { state: "marked" };
}

// ─── D1b · ARCHIVAL ────────────────────────────────────────────────────────────────────────────

export type ArchiveOutcome =
  | { state: "archived"; archivedAt: string }
  | { state: "already_archived"; archivedAt: string | null }
  /** The row is visible but the UPDATE changed nothing: RLS or a column grant refused it. */
  | { state: "refused"; reason: string };

/**
 * Archive a prospect: compare-and-set the archival columns, and append `prospect.archived` — IN ONE
 * TRANSACTION, because `tx` is the caller's.
 *
 * ─── WHY ARCHIVE AND NOT DELETE ────────────────────────────────────────────────────────────────
 *
 * `prospect_notes.prospect` carries `ON DELETE CASCADE` (008). A `DELETE FROM prospects` therefore
 * destroys every note a human wrote about that business, silently, as a side effect of removing it
 * from a list. An UPDATE cannot cascade, so archival is the operation that keeps the sales history
 * the operator actually cares about — along with the identity anchor, the event trail, and the
 * client's `promoted_from_prospect_id` back-reference.
 *
 * ─── COMPARE-AND-SET, FOR THE SAME REASON PROMOTION USES ONE ───────────────────────────────────
 *
 * `WHERE archived_at IS NULL` makes the SECOND writer change zero rows, so it cannot append a second
 * `prospect.archived` and cannot overwrite the first archiver's attribution. Idempotency comes from
 * the state itself; there is no key table to drift out of sync with it.
 *
 * Under READ COMMITTED a concurrent second archive blocks on the row lock, then re-evaluates this
 * predicate against the UPDATED row (EvalPlanQual), finds `archived_at` set, and matches nothing.
 * Archive-versus-archive therefore needs no lock of its own — unlike promotion, whose critical
 * section leaves the database (see `lockProspect`).
 *
 * ─── ZERO ROWS IS AMBIGUOUS, SO IT IS DISAMBIGUATED ────────────────────────────────────────────
 *
 * An UPDATE refused by row-level security also returns zero rows. After 009 the live case is a sales
 * principal on a held row: `prospects_update_sales` requires `identity_state = 'anchored'`, so the
 * refusal is real and must be REPORTED — never read as "already archived", which would tell the
 * operator their held prospect is gone when it is still on the list.
 */
export async function archiveProspect(
  tx: SqlClient,
  organizationId: OrganizationId,
  input: {
    target: MutationTarget;
    actorUserId: UserId;
    correlationId: string;
    /** Stated by the operator, or absent. Absence stays absence — never written as null. */
    reason?: string;
  }
): Promise<ArchiveOutcome> {
  const updated = await tx.query<{ archived_at: unknown }>(
    `UPDATE prospects
        SET archived_at = now(), archived_by = $2, updated_at = now()
      WHERE id = $1 AND archived_at IS NULL
      RETURNING archived_at`,
    [input.target.id, input.actorUserId]
  );

  if (updated.rows.length === 0) {
    const { rows } = await tx.query<{ archived_at: unknown }>(
      `SELECT archived_at FROM prospects WHERE id = $1`, [input.target.id]);
    if (rows.length === 0) {
      return { state: "refused", reason: "the prospect is no longer visible to this principal" };
    }
    const at = toIso(rows[0].archived_at);
    if (at !== null) return { state: "already_archived", archivedAt: at };
    return {
      state: "refused",
      reason: "the database refused this principal's archival of the prospect",
    };
  }

  const archivedAt = toIso(updated.rows[0].archived_at)!;

  await appendEvent(tx, organizationId, {
    type: "prospect.archived",
    // The anchor, matching `prospect.created` and `prospect.promoted` in this file — never the slug
    // the route carried. A slug is renameable; an event's subject may not be.
    subject: { entity: "prospect", entity_id: input.target.prospectId },
    actor: "operator",
    actor_user_id: input.actorUserId,
    data: { ...(input.reason ? { reason: input.reason } : {}) },
    correlation_id: input.correlationId,
  });

  return { state: "archived", archivedAt };
}
