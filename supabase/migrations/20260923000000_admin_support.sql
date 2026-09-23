-- ── Admin & Support System ────────────────────────────────────────────────────
--
-- Adds:
--   organizations.suspended_at   — nullable; set = org is suspended
--   platform_admins              — maps Top Spider Canada staff to admin role
--   support_tickets              — org-initiated support requests
--   support_messages             — threaded replies on tickets
--   credit_adjustments           — audit log for manual credit edits
--
-- Admin roles:
--   super_admin — full access: view orgs/users, edit credits, suspend orgs,
--                 reply to tickets
--   support     — ticket replies only
--
-- Security model:
--   All admin operations go through SECURITY DEFINER functions that verify
--   platform_admins membership — never direct table access from the client.

-- ── 1. organizations: add suspended_at ────────────────────────────────────────

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- ── 2. platform_admins ────────────────────────────────────────────────────────

CREATE TABLE platform_admins (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role       TEXT        NOT NULL CHECK (role IN ('super_admin', 'support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Admins can only see their own row (not each other's)
CREATE POLICY "platform_admins_select_own" ON platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 3. support_tickets ────────────────────────────────────────────────────────

CREATE TABLE support_tickets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submitted_by UUID        NOT NULL REFERENCES auth.users(id),
  subject      TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE INDEX support_tickets_org_idx ON support_tickets (org_id);

-- Org members can read tickets for their org
CREATE POLICY "support_tickets_select" ON support_tickets
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Org owner/admin can open tickets (member role cannot)
CREATE POLICY "support_tickets_insert" ON support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    AND submitted_by = auth.uid()
  );

-- Status updates go through admin_update_ticket_status() SECURITY DEFINER only;
-- no direct UPDATE allowed from clients.

-- ── 4. support_messages ───────────────────────────────────────────────────────

CREATE TABLE support_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES auth.users(id),
  sender_type TEXT        NOT NULL CHECK (sender_type IN ('user', 'admin')),
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id);

-- Org members can read messages on tickets for their org
CREATE POLICY "support_messages_select" ON support_messages
  FOR SELECT TO authenticated
  USING (
    ticket_id IN (
      SELECT st.id FROM support_tickets st
      WHERE st.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  );

-- Org owner/admin can post user-side replies
CREATE POLICY "support_messages_insert_user" ON support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'user'
    AND sender_id = auth.uid()
    AND ticket_id IN (
      SELECT st.id FROM support_tickets st
      WHERE st.org_id IN (
        SELECT org_id FROM org_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );

-- Admin replies go through admin_reply_ticket() SECURITY DEFINER only.

-- ── 5. credit_adjustments ─────────────────────────────────────────────────────

CREATE TABLE credit_adjustments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_user_id UUID        NOT NULL REFERENCES auth.users(id),
  admin_user_id  UUID        NOT NULL REFERENCES auth.users(id),
  amount         INTEGER     NOT NULL,
  reason         TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_adjustments ENABLE ROW LEVEL SECURITY;

CREATE INDEX credit_adjustments_org_idx ON credit_adjustments (org_id);

-- No direct client access — only via SECURITY DEFINER functions.

-- ── 6. is_platform_admin() ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

-- ── 7. admin_adjust_credits() ─────────────────────────────────────────────────
-- super_admin only. Adjusts the org owner's credits balance and logs the change.

CREATE OR REPLACE FUNCTION admin_adjust_credits(
  p_org_id  UUID,
  p_amount  INTEGER,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role  TEXT;
  v_owner_id     UUID;
  v_new_balance  INTEGER;
BEGIN
  -- Verify caller is super_admin
  SELECT role INTO v_caller_role
    FROM platform_admins WHERE user_id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- Resolve org owner
  SELECT owner_id INTO v_owner_id FROM organizations WHERE id = p_org_id;
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('error', 'org_not_found');
  END IF;

  -- Apply credit change (handles insert-or-update and enforces balance >= 0)
  INSERT INTO credits (user_id, balance)
    VALUES (v_owner_id, GREATEST(p_amount, 0))
    ON CONFLICT (user_id) DO UPDATE
      SET balance    = GREATEST(credits.balance + p_amount, 0),
          updated_at = NOW();

  INSERT INTO credit_transactions (user_id, amount, type)
    VALUES (v_owner_id, p_amount, 'purchase');

  -- Audit log
  INSERT INTO credit_adjustments (org_id, target_user_id, admin_user_id, amount, reason)
    VALUES (p_org_id, v_owner_id, auth.uid(), p_amount, p_reason);

  SELECT balance INTO v_new_balance FROM credits WHERE user_id = v_owner_id;
  RETURN jsonb_build_object('ok', true, 'new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_adjust_credits(UUID, INTEGER, TEXT) TO authenticated;

-- ── 8. admin_suspend_org() ────────────────────────────────────────────────────
-- super_admin only. Suspends or unsuspends an org.

CREATE OR REPLACE FUNCTION admin_suspend_org(
  p_org_id  UUID,
  p_suspend BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role
    FROM platform_admins WHERE user_id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'super_admin' THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  UPDATE organizations
     SET suspended_at = CASE WHEN p_suspend THEN NOW() ELSE NULL END
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'org_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'suspended', p_suspend);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_suspend_org(UUID, BOOLEAN) TO authenticated;

-- ── 9. admin_list_orgs() ──────────────────────────────────────────────────────
-- Any platform admin. Returns all orgs with owner email, member count,
-- credit balance, and suspension status.

CREATE OR REPLACE FUNCTION admin_list_orgs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(r))
    FROM (
      SELECT
        o.id,
        o.name,
        o.org_type,
        o.owner_id,
        u.email          AS owner_email,
        o.suspended_at,
        o.created_at,
        (SELECT COUNT(*) FROM org_members WHERE org_id = o.id)::INT AS member_count,
        COALESCE((SELECT balance FROM credits WHERE user_id = o.owner_id), 0) AS credit_balance
      FROM organizations o
      JOIN auth.users u ON u.id = o.owner_id
      ORDER BY o.created_at DESC
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_orgs() TO authenticated;

-- ── 10. admin_list_users() ────────────────────────────────────────────────────
-- Any platform admin. Returns all auth users with their org membership.

CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(r))
    FROM (
      SELECT
        u.id,
        u.email,
        u.created_at,
        u.last_sign_in_at,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'org_id',   om.org_id,
            'org_name', o.name,
            'role',     om.role
          ))
          FROM org_members om
          JOIN organizations o ON o.id = om.org_id
          WHERE om.user_id = u.id
        ) AS orgs
      FROM auth.users u
      ORDER BY u.created_at DESC
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;

-- ── 11. admin_get_tickets() ───────────────────────────────────────────────────
-- Any platform admin. Returns all tickets with org name and submitter email.

CREATE OR REPLACE FUNCTION admin_get_tickets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(r))
    FROM (
      SELECT
        t.id,
        t.subject,
        t.status,
        t.created_at,
        t.updated_at,
        o.name   AS org_name,
        o.id     AS org_id,
        u.email  AS submitted_by_email
      FROM support_tickets t
      JOIN organizations o ON o.id = t.org_id
      JOIN auth.users    u ON u.id = t.submitted_by
      ORDER BY
        CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        t.updated_at DESC
    ) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_tickets() TO authenticated;

-- ── 12. admin_get_ticket_thread() ─────────────────────────────────────────────
-- Any platform admin. Returns a single ticket + all its messages.

CREATE OR REPLACE FUNCTION admin_get_ticket_thread(p_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'ticket',   row_to_json(t),
      'messages', COALESCE((
        SELECT jsonb_agg(row_to_json(m) ORDER BY m.created_at)
        FROM (
          SELECT sm.id, sm.sender_type, sm.body, sm.created_at,
                 u.email AS sender_email
          FROM support_messages sm
          JOIN auth.users u ON u.id = sm.sender_id
          WHERE sm.ticket_id = p_ticket_id
        ) m
      ), '[]'::jsonb)
    )
    FROM (
      SELECT st.id, st.subject, st.status, st.created_at, st.updated_at,
             o.name AS org_name, sub.email AS submitted_by_email
      FROM support_tickets st
      JOIN organizations o  ON o.id  = st.org_id
      JOIN auth.users    sub ON sub.id = st.submitted_by
      WHERE st.id = p_ticket_id
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_ticket_thread(UUID) TO authenticated;

-- ── 13. admin_reply_ticket() ──────────────────────────────────────────────────
-- Any platform admin. Posts an admin reply and bumps ticket to in_progress.

CREATE OR REPLACE FUNCTION admin_reply_ticket(
  p_ticket_id UUID,
  p_body      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role
    FROM platform_admins WHERE user_id = auth.uid();
  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  INSERT INTO support_messages (ticket_id, sender_id, sender_type, body)
    VALUES (p_ticket_id, auth.uid(), 'admin', p_body);

  UPDATE support_tickets
     SET status     = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
         updated_at = NOW()
   WHERE id = p_ticket_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reply_ticket(UUID, TEXT) TO authenticated;

-- ── 14. admin_update_ticket_status() ─────────────────────────────────────────
-- Any platform admin. Sets ticket status directly (e.g. mark resolved).

CREATE OR REPLACE FUNCTION admin_update_ticket_status(
  p_ticket_id UUID,
  p_status    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_status NOT IN ('open', 'in_progress', 'resolved') THEN
    RETURN jsonb_build_object('error', 'invalid_status');
  END IF;

  UPDATE support_tickets
     SET status = p_status, updated_at = NOW()
   WHERE id = p_ticket_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_ticket_status(UUID, TEXT) TO authenticated;
