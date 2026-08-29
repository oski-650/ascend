-- Ascend OS · prospect notes (Stage 2C prerequisite — a Stage 2B gap)
--
-- WHAT WAS MISSED, and how. Stage 2B's behavioural ledger compared frontmatter fields and scores and
-- reported parity. It never compared the markdown BODY, and the migration never carried it — so the
-- ledger agreed with itself while the operator's call log and friction notes were being dropped.
--
-- The consumer inventory for the read flip is what found it. Two modules read `Prospect.body`:
--
--   app/sales/[prospect]/page.tsx:246   renders the call log and notes
--   lib/compileTargetContext.ts:27      uses the call log as AI context
--
-- Flipping reads without this column would have silently deleted every qualitative note a human had
-- written — invisible to a row count, invisible to a field diff, and invisible to the ledger as it
-- was scoped. That is the exact class of failure the ledger exists to catch, missed because the
-- ledger's own field list was incomplete.
--
-- The lesson is not "add a column". It is that a parity ledger is only as good as its inventory, and
-- the inventory has to come from tracing CONSUMERS rather than from listing what the schema happens
-- to hold.

ALTER TABLE prospects ADD COLUMN notes text;

COMMENT ON COLUMN prospects.notes IS
  'The prospect markdown body: call log, friction, objections — human-authored qualitative notes. '
  'Carried verbatim from the vault. Automation must never write here; the research layer records '
  'findings with evidence, and prose in the operator''s voice is not a finding.';

-- Sales may maintain their own notes. Automation may NOT: this is the operator''s voice, and a
-- research runner writing into it is how machine output starts reading as human analysis.
GRANT UPDATE (notes) ON prospects TO ascend_sales;
