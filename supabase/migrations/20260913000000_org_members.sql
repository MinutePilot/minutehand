-- ── Multi-user org access ─────────────────────────────────────────────────────
--
-- Adds:
--   org_members      — maps authenticated users to an org with a role
--   org_invitations  — short-lived invite tokens for copy-paste sharing
--
-- Role model:
--   owner  — created the org; full access + billing authority
--   admin  — President / Secretary / Treasurer level; full app access
--   member — other council members; view + generate, cannot invite/delete
--
-- Credits: shared pool — all members draw from the org owner's credit balance.
--   get_billing_user_id(p_user_id) resolves the correct billing user.
--   check_and_deduct_credit already exists; we just change who we call it for.
--
-- RLS migration strategy:
--   All existing policies gated on  organizations.owner_id = auth.uid()
--   or  meetings.user_id = auth.uid()  are replaced with membership checks
--   against org_members.  The owner row is seeded automatically below.
--
-- Backward compat: existing orgs get their owner seeded into org_members so
--   existing users experience no change.

-- ── org_members ───────────────────────────────────────────────────────────────

CREATE TABLE org_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  email       TEXT,       -- cached from auth.users for display without service-role access
  invited_by  UUID        REFERENCES auth.users(id),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Members can see who else is in their org
CREATE POLICY "org_members_select" ON org_members
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Only admins/owners can insert (invite) new members
CREATE POLICY "org_members_insert" ON org_members
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Owners/admins can update roles; members can remove themselves
CREATE POLICY "org_members_update" ON org_members
  FOR UPDATE TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Owners/admins can remove members; members can remove themselves
CREATE POLICY "org_members_delete" ON org_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE INDEX org_members_user_idx ON org_members (user_id);
CREATE INDEX org_members_org_idx  ON org_members (org_id);

-- ── Seed existing org owners into org_members ─────────────────────────────────

INSERT INTO org_members (org_id, user_id, role, email)
SELECT o.id, o.owner_id, 'owner', u.email
FROM   organizations o
JOIN   auth.users u ON u.id = o.owner_id
ON CONFLICT (org_id, user_id) DO NOTHING;

-- ── Trigger: auto-add owner to org_members on org creation ────────────────────

CREATE OR REPLACE FUNCTION fn_org_created_add_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO org_members (org_id, user_id, role, email)
  VALUES (
    NEW.id, NEW.owner_id, 'owner',
    (SELECT email FROM auth.users WHERE id = NEW.owner_id)
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_created_add_owner
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION fn_org_created_add_owner();

-- ── org_invitations ───────────────────────────────────────────────────────────

CREATE TABLE org_invitations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role           TEXT        NOT NULL DEFAULT 'member'
                 CHECK (role IN ('admin', 'member')),
  token          TEXT        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invitee_email  TEXT,       -- optional note for the inviter's reference
  created_by     UUID        NOT NULL REFERENCES auth.users(id),
  used_by        UUID        REFERENCES auth.users(id),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

-- Admins/owners can see invitations for their org
CREATE POLICY "org_invitations_select" ON org_invitations
  FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Admins/owners can create invitations
CREATE POLICY "org_invitations_insert" ON org_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Allow any authenticated user to redeem an unused, unexpired invite
-- (update used_by / used_at); the accept_invitation function enforces this.
CREATE POLICY "org_invitations_update_redeem" ON org_invitations
  FOR UPDATE TO authenticated
  USING  (used_by IS NULL AND expires_at > NOW())
  WITH CHECK (used_by = auth.uid());

CREATE INDEX org_invitations_token_idx  ON org_invitations (token);
CREATE INDEX org_invitations_org_idx    ON org_invitations (org_id);

-- ── accept_invitation(token) ─────────────────────────────────────────────────
-- SECURITY DEFINER so it can write to both org_members and org_invitations
-- atomically without giving the anon/authenticated role direct write access
-- beyond what the policies above allow.

CREATE OR REPLACE FUNCTION accept_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite  org_invitations%ROWTYPE;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  -- Lock the row to prevent double-use
  SELECT * INTO v_invite
    FROM org_invitations
   WHERE token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF v_invite.used_by IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_used');
  END IF;

  IF v_invite.expires_at < NOW() THEN
    RETURN jsonb_build_object('error', 'expired');
  END IF;

  -- If user is already a member of this org, just return success
  IF EXISTS (
    SELECT 1 FROM org_members
     WHERE org_id = v_invite.org_id AND user_id = v_user_id
  ) THEN
    UPDATE org_invitations
       SET used_by = v_user_id, used_at = NOW()
     WHERE id = v_invite.id;
    RETURN jsonb_build_object('ok', true, 'org_id', v_invite.org_id, 'already_member', true);
  END IF;

  -- Add user to org (cache their email for display)
  INSERT INTO org_members (org_id, user_id, role, invited_by, email)
    VALUES (
      v_invite.org_id, v_user_id, v_invite.role, v_invite.created_by,
      (SELECT email FROM auth.users WHERE id = v_user_id)
    )
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, email = EXCLUDED.email;

  -- Mark invitation used
  UPDATE org_invitations
     SET used_by = v_user_id, used_at = NOW()
   WHERE id = v_invite.id;

  RETURN jsonb_build_object('ok', true, 'org_id', v_invite.org_id, 'role', v_invite.role);
END;
$$;

-- ── peek_invitation(token) ────────────────────────────────────────────────────
-- Anon-callable: returns org name + role for the invite link preview page.
-- Returns NULL fields (not an error) for invalid/expired tokens.

CREATE OR REPLACE FUNCTION peek_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT CASE
    WHEN i.id IS NULL OR i.used_by IS NOT NULL OR i.expires_at < NOW()
      THEN jsonb_build_object('valid', false)
    ELSE jsonb_build_object(
      'valid',    true,
      'org_name', o.name,
      'org_type', o.org_type,
      'role',     i.role
    )
  END
  FROM (
    SELECT * FROM org_invitations WHERE token = p_token
  ) i
  LEFT JOIN organizations o ON o.id = i.org_id;
$$;

GRANT EXECUTE ON FUNCTION peek_invitation(TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_invitation(TEXT) TO authenticated;

-- ── get_billing_user_id(p_user_id) ───────────────────────────────────────────
-- For shared credit pool: returns the org owner's user_id when the caller is
-- a non-owner member, otherwise returns the caller's own user_id.

CREATE OR REPLACE FUNCTION get_billing_user_id(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT om_owner.user_id
        FROM org_members om_me
        JOIN org_members om_owner
          ON  om_owner.org_id = om_me.org_id
          AND om_owner.role   = 'owner'
       WHERE om_me.user_id = p_user_id
         AND om_me.role   != 'owner'
       LIMIT 1
    ),
    p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION get_billing_user_id(UUID) TO authenticated;

-- ── Update RLS on all org-scoped tables ──────────────────────────────────────
-- Replace owner_id checks with org_members membership checks.
-- Helper inline view (not materialised — evaluated per row by the planner):
--   my_orgs AS (SELECT org_id FROM org_members WHERE user_id = auth.uid())

-- organizations: members can read their org; only owner can update/delete

DROP POLICY IF EXISTS "users_own_org" ON organizations;

CREATE POLICY "org_members_read_org" ON organizations
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "org_owner_write_org" ON organizations
  FOR ALL TO authenticated
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- meetings: any org member can read; any org member can insert (generate)
-- update/delete restricted to admin+ (enforced in app layer for now)

DROP POLICY IF EXISTS "users_own_meetings" ON meetings;

CREATE POLICY "org_members_all_meetings" ON meetings
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- motions

DROP POLICY IF EXISTS "users_own_motions" ON motions;

CREATE POLICY "org_members_all_motions" ON motions
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- action_items

DROP POLICY IF EXISTS "users_own_action_items" ON action_items;

CREATE POLICY "org_members_all_action_items" ON action_items
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- roster

DROP POLICY IF EXISTS "users_manage_roster" ON roster;

CREATE POLICY "org_members_all_roster" ON roster
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- documents

DROP POLICY IF EXISTS "users_own_documents" ON documents;

CREATE POLICY "org_members_all_documents" ON documents
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- alteration_requests

DROP POLICY IF EXISTS "users_own_alteration_requests" ON alteration_requests;

CREATE POLICY "org_members_all_alteration_requests" ON alteration_requests
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  );

-- Storage bucket: governance-documents
-- Drop the old owner_id-based storage policies and replace with org_members checks.

DROP POLICY IF EXISTS "org members can download governance documents"
  ON storage.objects;
DROP POLICY IF EXISTS "org members can upload governance documents"
  ON storage.objects;

CREATE POLICY "org_members_download_docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'governance-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_upload_docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'governance-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM org_members WHERE user_id = auth.uid()
    )
  );
