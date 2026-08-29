-- Ascend OS · prospect field completion (Stage 2B prerequisite)
--
-- WHY THIS EXISTS. Stage 2A modelled the prospect columns the substrate itself needed. Tracing the
-- live vault for Stage 2B found five frontmatter keys present on all six prospects that the table
-- could not hold — and three of them are SCORING INPUTS:
--
--   decision_maker_access   +25 in computeScore
--   project_urgency         +25 when 'high'
--   niche_alignment         +20
--   first_contact           sales history
--   last_contact            sales history
--
-- Migrating without them would have silently changed every prospect's score, which is exactly the
-- "no prospect fields change during serialization" failure the parity gate exists to catch. It was
-- caught by tracing the vault rather than by trusting the Stage 2A schema.
--
-- ABSENCE STAYS ABSENCE, as everywhere else: all five are nullable with NO default. `false` is a
-- claim ("we checked and there is no decision-maker access"), and an unstated boolean is not false.
-- The vault's own importer already learned this — a defaulted field became evidence (D-1).

ALTER TABLE prospects
  ADD COLUMN decision_maker_access boolean,
  ADD COLUMN project_urgency       text CHECK (project_urgency IN ('low','medium','high')),
  ADD COLUMN niche_alignment       boolean,
  ADD COLUMN first_contact         date,
  ADD COLUMN last_contact          date;

-- Both writing roles may maintain sales-history and qualification fields; automation may not.
-- `decision_maker_access`, `project_urgency` and `niche_alignment` are HUMAN QUALIFICATION —
-- judgments a salesperson forms on a call, not facts a crawler can establish. Withholding them from
-- `ascend_automation` puts them in the same class as `website_opportunity`: a research path cannot
-- write them even if a future code path tried.
GRANT UPDATE (decision_maker_access, project_urgency, niche_alignment, first_contact, last_contact)
  ON prospects TO ascend_sales;

-- DOCUMENTED IN THE DATABASE, not only in code, because this is the distinction most likely to be
-- misread by whoever queries this table next.
COMMENT ON COLUMN prospects.created_at IS
  'Row insert time. AUDIT METADATA, NOT A BUSINESS FACT: it does not claim when the prospect was '
  'created or first contacted. Business origin is derived from the event spine, and for records '
  'migrated from the vault no prospect.created event exists — their origin is UNKNOWN, not the '
  'migration timestamp.';
COMMENT ON COLUMN prospects.prospect_id IS
  'The immutable business identity anchor (Stage 0.5 D-4). NULL for a held record. The surrogate '
  '"id" column is NOT identity and must never be used as one.';
