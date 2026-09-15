-- Fix: infinite recursion in org_members RLS policies
--
-- Root cause: all four org_members policies use subqueries that SELECT from
-- org_members itself.  PostgreSQL evaluates those subqueries under the same RLS
-- policy, causing infinite recursion the moment any policy on org_members fires.
--
-- Fix: two SECURITY DEFINER helper functions that query org_members without
-- triggering RLS (they execute as the function owner / postgres role).
-- All org_members policies are rewritten to call these helpers instead.

-- ── Helper functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM org_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_user_admin_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM org_members
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin');
$$;

GRANT EXECUTE ON FUNCTION get_user_org_ids()       TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_admin_org_ids() TO authenticated;

-- ── Rewrite org_members policies ─────────────────────────────────────────────

DROP POLICY IF EXISTS "org_members_select" ON org_members;
DROP POLICY IF EXISTS "org_members_insert" ON org_members;
DROP POLICY IF EXISTS "org_members_update" ON org_members;
DROP POLICY IF EXISTS "org_members_delete" ON org_members;

CREATE POLICY "org_members_select" ON org_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));

CREATE POLICY "org_members_insert" ON org_members
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_user_admin_org_ids()));

CREATE POLICY "org_members_update" ON org_members
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT get_user_admin_org_ids()));

CREATE POLICY "org_members_delete" ON org_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT get_user_admin_org_ids())
  );
