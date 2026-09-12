-- ── governance-documents storage bucket ──────────────────────────────────────
-- Private bucket for governance document files. Metadata is in the documents
-- table (migration 20260912000004). Files are never deleted via the API —
-- archiving a document sets status='archived' on the documents row; the storage
-- file persists. This is intentional per spec: permanent deletion of a
-- governance document (even accidentally) is a larger problem than the storage
-- cost of keeping the file.
--
-- ⚠ STORAGE RLS DIFFERS FROM TABLE RLS — documented explicitly:
--
-- Table RLS (motions, action_items, roster, documents):
--   USING (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
--   — applied to a column (org_id UUID) on a table in the public schema.
--
-- Storage RLS (storage.objects):
--   USING (
--     bucket_id = 'governance-documents'
--     AND (storage.foldername(name))[1] IN (
--       SELECT id::text FROM organizations WHERE owner_id = auth.uid()
--     )
--   )
--   — applied to the storage.objects table in the storage schema.
--   — ownership is checked by parsing the first path component via
--     storage.foldername() and casting the UUID to TEXT for comparison.
--   — the same subquery (organizations WHERE owner_id = auth.uid()) anchors
--     both, so the effective ownership chain is identical: user → org → file.
--
-- Path structure: {org_id}/{document_id}/{original_filename}
-- The org_id folder is the first component parsed by storage.foldername().

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'governance-documents',
  'governance-documents',
  false,
  20971520,  -- 20 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- SELECT — lets authenticated users download (and create signed URLs for) their
-- own org's files.
CREATE POLICY "org members can download governance documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'governance-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM organizations WHERE owner_id = auth.uid()
  )
);

-- INSERT — lets authenticated users upload to their own org's folder.
CREATE POLICY "org members can upload governance documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'governance-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM organizations WHERE owner_id = auth.uid()
  )
);

-- No DELETE policy for authenticated users. Hard deletion of governance
-- documents is not permitted through the API. If an upload succeeds but the
-- documents metadata INSERT fails (rare network error), the storage file
-- becomes an orphan — this is acceptable for v1 and can be cleaned up by an
-- admin if needed.
