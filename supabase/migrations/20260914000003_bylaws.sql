-- ── Bylaws upload, extraction, and search ────────────────────────────────────
--
-- Three tables:
--   bylaws_documents  — one active bylaw document per org (upload metadata + extracted text)
--   bylaws_chunks     — chunked text for full-text keyword search (Part 4)
--   bylaws_parameters — structured extracted provisions pending human confirmation (Parts 2-3)
--
-- Design principles:
--   - Extracted parameters are UNCONFIRMED until a human reviews each one.
--   - Only confirmed parameters are safe to use in downstream features.
--   - The full extracted text is stored for search; structured parameters are
--     a separate, human-gated layer on top of that text.
--   - RLS follows the org_members pattern introduced in 20260913000000.

-- ── bylaws_documents ──────────────────────────────────────────────────────────

CREATE TABLE bylaws_documents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path     text        NOT NULL,
  filename         text        NOT NULL,
  file_size        integer,
  mime_type        text,
  full_text        text,
  ocr_method       text,       -- 'mammoth' | 'claude-pdf' | 'manual'
  ocr_quality      text,       -- 'ok' | 'low'
  status           text        NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing', 'extraction_done', 'confirmed')),
  last_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bylaws_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_all_bylaws_documents" ON bylaws_documents
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE INDEX bylaws_documents_org_idx ON bylaws_documents (org_id, created_at DESC);

-- ── bylaws_chunks ─────────────────────────────────────────────────────────────

CREATE TABLE bylaws_chunks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid        NOT NULL REFERENCES bylaws_documents(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  section_ref   text,       -- e.g. 'Bylaw 3', 'Section 4.2', null if not identifiable
  chunk_text    text        NOT NULL,
  chunk_index   integer     NOT NULL,
  search_vector tsvector    GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bylaws_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_all_bylaws_chunks" ON bylaws_chunks
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE INDEX bylaws_chunks_org_idx    ON bylaws_chunks (org_id);
CREATE INDEX bylaws_chunks_doc_idx    ON bylaws_chunks (document_id);
CREATE INDEX bylaws_chunks_search_idx ON bylaws_chunks USING GIN (search_vector);

-- ── bylaws_parameters ─────────────────────────────────────────────────────────

CREATE TABLE bylaws_parameters (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid        NOT NULL REFERENCES bylaws_documents(id) ON DELETE CASCADE,
  org_id           uuid        NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  category         text        NOT NULL
                   CHECK (category IN (
                     'quorum', 'voting_thresholds', 'notice_periods',
                     'proxy_rules', 'written_resolution', 'fining',
                     'standard_bylaw_modification'
                   )),
  label            text        NOT NULL,
  extracted_value  text,
  source_text      text,
  confidence       text        NOT NULL DEFAULT 'high'
                   CHECK (confidence IN ('high', 'medium', 'low')),
  status           text        NOT NULL DEFAULT 'unconfirmed'
                   CHECK (status IN ('unconfirmed', 'confirmed', 'edited', 'rejected')),
  confirmed_value  text,       -- user's edited version (when status = 'edited')
  confirmed_at     timestamptz,
  confirmed_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bylaws_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_all_bylaws_parameters" ON bylaws_parameters
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE INDEX bylaws_parameters_org_status_idx ON bylaws_parameters (org_id, status);
CREATE INDEX bylaws_parameters_doc_idx        ON bylaws_parameters (document_id);
CREATE INDEX bylaws_parameters_org_cat_idx    ON bylaws_parameters (org_id, category);

-- ── Storage: bylaws files live in governance-documents ────────────────────────
-- Path convention: {org_id}/bylaws/{document_id}/{filename}
-- The existing org_members_upload_docs and org_members_download_docs policies
-- on storage.objects already cover this path because they check
-- (storage.foldername(name))[1] = org_id — no new storage policy needed.
