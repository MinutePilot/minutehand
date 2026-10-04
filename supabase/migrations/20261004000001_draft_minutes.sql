-- Draft and approve (workspace step 8).
--
-- 1. meeting_versions.draft: the approved draft as structured data, with a snapshot of what the
--    record rendering needs. The council's full record (in camera items included) lives ONLY here,
--    never in meetings.markdown or the version's markdown/html, because the existing dashboard
--    publishes those. Nullable, so every existing version is unchanged.
-- 2. A daily cap for drafting, per organization, like the chat cap.

ALTER TABLE meeting_versions ADD COLUMN IF NOT EXISTS draft JSONB;

CREATE TABLE IF NOT EXISTS draft_usage (
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  calls      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, usage_date)
);

ALTER TABLE draft_usage ENABLE ROW LEVEL SECURITY;   -- no policies: nobody but the service role

CREATE OR REPLACE FUNCTION take_draft_slot(p_org UUID, p_cap INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO draft_usage (org_id, usage_date, calls)
  VALUES (p_org, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (org_id, usage_date)
    DO UPDATE SET calls = draft_usage.calls + 1
    WHERE draft_usage.calls < p_cap
  RETURNING calls INTO n;
  RETURN n IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION take_draft_slot(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION take_draft_slot(UUID, INTEGER) TO service_role;
