-- ── Document folders ──────────────────────────────────────────────────────────
-- Replaces the hardcoded category CHECK constraint with a real folders table.
-- Each org gets its own folder rows; documents reference them via folder_id.
-- The category column is kept (plain TEXT) for display/search compatibility
-- and is kept in sync with the folder name when a document is moved.

-- 1. Folders table ─────────────────────────────────────────────────────────────

CREATE TABLE document_folders (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_folders" ON document_folders
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX document_folders_org_idx ON document_folders (org_id, sort_order);

-- 2. Add folder_id to documents ────────────────────────────────────────────────

ALTER TABLE documents ADD COLUMN folder_id UUID REFERENCES document_folders(id) ON DELETE SET NULL;

CREATE INDEX documents_folder_idx ON documents (org_id, folder_id, status);

-- 3. Drop the hardcoded CHECK constraint on category ───────────────────────────
-- Find and drop the constraint by name. In Postgres the CHECK constraint name
-- is auto-generated as documents_category_check.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;

-- 4. Seed standard folders for every existing org + back-fill folder_id ────────

DO $$
DECLARE
  standard_folders TEXT[] := ARRAY[
    'Bylaws',
    'Rules & Regulations',
    'AGM Records',
    'Insurance',
    'Depreciation Report',
    'Financial Statements',
    'Alteration Requests',
    'Other'
  ];
  folder_name TEXT;
  sort_idx    INTEGER;
  org          RECORD;
  v_folder_id  UUID;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    sort_idx := 0;
    FOREACH folder_name IN ARRAY standard_folders LOOP
      INSERT INTO document_folders (org_id, name, sort_order)
      VALUES (org.id, folder_name, sort_idx)
      ON CONFLICT (org_id, name) DO NOTHING
      RETURNING id INTO v_folder_id;

      -- If the row already existed, fetch its id
      IF v_folder_id IS NULL THEN
        SELECT id INTO v_folder_id
        FROM document_folders
        WHERE org_id = org.id AND name = folder_name;
      END IF;

      -- Back-fill folder_id on documents whose category matches this folder name.
      UPDATE documents
      SET folder_id = v_folder_id
      WHERE org_id   = org.id
        AND category = folder_name
        AND folder_id IS NULL;

      sort_idx := sort_idx + 1;
    END LOOP;
  END LOOP;
END $$;
