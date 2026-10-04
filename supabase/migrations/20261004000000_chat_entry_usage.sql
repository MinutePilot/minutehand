-- Daily cap for the workspace chat assistant (edge function chat-entry).
-- One counter per organization per UTC day. Only the edge function (service role) touches it.

CREATE TABLE IF NOT EXISTS chat_entry_usage (
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  calls      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, usage_date)
);

ALTER TABLE chat_entry_usage ENABLE ROW LEVEL SECURITY;   -- no policies: nobody but the service role

-- Counts one message and says whether it is within the cap. Atomic, so two messages
-- arriving together cannot both take the last slot.
CREATE OR REPLACE FUNCTION take_chat_entry_slot(p_org UUID, p_cap INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO chat_entry_usage (org_id, usage_date, calls)
  VALUES (p_org, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (org_id, usage_date)
    DO UPDATE SET calls = chat_entry_usage.calls + 1
    WHERE chat_entry_usage.calls < p_cap
  RETURNING calls INTO n;
  RETURN n IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION take_chat_entry_slot(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION take_chat_entry_slot(UUID, INTEGER) TO service_role;
