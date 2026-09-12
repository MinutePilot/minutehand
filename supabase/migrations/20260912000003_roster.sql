-- ── Roster ────────────────────────────────────────────────────────────────────
-- Board/council member roster attached to an organization.
-- sort_order controls display order (President first, etc.).

CREATE TABLE roster (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'Director',
  strata_lot  TEXT,
  email       TEXT,
  term_start  DATE,
  term_end    DATE,
  status      TEXT        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'former')),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_roster" ON roster
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX roster_org_idx ON roster (org_id, sort_order);
