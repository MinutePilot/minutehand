-- ── Alteration Requests ──────────────────────────────────────────────────────
--
-- Registry of owner alteration requests, from informal description through
-- AI-drafted formal request and board decision letter.
--
-- Storage: both generated .docx files go into the existing 'governance-documents'
-- bucket under {org_id}/alterations/ and are linked from the documents table
-- with category 'Alteration Requests'.
--
-- AI is used only for the initial request drafting (informal → formal language).
-- The board decision letter is pure structured templating — no AI call needed.

-- ── Extend documents.category constraint ─────────────────────────────────────
-- Drop whichever constraint currently guards documents.category, then recreate
-- with 'Alteration Requests' added.

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT constraint_name
    FROM   information_schema.table_constraints
    WHERE  table_name      = 'documents'
      AND  constraint_type = 'CHECK'
      AND  constraint_name LIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE documents
  ADD CONSTRAINT documents_category_check
  CHECK (category IN (
    'Bylaws',
    'Rules & Regulations',
    'AGM Records',
    'Insurance',
    'Depreciation Report',
    'Financial Statements',
    'Alteration Requests',
    'Other'
  ));

-- ── alteration_requests ───────────────────────────────────────────────────────

CREATE TABLE alteration_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES auth.users(id),
  owner_name        TEXT        NOT NULL,
  strata_lot        TEXT        NOT NULL,
  description       TEXT        NOT NULL,       -- informal text from secretary
  formal_request    TEXT        NOT NULL,       -- AI-drafted formal body paragraphs
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
  date_submitted    DATE        NOT NULL DEFAULT CURRENT_DATE,
  decision_date     DATE,
  conditions        TEXT,                       -- conditions of approval or reasons for denial
  motion_id         UUID        REFERENCES motions(id) ON DELETE SET NULL,
  request_doc_path  TEXT,                       -- storage path of the owner request .docx
  approval_doc_path TEXT,                       -- storage path of the decision letter .docx
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alteration_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_alteration_requests" ON alteration_requests
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX alteration_requests_org_status_idx
  ON alteration_requests (org_id, status, date_submitted DESC);
