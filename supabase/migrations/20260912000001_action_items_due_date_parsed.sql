-- Split action_items.due_date into display text + parsed date.
-- due_date_text: prose as generated ("Prior to October 20, 2026 meeting")
-- due_date_parsed: ISO date when unambiguously inferrable, null otherwise
-- This allows overdue-item computation without parsing prose at query time.

ALTER TABLE action_items RENAME COLUMN due_date TO due_date_text;
ALTER TABLE action_items ADD COLUMN due_date_parsed DATE;

-- Partial index: only rows where a parsed date exists, scoped to org for
-- the overdue-items dashboard query (org_id, due_date_parsed < now()).
CREATE INDEX action_items_overdue_idx
  ON action_items (org_id, due_date_parsed)
  WHERE due_date_parsed IS NOT NULL AND status != 'completed';
