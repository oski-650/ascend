-- 008_prospect_notes_log — THE OPERATOR'S RUNNING LOG, as rows rather than as one blob.
--
-- NOT APPLIED TO PRODUCTION BY THIS FILE. Like 007, applying it is a further authorization that
-- writing it does not carry.
--
-- ─── WHY A TABLE WHEN `prospects.notes` ALREADY EXISTS ─────────────────────────────────────────
--
-- 003 added `prospects.notes` and said exactly what it is: *"The prospect markdown body: call log,
-- friction, objections — human-authored qualitative notes. Carried verbatim from the vault."* It is
-- ONE text field holding a document that came from a markdown file, and it stays that.
--
-- It cannot answer the questions a CRM note has to answer. A single column has no author, no time,
-- and no second version — so "who said this, and when" is unanswerable, and every save overwrites
-- what the last person wrote. With two operators (2G.4.7 made the sales partner a real writer) that
-- is a lost-update bug waiting for the first Monday two people touch the same prospect.
--
-- So the vault body keeps its column, and new operator notes are appended here as rows. Nothing
-- migrates: the existing bodies are not retroactively split into fake entries with invented
-- authors and invented timestamps, because a reconstructed author is not an observed one. The
-- prospect page renders both — the imported body as the record's history, these as its log.
--
-- ─── APPEND-ONLY FOR SALES, AND WHY THAT IS NOT MERELY TIDINESS ────────────────────────────────
--
-- No UPDATE grant exists on this table for anyone. A note is a record that a person wrote something
-- at a time; editing it in place would make the log say they wrote something else, which is the
-- same class of rewrite `events_are_append_only` refuses one table over. DELETE is granted to
-- `ascend_owner` alone — a typo can be removed by the person who owns the account, and a removal is
-- visible as an absence rather than disguised as a correction.
--
-- ─── AUTOMATION GETS NOTHING HERE. NOT EVEN SELECT. ────────────────────────────────────────────
--
-- 003's rule, carried forward and made stricter: *"Automation must never write here; the research
-- layer records findings with evidence, and prose in the operator's voice is not a finding."* The
-- research runner has `events` for what it finds. It has no reason to read the operator's private
-- assessment of a lead and no route to write in that voice, so it holds no grant on this table at
-- all — the narrowest grant that satisfies the requirement, per the same reasoning 001 used to
-- withhold the judgment columns.
--
-- ─── THE FOREIGN KEY POINTS AT THE ROW, NOT AT THE ANCHOR, AND THAT IS A TRADE ─────────────────
--
-- `prospects.prospect_id` is the D-4 business identity and is UNIQUE, so it could carry this key.
-- It is NOT used, for one reason: it is NULL on every `held` prospect, and a held record — one the
-- matcher could not safely resolve — is precisely the record an operator most needs to annotate
-- ("this is the same firm as #412, do not merge"). Keying on the anchor would make notes impossible
-- on exactly those rows.
--
-- The cost is stated rather than hidden: keyed on the surrogate `id`, a note follows the ROW. If a
-- prospect is deleted and later re-imported it is a new row, and these notes do not come back with
-- it — they cascade away with the original. That is the correct reading of a note as an annotation
-- ON A RECORD, and it is the behaviour a reviewer should expect from `ON DELETE CASCADE` below.

CREATE TABLE prospect_notes (
  note_id         uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The annotated row. See the trade recorded above before changing this to `prospect_id`.
  prospect        uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  -- WHO WROTE IT, always. There is no nullable author and no `system` author: this table holds the
  -- operator's voice, and a note with no person behind it would be the machine speaking in it.
  author_user_id  uuid NOT NULL REFERENCES users(id),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- An empty note is not a note. Whitespace-only is the same fact, so it is refused the same way.
  CONSTRAINT note_body_is_stated CHECK (btrim(body) <> '')
);

-- The page reads one prospect's log, newest first. That is the only access pattern this table has.
CREATE INDEX prospect_notes_by_prospect ON prospect_notes (prospect, created_at DESC);

ALTER TABLE prospect_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_notes FORCE ROW LEVEL SECURITY;

-- Readable within the organization by the two human roles.
CREATE POLICY prospect_notes_read ON prospect_notes FOR SELECT
  USING (organization_id = current_org());

CREATE POLICY prospect_notes_write_owner ON prospect_notes FOR ALL TO ascend_owner
  USING (organization_id = current_org()) WITH CHECK (organization_id = current_org());

-- SALES MAY ONLY APPEND, AND ONLY AS THEMSELVES. `author_user_id = current_user_id()` is the half
-- that matters: without it a sales principal could post a note under the owner's name, and the log
-- would attribute a judgment to someone who never made it.
CREATE POLICY prospect_notes_append_sales ON prospect_notes FOR INSERT TO ascend_sales
  WITH CHECK (organization_id = current_org() AND author_user_id = current_user_id());

GRANT SELECT, INSERT ON prospect_notes TO ascend_owner, ascend_sales;
GRANT DELETE ON prospect_notes TO ascend_owner;
-- ascend_automation is granted NOTHING here, deliberately. See the header.

COMMENT ON TABLE prospect_notes IS
  'Operator-authored notes on a prospect, appended over time. Human voice only: automation holds no '
  'grant. Append-only — no UPDATE grant exists for any role; owner may DELETE.';
