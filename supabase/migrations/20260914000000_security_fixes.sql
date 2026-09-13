-- ── Security fixes ────────────────────────────────────────────────────────────
--
-- Fix 1: org_members_update — admins could previously promote any member to
--   'owner' (no WITH CHECK) and could target the owner's row (no USING guard).
--   New policy: admins can only target non-owner rows; no one can write role='owner'.
--
-- Fix 2: org_members_delete — admins could previously delete the owner's row.
--   New policy: admins can remove non-owner members only.
--
-- Fix 3: org_invitations — no DELETE policy existed; revoke was silently
--   blocked by RLS. Adds DELETE for owner/admin of the org.
--
-- Fix 4: get_org_credit_balance() — SECURITY DEFINER function so org members
--   can read the shared credit pool balance without a direct credits table grant.

-- ── Fix 1 & 2: Replace org_members policies ───────────────────────────────────

DROP POLICY IF EXISTS "org_members_update" ON org_members;
DROP POLICY IF EXISTS "org_members_delete" ON org_members;

-- Update: owner or admin can update rows in their org.
-- Admins may NOT target the owner's row (prevents role changes on the owner).
-- No one may write role='owner' (ownership transfer is not supported).
CREATE POLICY "org_members_update" ON org_members
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    AND (
      role != 'owner'
      OR auth.uid() IN (
        SELECT user_id FROM org_members om2
        WHERE om2.org_id = org_members.org_id AND om2.role = 'owner'
      )
    )
  )
  WITH CHECK (role != 'owner');

-- Delete: any member can remove themselves (leave org).
-- Owner can remove any non-owner member.
-- Admin can remove non-owner members only (cannot remove the owner).
CREATE POLICY "org_members_delete" ON org_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
      AND (
        role != 'owner'
        OR auth.uid() IN (
          SELECT user_id FROM org_members om2
          WHERE om2.org_id = org_members.org_id AND om2.role = 'owner'
        )
      )
    )
  );

-- ── Fix 3: org_invitations DELETE policy ─────────────────────────────────────

CREATE POLICY "org_invitations_delete" ON org_invitations
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- ── Fix 4: get_org_credit_balance() ──────────────────────────────────────────
-- Returns the shared credit pool balance for the caller's org.
-- For org members, resolves to the owner's balance via get_billing_user_id().
-- For solo users (no org), returns their own balance.
-- SECURITY DEFINER bypasses the credits RLS (which only exposes own row).

CREATE OR REPLACE FUNCTION get_org_credit_balance(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT balance FROM credits WHERE user_id = get_billing_user_id(p_user_id)),
    0
  );
$$;

GRANT EXECUTE ON FUNCTION get_org_credit_balance(UUID) TO authenticated;
