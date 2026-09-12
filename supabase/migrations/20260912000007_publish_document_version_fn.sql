-- ── publish_document_version ─────────────────────────────────────────────────
-- Atomically inserts a new document row and marks the prior version as
-- 'superseded' in a single PL/pgSQL block (one Postgres transaction).
--
-- This replaces the previous two-call client pattern (INSERT + separate PATCH)
-- that could leave two active documents if the second call failed.
--
-- Security: SECURITY DEFINER with explicit auth.uid() guard, consistent with
-- has_board_plan, search_meetings, and search_documents. user_id is derived
-- from auth.uid() inside the function — the caller cannot spoof it.
--
-- Caller must own p_org_id. If superseding, the target must be status='active'
-- and belong to the same org; any other state raises an exception and rolls
-- back the INSERT.

CREATE OR REPLACE FUNCTION publish_document_version(
  p_id             UUID,
  p_org_id         UUID,
  p_title          TEXT,
  p_category       TEXT,
  p_storage_path   TEXT,
  p_file_name      TEXT,
  -- optional / nullable params must come after all required ones
  p_effective_date DATE     DEFAULT NULL,
  p_file_size      INTEGER  DEFAULT NULL,
  p_mime_type      TEXT     DEFAULT NULL,
  p_supersedes_id  UUID     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid UUID := auth.uid();
BEGIN
  -- Guard: caller must be authenticated and own the target org
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_org_id NOT IN (SELECT id FROM organizations WHERE owner_id = caller_uid) THEN
    RAISE EXCEPTION 'permission denied for org %', p_org_id USING ERRCODE = '42501';
  END IF;

  -- Guard: if superseding, the target must be active and belong to the same org
  IF p_supersedes_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM documents
      WHERE id     = p_supersedes_id
        AND org_id = p_org_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'document % is not active or does not belong to this org', p_supersedes_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Insert the new document (user_id taken from auth context, not caller-supplied)
  INSERT INTO documents (
    id, org_id, user_id,
    title, category, effective_date,
    storage_path, file_name, file_size, mime_type,
    supersedes_id, status
  )
  VALUES (
    p_id, p_org_id, caller_uid,
    p_title, p_category, p_effective_date,
    p_storage_path, p_file_name, p_file_size, p_mime_type,
    p_supersedes_id, 'active'
  );

  -- Mark the prior version superseded (same transaction — atomic with INSERT above)
  IF p_supersedes_id IS NOT NULL THEN
    UPDATE documents
    SET    status     = 'superseded',
           updated_at = NOW()
    WHERE  id = p_supersedes_id;
  END IF;

  RETURN p_id;
END;
$$;
