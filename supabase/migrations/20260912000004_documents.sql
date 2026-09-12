-- ── Document library ─────────────────────────────────────────────────────────
-- Stores metadata for governance documents (bylaws, AGM records, insurance,
-- etc.). Actual files live in the 'governance-documents' storage bucket.
-- Storage bucket and policies are in migration 20260912000005.
--
-- Design notes for Step 8d (version history):
-- • No UNIQUE constraint on category — multiple versions of the same type allowed.
-- • effective_date + created_at together support "which version was in effect on X".
-- • supersedes_id is a nullable self-reference for Step 8d to populate.
-- • status = 'archived' is the only way to hide a document — no hard delete.

CREATE TABLE documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id),
  title           TEXT        NOT NULL,
  category        TEXT        NOT NULL
                  CHECK (category IN (
                    'Bylaws',
                    'Rules & Regulations',
                    'AGM Records',
                    'Insurance',
                    'Depreciation Report',
                    'Financial Statements',
                    'Other'
                  )),
  effective_date  DATE,
  storage_path    TEXT        NOT NULL UNIQUE,
  file_name       TEXT        NOT NULL,
  file_size       INTEGER,
  mime_type       TEXT,
  -- Populated post-upload for text-extractable formats (Step 8c followup / future webhook).
  -- NULL for scanned images, which are searchable by title/category only.
  extracted_text  TEXT,
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,          '') || ' ' ||
      coalesce(category,       '') || ' ' ||
      coalesce(extracted_text, '')
    )
  ) STORED,
  -- Populated by Step 8d (version history) to link a new upload to the prior version.
  supersedes_id   UUID        REFERENCES documents(id),
  status          TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Same ownership-subquery pattern as motions, action_items, and roster.
CREATE POLICY "users_manage_documents" ON documents
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX documents_org_status_idx  ON documents (org_id, status, created_at DESC);
CREATE INDEX documents_search_idx      ON documents USING GIN (search_vector);
CREATE INDEX documents_category_idx    ON documents (org_id, category, effective_date DESC NULLS LAST);

-- ── search_documents RPC ──────────────────────────────────────────────────────
-- Same SECURITY DEFINER + explicit auth.uid() check pattern as search_meetings.
-- Returns results with ts_headline excerpts covering title + extracted text.
-- When extracted_text is NULL the headline falls back to the title only.

CREATE OR REPLACE FUNCTION search_documents(
  p_org_id UUID,
  p_query  TEXT
)
RETURNS TABLE (
  id             UUID,
  title          TEXT,
  category       TEXT,
  effective_date DATE,
  storage_path   TEXT,
  file_name      TEXT,
  mime_type      TEXT,
  created_at     TIMESTAMPTZ,
  headline       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.category,
    d.effective_date,
    d.storage_path,
    d.file_name,
    d.mime_type,
    d.created_at,
    ts_headline(
      'english',
      coalesce(d.title, '') || ' ' || coalesce(d.category, '') || ' ' || coalesce(d.extracted_text, ''),
      plainto_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=25, MinWords=8, StartSel=<mark>, StopSel=</mark>'
    ) AS headline
  FROM documents d
  WHERE d.org_id  = p_org_id
    AND d.user_id = auth.uid()
    AND d.status  = 'active'
    AND d.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY d.created_at DESC;
$$;
