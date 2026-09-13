-- ── Member delete/archive restrictions ────────────────────────────────────────
--
-- Enforces at the database layer:
--   DELETE on all six governance tables → admin/owner only
--   Setting status='archived' via UPDATE → admin/owner only
--   Normal INSERT/UPDATE (create records, edit content, mark complete) → any member
--
-- Also:
--   Adds 'archived' to action_items and alteration_requests status CHECK constraints
--   Adds storage DELETE policy (admin/owner) for permanent document deletion
--   Fixes documents.supersedes_id FK to ON DELETE SET NULL (allows deleting old versions)

-- ── Extend status CHECK constraints ─────────────────────────────────────────

-- action_items: add 'archived' status
ALTER TABLE action_items DROP CONSTRAINT IF EXISTS action_items_status_check;
ALTER TABLE action_items
  ADD CONSTRAINT action_items_status_check
  CHECK (status IN ('open', 'in_progress', 'completed', 'archived'));

-- alteration_requests: add 'archived' status
ALTER TABLE alteration_requests DROP CONSTRAINT IF EXISTS alteration_requests_status_check;
ALTER TABLE alteration_requests
  ADD CONSTRAINT alteration_requests_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn', 'archived'));

-- ── documents.supersedes_id: ON DELETE SET NULL ───────────────────────────────
-- Allows permanent deletion of older superseded documents without FK violations.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_supersedes_id_fkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_supersedes_id_fkey
  FOREIGN KEY (supersedes_id) REFERENCES documents(id)
  ON DELETE SET NULL;

-- ── Storage DELETE policy for admin/owner ─────────────────────────────────────
-- Required for permanent document deletion to clean up storage files.

CREATE POLICY "org_admins_delete_docs_storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'governance-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ── Policy split: separate DELETE from SELECT/INSERT/UPDATE ───────────────────
--
-- Pattern for tables with 'archived' status (action_items, documents, alteration_requests):
--   UPDATE WITH CHECK additionally requires admin/owner when new status = 'archived'.
--
-- Pattern for tables without 'archived' status (meetings, motions, roster):
--   UPDATE is unrestricted within org membership.
--
-- DELETE always requires admin/owner on all six tables.

-- ── meetings ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_meetings" ON meetings;

CREATE POLICY "org_members_select_meetings" ON meetings
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_meetings" ON meetings
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_update_meetings" ON meetings
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_admins_delete_meetings" ON meetings
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- ── motions ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_motions" ON motions;

CREATE POLICY "org_members_select_motions" ON motions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_motions" ON motions
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_update_motions" ON motions
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_admins_delete_motions" ON motions
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- ── action_items ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_action_items" ON action_items;

CREATE POLICY "org_members_select_action_items" ON action_items
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_action_items" ON action_items
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Members can set status open/in_progress/completed; 'archived' requires admin/owner.
CREATE POLICY "org_members_update_action_items" ON action_items
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      status != 'archived'
      OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    )
  );

CREATE POLICY "org_admins_delete_action_items" ON action_items
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- ── roster ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_roster" ON roster;

CREATE POLICY "org_members_select_roster" ON roster
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_roster" ON roster
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_update_roster" ON roster
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_admins_delete_roster" ON roster
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- ── documents ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_documents" ON documents;

CREATE POLICY "org_members_select_documents" ON documents
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_documents" ON documents
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Archiving a document (status → 'archived') requires admin/owner.
CREATE POLICY "org_members_update_documents" ON documents
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      status != 'archived'
      OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    )
  );

CREATE POLICY "org_admins_delete_documents" ON documents
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- ── alteration_requests ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_all_alteration_requests" ON alteration_requests;

CREATE POLICY "org_members_select_alteration_requests" ON alteration_requests
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_members_insert_alteration_requests" ON alteration_requests
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

-- Archiving a request (status → 'archived') requires admin/owner.
-- Normal status transitions (pending → approved/denied/withdrawn) are open to all members.
CREATE POLICY "org_members_update_alteration_requests" ON alteration_requests
  FOR UPDATE TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (
    org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    AND (
      status != 'archived'
      OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    )
  );

CREATE POLICY "org_admins_delete_alteration_requests" ON alteration_requests
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));
