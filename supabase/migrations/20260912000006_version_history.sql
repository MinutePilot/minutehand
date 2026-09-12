-- ── Document version history ─────────────────────────────────────────────────
-- Extends the documents.status CHECK to allow 'superseded' as a third value.
-- A superseded document has been replaced by a newer upload via the supersedes_id
-- self-reference (already present from migration 20260912000004).
--
-- Status semantics:
--   active     — current version; shown in the main document list and searchable
--   superseded — replaced by a newer version; accessible via version history only;
--                excluded from search (same WHERE clause as 'archived')
--   archived   — deliberately hidden by the user; restored via the archived section

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'documents'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('active', 'archived', 'superseded'));

-- Index for walking version chains efficiently: "which doc supersedes this one?"
CREATE INDEX IF NOT EXISTS documents_supersedes_idx
  ON documents (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
