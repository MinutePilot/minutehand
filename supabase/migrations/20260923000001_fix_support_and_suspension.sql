-- ── Fix: org-side ticket thread + server-side suspension enforcement ──────────
--
-- Part A — org_get_ticket_thread(p_ticket_id)
--   Org owners/admins need their own ticket-thread function that checks org
--   membership instead of platform_admin. The admin version gates on
--   is_platform_admin() so org users always got 'forbidden'.
--   No internal-notes filtering is needed here because that feature doesn't
--   exist yet; if it's added later, filter sender_type = 'internal' in this
--   function before exposing messages to the org side.
--
-- Part B — server-side suspension enforcement
--   Client-side checks keep the UI clean but a suspended org can still hit
--   Supabase directly with a valid session. Real enforcement belongs in the
--   DB layer so no client bypass is possible.
--
--   1. check_and_deduct_credit — the credit gate before every Claude generation.
--      If the billing user's org is suspended, return FALSE without deducting.
--      This is the highest-value choke point.
--
--   2. RESTRICTIVE policy on meetings INSERT — prevents writing new meeting
--      rows for a suspended org even if the client bypasses the app entirely.
--      AS RESTRICTIVE means it ANDs with permissive policies; a suspended org
--      fails even when the membership check passes.
--
--   3. Support tickets are deliberately excluded — a suspended org must still
--      be able to ask why they were suspended. No suspension guard on
--      support_tickets or support_messages.

-- ── Part A: org_get_ticket_thread() ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION org_get_ticket_thread(p_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Verify the ticket belongs to an org the caller is a member of
  SELECT st.org_id INTO v_org_id
    FROM support_tickets st
   WHERE st.id = p_ticket_id
     AND st.org_id IN (
       SELECT org_id FROM org_members WHERE user_id = auth.uid()
     );

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'ticket',   row_to_json(t),
      'messages', COALESCE((
        SELECT jsonb_agg(row_to_json(m) ORDER BY m.created_at)
        FROM (
          SELECT sm.id,
                 sm.sender_type,
                 sm.body,
                 sm.created_at
          FROM support_messages sm
          WHERE sm.ticket_id = p_ticket_id
          -- No 'internal' sender_type exists yet; add filter here when it does.
        ) m
      ), '[]'::jsonb)
    )
    FROM (
      SELECT st.id,
             st.subject,
             st.status,
             st.created_at,
             st.updated_at
      FROM support_tickets st
      WHERE st.id = p_ticket_id
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION org_get_ticket_thread(UUID) TO authenticated;

-- ── Part B-1: update check_and_deduct_credit to block suspended orgs ─────────

CREATE OR REPLACE FUNCTION check_and_deduct_credit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  -- Block if the billing user belongs to any suspended org
  IF EXISTS (
    SELECT 1
      FROM org_members om
      JOIN organizations o ON o.id = om.org_id
     WHERE om.user_id = p_user_id
       AND o.suspended_at IS NOT NULL
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT balance INTO v_balance FROM credits WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < 1 THEN RETURN FALSE; END IF;
  UPDATE credits SET balance = balance - 1, updated_at = NOW() WHERE user_id = p_user_id;
  INSERT INTO credit_transactions (user_id, amount, type) VALUES (p_user_id, -1, 'use');
  RETURN TRUE;
END;
$$;

-- ── Part B-2: RESTRICTIVE policy blocking meetings INSERT for suspended orgs ──
-- AS RESTRICTIVE: this policy ANDs with all permissive policies so it cannot
-- be bypassed by any existing permissive grant.

CREATE POLICY "block_suspended_org_meetings" ON meetings
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM organizations
       WHERE id = org_id
         AND suspended_at IS NOT NULL
    )
  );
