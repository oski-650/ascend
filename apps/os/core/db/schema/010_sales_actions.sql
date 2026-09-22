-- Ascend OS · SALES ACTIONS: contacts, follow-ups, stage history, command receipts (Slice 2A.1b)
--
-- NOT APPLIED TO PRODUCTION BY THIS FILE. Applying it is a further authorization that writing it
-- does not carry (2A.3). Contract: docs/SLICE-2A1B-CONTRACT.md §7–§14.
--
-- ─── WHAT CHANGES FOR EXISTING OBJECTS ─────────────────────────────────────────────────────────
--
-- No column of `prospects` is added, altered or dropped. What changes is WHO may write four of them:
-- `status`, `assigned_to`, `first_contact`, `last_contact`. Under 001–009 both human roles could
-- `UPDATE` them directly, so "sales may only claim for themselves", "only Promote wins", "every stage
-- change is recorded" and "the contact dates follow the contacts" held only by code review. After
-- this file no application role holds UPDATE on those four columns; they change only through the
-- three guarded functions below, and a status change by ANY role — including the table owner — must
-- name the transition row that records it.
--
-- ─── WHAT THE DATABASE CAN AND CANNOT KNOW ─────────────────────────────────────────────────────
--
-- The application connects with shared roles (`ascend_owner`, `ascend_sales`). The guarded functions
-- check that the actor they are given is the transaction's bound `current_user_id()`, holds an
-- ENABLED membership in `current_org()`, has the membership role the operation needs, and — for a
-- claim — is the assignee. They cannot know which human sent the request: the binding
-- "authenticated request → user id" belongs to the application's authority resolver. The functions
-- are defence in depth behind it, not a replacement for it.
--
-- ─── WHY THE FUNCTIONS CHECK THE ORGANIZATION THEMSELVES ───────────────────────────────────────
--
-- They are SECURITY DEFINER, owned by whoever applies this file — `postgres` in production (not a
-- superuser, but BYPASSRLS; measured from the post-009 artifact's globals, 2026-09-22) and a
-- superuser in the test harnesses. Either way the owner bypasses row-level security, so no policy
-- protects a row inside these bodies. Every statement in them therefore names `current_org()`
-- explicitly. `search_path` is empty and every object is schema-qualified; there is no dynamic SQL.
--
-- ─── SUPABASE DEFAULT PRIVILEGES ───────────────────────────────────────────────────────────────
--
-- In production `postgres` carries `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS | TABLES TO
-- anon, authenticated, service_role` (measured from the same artifact). Left alone, every function and
-- table below would be granted to Supabase's API roles on creation — including EXECUTE on SECURITY
-- DEFINER functions. The last section revokes all of it, for each of those roles that exists.

-- ─── 1 · command receipts ─────────────────────────────────────────────────────────────────────
--
-- One row per logical command. A command can create several rows, or none (a claim-only command
-- writes an UPDATE and an event), so no history table's key can stand in for "this command already
-- ran". Written LAST in the command's transaction; the history tables reference it through DEFERRED
-- keys, so a command's rows and its receipt commit together or not at all.

CREATE TABLE prospect_command_receipts (
  command_id      uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect        uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL CHECK (kind IN ('save', 'claim', 'reassign', 'unassign', 'followup_edit')),
  -- SHA-256 of the canonical, normalized command. Prose is inside the hash, never beside it.
  payload_sha256  text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- Ids, enums and states only: enough to answer a replay with the same logical result.
  outcome         jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_command_receipts_by_prospect ON prospect_command_receipts (prospect, created_at DESC);

-- ─── 2 · contacts ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE prospect_contacts (
  contact_id      uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect        uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  command_id      uuid NOT NULL REFERENCES prospect_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  author_user_id  uuid NOT NULL REFERENCES users(id),
  outcome         text NOT NULL CHECK (outcome IN ('no_answer', 'voicemail', 'spoke', 'interested', 'not_interested',
                                                   'callback_requested', 'meeting_set', 'wrong_number', 'email_sent', 'other')),
  channel         text NOT NULL CHECK (channel IN ('call', 'email', 'text', 'in_person', 'other')),
  note            text CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 2000)),
  happened_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  -- Role-independent. How far back a contact may be dated depends on who records it (sales: 90 days;
  -- owner: older history), which only the command layer knows — so it is not a CHECK.
  CONSTRAINT contact_not_in_future CHECK (happened_at <= recorded_at + interval '5 minutes'),
  -- Only the two combinations that would be contradictions. Nothing else is guessed.
  CONSTRAINT contact_channel_fits_outcome CHECK (
    (outcome <> 'email_sent' OR channel = 'email') AND (outcome <> 'voicemail' OR channel = 'call'))
);
CREATE INDEX prospect_contacts_timeline ON prospect_contacts (prospect, happened_at DESC);
CREATE INDEX prospect_contacts_by_author ON prospect_contacts (organization_id, author_user_id, happened_at);
CREATE INDEX prospect_contacts_recent ON prospect_contacts (organization_id, happened_at DESC);

-- ─── 3 · follow-ups ───────────────────────────────────────────────────────────────────────────

CREATE TABLE prospect_followups (
  followup_id         uuid PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect            uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  action              text NOT NULL CHECK (action IN ('call', 'email', 'text', 'meeting', 'other')),
  assignee_user_id    uuid NOT NULL REFERENCES users(id),
  -- The business day it is due (America/Los_Angeles). Authoritative.
  due_on              date NOT NULL,
  -- The exact instant, only when a time was chosen. Resolved by the command, never by PostgreSQL.
  due_at              timestamptz,
  note                text CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 2000)),
  state               text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'completed', 'cancelled', 'superseded')),
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_command  uuid NOT NULL REFERENCES prospect_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  created_by_contact  uuid REFERENCES prospect_contacts(contact_id),
  resolved_by         uuid REFERENCES users(id),
  resolved_at         timestamptz,
  resolved_by_command uuid REFERENCES prospect_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  resolved_by_contact uuid REFERENCES prospect_contacts(contact_id),
  -- Deferred: a superseded row names its successor, which is inserted after it leaves `open`.
  superseded_by       uuid REFERENCES prospect_followups(followup_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT followup_resolution_has_provenance CHECK (
    (state = 'open') = (resolved_at IS NULL) AND (state = 'open') = (resolved_by IS NULL)
    AND (state = 'open') = (resolved_by_command IS NULL)),
  CONSTRAINT followup_superseded_names_successor CHECK ((state = 'superseded') = (superseded_by IS NOT NULL)),
  CONSTRAINT followup_completed_by_contact_only_when_completed CHECK (resolved_by_contact IS NULL OR state = 'completed'),
  CONSTRAINT followup_not_self_superseding CHECK (superseded_by IS NULL OR superseded_by <> followup_id),
  -- A timezone-exact ASSERTION about an instant the command resolved — not a conversion.
  CONSTRAINT followup_due_at_is_on_due_on CHECK (due_at IS NULL OR (due_at AT TIME ZONE 'America/Los_Angeles')::date = due_on)
);
-- At most ONE open follow-up per prospect: a second is structurally impossible.
CREATE UNIQUE INDEX prospect_followups_one_open ON prospect_followups (prospect) WHERE state = 'open';
CREATE INDEX prospect_followups_queue ON prospect_followups (organization_id, assignee_user_id, due_on) WHERE state = 'open';
CREATE INDEX prospect_followups_by_prospect ON prospect_followups (prospect, created_at DESC);

-- ─── 4 · stage transitions ────────────────────────────────────────────────────────────────────
--
-- Every change of `prospects.status` after this migration, whichever command made it. `closed-won`
-- arrives only as `cause = 'promotion'`; the cause is DERIVED from the change and held to it here.

CREATE TABLE prospect_stage_transitions (
  transition_id   uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect        uuid NOT NULL REFERENCES prospects(id) ON DELETE RESTRICT,
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  -- The command id, or Promote's correlation id. No foreign key: Promote writes no receipt.
  correlation_id  uuid NOT NULL,
  from_status     text CHECK (from_status IN ('lead', 'contacted', 'proposal', 'closed-won', 'closed-lost')),
  to_status       text NOT NULL CHECK (to_status IN ('lead', 'contacted', 'proposal', 'closed-won', 'closed-lost')),
  cause           text NOT NULL CHECK (cause IN ('contact', 'manual', 'closed_lost', 'reopen', 'promotion')),
  lost_reason     text CHECK (lost_reason IN ('not_interested', 'no_budget', 'too_expensive', 'chose_competitor',
                                              'not_a_fit', 'unreachable', 'wrong_contact', 'timing', 'duplicate', 'other')),
  contact_id      uuid REFERENCES prospect_contacts(contact_id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transition_changes_something CHECK (from_status IS DISTINCT FROM to_status),
  -- Nobody leaves a win in 2A: a won prospect is a client.
  CONSTRAINT transition_never_leaves_closed_won CHECK (from_status IS DISTINCT FROM 'closed-won'),
  CONSTRAINT transition_lost_reason_iff_closed_lost CHECK ((to_status = 'closed-lost') = (lost_reason IS NOT NULL)),
  CONSTRAINT transition_promotion_iff_closed_won CHECK ((to_status = 'closed-won') = (cause = 'promotion')),
  CONSTRAINT transition_closed_lost_cause CHECK ((to_status = 'closed-lost') = (cause = 'closed_lost')),
  CONSTRAINT transition_reopen_cause CHECK (
    (COALESCE(from_status = 'closed-lost', false) AND to_status IN ('lead', 'contacted', 'proposal')) = (cause = 'reopen')),
  CONSTRAINT transition_contact_cause CHECK (cause NOT IN ('contact', 'manual') OR (cause = 'contact') = (contact_id IS NOT NULL))
);
CREATE INDEX prospect_stage_transitions_timeline ON prospect_stage_transitions (prospect, recorded_at DESC);

-- ─── 5 · row-level security ───────────────────────────────────────────────────────────────────

ALTER TABLE prospect_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE prospect_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE prospect_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_followups FORCE ROW LEVEL SECURITY;
ALTER TABLE prospect_stage_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_stage_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY prospect_command_receipts_read ON prospect_command_receipts FOR SELECT TO ascend_owner, ascend_sales
  USING (organization_id = current_org());
CREATE POLICY prospect_command_receipts_insert ON prospect_command_receipts FOR INSERT TO ascend_owner, ascend_sales
  WITH CHECK (organization_id = current_org() AND actor_user_id = current_user_id());

CREATE POLICY prospect_contacts_read ON prospect_contacts FOR SELECT TO ascend_owner, ascend_sales
  USING (organization_id = current_org());
CREATE POLICY prospect_stage_transitions_read ON prospect_stage_transitions FOR SELECT TO ascend_owner, ascend_sales
  USING (organization_id = current_org());

CREATE POLICY prospect_followups_read ON prospect_followups FOR SELECT TO ascend_owner, ascend_sales
  USING (organization_id = current_org());
-- Created as oneself, on an anchored, unarchived, not-closed prospect of this organization. Sales
-- schedules only for itself; the owner for any enabled member.
CREATE POLICY prospect_followups_insert_owner ON prospect_followups FOR INSERT TO ascend_owner
  WITH CHECK (organization_id = current_org() AND created_by = current_user_id() AND state = 'open'
    AND EXISTS (SELECT 1 FROM prospects p WHERE p.id = prospect AND p.organization_id = current_org()
                AND p.identity_state = 'anchored' AND p.archived_at IS NULL
                AND p.status IS DISTINCT FROM 'closed-won' AND p.status IS DISTINCT FROM 'closed-lost')
    AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.user_id = assignee_user_id AND m.organization_id = current_org() AND u.disabled_at IS NULL));
CREATE POLICY prospect_followups_insert_sales ON prospect_followups FOR INSERT TO ascend_sales
  WITH CHECK (organization_id = current_org() AND created_by = current_user_id() AND state = 'open'
    AND assignee_user_id = current_user_id()
    AND EXISTS (SELECT 1 FROM prospects p WHERE p.id = prospect AND p.organization_id = current_org()
                AND p.identity_state = 'anchored' AND p.archived_at IS NULL
                AND p.status IS DISTINCT FROM 'closed-won' AND p.status IS DISTINCT FROM 'closed-lost'));
-- Only an OPEN follow-up can change, and once it leaves `open` it records who resolved it.
CREATE POLICY prospect_followups_update_owner ON prospect_followups FOR UPDATE TO ascend_owner
  USING (organization_id = current_org() AND state = 'open')
  WITH CHECK (organization_id = current_org() AND (state = 'open' OR resolved_by = current_user_id())
    AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.user_id = assignee_user_id AND m.organization_id = current_org() AND u.disabled_at IS NULL));
CREATE POLICY prospect_followups_update_sales ON prospect_followups FOR UPDATE TO ascend_sales
  USING (organization_id = current_org() AND state = 'open' AND assignee_user_id = current_user_id())
  WITH CHECK (organization_id = current_org() AND assignee_user_id = current_user_id()
    AND (state = 'open' OR resolved_by = current_user_id()));

-- ─── 6 · grants on the new tables ─────────────────────────────────────────────────────────────
--
-- No UPDATE or DELETE on any history table for any application role; contacts and transitions are
-- written only by the guarded functions, so the application roles may only read them.

GRANT SELECT, INSERT ON prospect_command_receipts TO ascend_owner, ascend_sales;
GRANT SELECT ON prospect_contacts TO ascend_owner, ascend_sales;
GRANT SELECT ON prospect_stage_transitions TO ascend_owner, ascend_sales;
GRANT SELECT, INSERT ON prospect_followups TO ascend_owner, ascend_sales;
GRANT UPDATE (state, resolved_by, resolved_at, resolved_by_command, resolved_by_contact, superseded_by)
  ON prospect_followups TO ascend_owner, ascend_sales;
-- The owner's follow-up EDIT (2A.1b decision 1): what, when, and for whom — on an OPEN row only (the
-- update policy's USING), never the resolution record. Sales holds none of these.
GRANT UPDATE (assignee_user_id, action, due_on, due_at, note) ON prospect_followups TO ascend_owner;
-- ascend_automation is granted NOTHING here: these are records of human judgment.

-- ─── 7 · the four guarded columns of `prospects` ──────────────────────────────────────────────

REVOKE UPDATE (status, assigned_to, first_contact, last_contact) ON prospects FROM ascend_sales;

-- The owner held table-level UPDATE (001). A column cannot be revoked out of a table-level grant, so
-- the table grant is replaced by column grants on EVERY OTHER column — nothing else widened or
-- narrowed (the list is the 001–009 catalog minus the four guarded columns).
REVOKE UPDATE ON prospects FROM ascend_owner;
GRANT UPDATE (id, organization_id, prospect_id, identity_state, hold_reason, slug, name, business_type,
              location, website, contact_name, contact_phone, contact_email, source, website_quality,
              website_opportunity, assessed_by, assessed_at, created_by, created_at, updated_at,
              decision_maker_access, project_urgency, niche_alignment, notes, archived_at, archived_by)
  ON prospects TO ascend_owner;

-- ─── 8 · guarded functions ────────────────────────────────────────────────────────────────────

-- The bound actor, re-validated from the canonical membership row. Returns that row's role.
CREATE FUNCTION public.ascend_guard_actor(p_actor uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
BEGIN
  IF public.current_org() IS NULL THEN
    RAISE EXCEPTION 'ascend: no organization is bound to this transaction' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM public.current_user_id() THEN
    RAISE EXCEPTION 'ascend: the actor is not the user bound to this transaction' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_role
    FROM public.memberships m JOIN public.users u ON u.id = m.user_id
   WHERE m.user_id = p_actor AND m.organization_id = public.current_org() AND u.disabled_at IS NULL;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'ascend: the actor is not an enabled member of this organization' USING ERRCODE = '42501';
  END IF;
  RETURN v_role;
END $$;

-- The prospect, locked, in this organization, anchored and not archived.
CREATE FUNCTION public.ascend_guard_prospect(p_prospect uuid) RETURNS public.prospects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.prospects;
BEGIN
  SELECT * INTO v_row FROM public.prospects
   WHERE id = p_prospect AND organization_id = public.current_org()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ascend: no such prospect in this organization' USING ERRCODE = '42501';
  END IF;
  IF v_row.identity_state <> 'anchored' THEN
    RAISE EXCEPTION 'ascend: held_prospect' USING ERRCODE = '42501';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'ascend: archived_prospect' USING ERRCODE = '42501';
  END IF;
  RETURN v_row;
END $$;

-- One contact, and the projections it moves: first_contact only earlier, last_contact only later.
CREATE FUNCTION public.ascend_record_contact(
  p_prospect uuid, p_actor uuid, p_contact_id uuid, p_command_id uuid,
  p_outcome text, p_channel text, p_note text, p_happened_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_row public.prospects;
  v_at timestamptz := COALESCE(p_happened_at, now());
  v_day date := (COALESCE(p_happened_at, now()) AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  v_role := public.ascend_guard_actor(p_actor);
  v_row := public.ascend_guard_prospect(p_prospect);
  INSERT INTO public.prospect_contacts
    (contact_id, organization_id, prospect, command_id, author_user_id, outcome, channel, note, happened_at)
  VALUES (p_contact_id, public.current_org(), p_prospect, p_command_id, p_actor, p_outcome, p_channel, p_note, v_at);
  UPDATE public.prospects
     SET first_contact = LEAST(COALESCE(first_contact, v_day), v_day),
         last_contact  = GREATEST(COALESCE(last_contact, v_day), v_day),
         updated_at    = now()
   WHERE id = p_prospect AND organization_id = public.current_org();
END $$;

-- One stage change, with exactly one transition row, under compare-and-set on the stage the caller saw.
CREATE FUNCTION public.ascend_transition_stage(
  p_prospect uuid, p_actor uuid, p_transition_id uuid, p_correlation_id uuid,
  p_expected_from text, p_to text, p_cause text, p_lost_reason text, p_contact_id uuid,
  p_touch_last_contact boolean
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_row public.prospects;
BEGIN
  v_role := public.ascend_guard_actor(p_actor);
  v_row := public.ascend_guard_prospect(p_prospect);
  IF v_row.status IS DISTINCT FROM p_expected_from THEN
    RETURN 'stage_conflict';
  END IF;
  IF p_cause = 'reopen' AND v_role <> 'owner' THEN
    RAISE EXCEPTION 'ascend: reopen_not_permitted' USING ERRCODE = '42501';
  END IF;
  -- The CHECKs on the table hold cause, reason and stage together; this insert fails if they disagree.
  INSERT INTO public.prospect_stage_transitions
    (transition_id, organization_id, prospect, actor_user_id, correlation_id, from_status, to_status,
     cause, lost_reason, contact_id)
  VALUES (p_transition_id, public.current_org(), p_prospect, p_actor, p_correlation_id, v_row.status, p_to,
          p_cause, p_lost_reason, p_contact_id);
  PERFORM pg_catalog.set_config('ascend.transition_id', p_transition_id::text, true);
  UPDATE public.prospects
     SET status = p_to,
         last_contact = CASE WHEN p_touch_last_contact
                             THEN GREATEST(COALESCE(last_contact, current_date), current_date)
                             ELSE last_contact END,
         updated_at = now()
   WHERE id = p_prospect AND organization_id = public.current_org();
  PERFORM pg_catalog.set_config('ascend.transition_id', '', true);
  RETURN 'applied';
END $$;

-- Claim (self, only if unassigned), reassign and unassign (owner, compare-and-set on the expected assignee).
CREATE FUNCTION public.ascend_assign_prospect(
  p_prospect uuid, p_actor uuid, p_mode text, p_expected uuid, p_to uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_row public.prospects;
BEGIN
  v_role := public.ascend_guard_actor(p_actor);
  v_row := public.ascend_guard_prospect(p_prospect);
  IF p_mode = 'claim' THEN
    IF p_to IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'ascend: a claim assigns the claimant and no one else' USING ERRCODE = '42501';
    END IF;
    IF v_row.assigned_to = p_actor THEN RETURN 'already_yours'; END IF;
    IF v_row.assigned_to IS NOT NULL THEN RETURN 'already_assigned'; END IF;
  ELSIF p_mode IN ('reassign', 'unassign') THEN
    IF v_role <> 'owner' THEN
      RAISE EXCEPTION 'ascend: assignment_not_permitted' USING ERRCODE = '42501';
    END IF;
    IF v_row.assigned_to IS DISTINCT FROM p_expected THEN RETURN 'assignment_conflict'; END IF;
    IF p_mode = 'unassign' AND p_to IS NOT NULL THEN
      RAISE EXCEPTION 'ascend: unassign takes no assignee' USING ERRCODE = '42501';
    END IF;
    IF p_mode = 'reassign' AND NOT EXISTS (
         SELECT 1 FROM public.memberships m JOIN public.users u ON u.id = m.user_id
          WHERE m.user_id = p_to AND m.organization_id = public.current_org() AND u.disabled_at IS NULL) THEN
      RAISE EXCEPTION 'ascend: the assignee is not an enabled member of this organization' USING ERRCODE = '42501';
    END IF;
    IF v_row.assigned_to IS NOT DISTINCT FROM p_to THEN RETURN 'unchanged'; END IF;
  ELSE
    RAISE EXCEPTION 'ascend: unknown assignment mode' USING ERRCODE = '22023';
  END IF;
  UPDATE public.prospects SET assigned_to = p_to, updated_at = now()
   WHERE id = p_prospect AND organization_id = public.current_org();
  RETURN 'applied';
END $$;

-- ─── 9 · every status change names its transition — for every role ────────────────────────────
--
-- The application roles cannot UPDATE `status` at all after §7. This covers the rest: the table
-- owner and maintenance sessions. A status change must name, through the transaction-local setting
-- only `ascend_transition_stage` writes, a transition row for this prospect with exactly this change.

CREATE FUNCTION public.ascend_status_has_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_id text := pg_catalog.current_setting('ascend.transition_id', true);
BEGIN
  IF v_id IS NULL OR v_id = '' OR NOT EXISTS (
       SELECT 1 FROM public.prospect_stage_transitions t
        WHERE t.transition_id = v_id::uuid AND t.prospect = NEW.id
          AND t.from_status IS NOT DISTINCT FROM OLD.status AND t.to_status = NEW.status) THEN
    RAISE EXCEPTION 'ascend: a stage change needs its transition record (use ascend_transition_stage)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prospects_status_has_transition
  BEFORE UPDATE OF status ON prospects
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ascend_status_has_transition();

-- ─── 10 · who may call what ───────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.ascend_guard_actor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ascend_guard_prospect(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ascend_status_has_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ascend_record_contact(uuid, uuid, uuid, uuid, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ascend_assign_prospect(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ascend_record_contact(uuid, uuid, uuid, uuid, text, text, text, timestamptz) TO ascend_owner, ascend_sales;
GRANT EXECUTE ON FUNCTION public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean) TO ascend_owner, ascend_sales;
GRANT EXECUTE ON FUNCTION public.ascend_assign_prospect(uuid, uuid, text, uuid, uuid) TO ascend_owner, ascend_sales;

-- Supabase's API roles, where they exist (production), lose everything the default privileges
-- handed them on the objects above. Static statements; each runs only if its role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON prospect_command_receipts, prospect_contacts, prospect_followups, prospect_stage_transitions FROM anon;
    REVOKE ALL ON FUNCTION public.ascend_guard_actor(uuid), public.ascend_guard_prospect(uuid),
      public.ascend_status_has_transition(),
      public.ascend_record_contact(uuid, uuid, uuid, uuid, text, text, text, timestamptz),
      public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean),
      public.ascend_assign_prospect(uuid, uuid, text, uuid, uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON prospect_command_receipts, prospect_contacts, prospect_followups, prospect_stage_transitions FROM authenticated;
    REVOKE ALL ON FUNCTION public.ascend_guard_actor(uuid), public.ascend_guard_prospect(uuid),
      public.ascend_status_has_transition(),
      public.ascend_record_contact(uuid, uuid, uuid, uuid, text, text, text, timestamptz),
      public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean),
      public.ascend_assign_prospect(uuid, uuid, text, uuid, uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON prospect_command_receipts, prospect_contacts, prospect_followups, prospect_stage_transitions FROM service_role;
    REVOKE ALL ON FUNCTION public.ascend_guard_actor(uuid), public.ascend_guard_prospect(uuid),
      public.ascend_status_has_transition(),
      public.ascend_record_contact(uuid, uuid, uuid, uuid, text, text, text, timestamptz),
      public.ascend_transition_stage(uuid, uuid, uuid, uuid, text, text, text, text, uuid, boolean),
      public.ascend_assign_prospect(uuid, uuid, text, uuid, uuid) FROM service_role;
  END IF;
END $$;

COMMENT ON TABLE prospect_command_receipts IS
  'One row per logical sales command: its canonical payload digest and the ids it produced. Replay '
  'and command_id_conflict are decided here. Immutable.';
COMMENT ON TABLE prospect_contacts IS
  'Contact attempts, immutable. Written only by ascend_record_contact, which also moves '
  'prospects.first_contact earlier / last_contact later.';
COMMENT ON TABLE prospect_followups IS
  'Next actions. At most one open per prospect; a resolved row never changes again.';
COMMENT ON TABLE prospect_stage_transitions IS
  'Every change of prospects.status after migration 010 — including Promote''s closed-won — exactly one '
  'row per change. Written only by ascend_transition_stage. Immutable.';
