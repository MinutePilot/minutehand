-- ── Governance Records schema ─────────────────────────────────────────────────
-- Adds: organizations, subscriptions, meetings, motions, action_items
-- Single org per user for v1 (owner_id UNIQUE on organizations).
-- Subscriptions table uses a manual board_plan_active flag for v1;
-- designed with paypal_subscription_id column for PayPal Subscriptions later.

-- ── Organizations ─────────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  org_type   TEXT        NOT NULL DEFAULT 'STRATA'
             CHECK (org_type IN ('STRATA', 'HOA_GENERIC', 'NONPROFIT_BOARD', 'TEAM_INFORMAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_org" ON organizations
  FOR ALL TO authenticated
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ── Board Plan subscriptions ──────────────────────────────────────────────────
-- board_plan_active is flipped manually via service role for v1.
-- paypal_subscription_id is populated when PayPal recurring billing is wired up.

CREATE TABLE subscriptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  board_plan_active      BOOLEAN     NOT NULL DEFAULT false,
  activated_at           TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  paypal_subscription_id TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own subscription; writes are service-role only.
CREATE POLICY "users_read_own_subscription" ON subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- SECURITY DEFINER so edge functions can check tier without exposing service key to client.
CREATE OR REPLACE FUNCTION has_board_plan(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT board_plan_active
       FROM subscriptions
      WHERE user_id   = p_user_id
        AND board_plan_active = true
        AND (expires_at IS NULL OR expires_at > NOW())),
    false
  );
$$;

-- ── Meetings ──────────────────────────────────────────────────────────────────
-- Persistent record of every generated set of minutes.
-- user_id is denormalised here so RLS doesn't require a join through organizations.

CREATE TABLE meetings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id),
  meeting_date DATE,
  title        TEXT,
  template     TEXT        NOT NULL DEFAULT 'STRATA',
  status       TEXT        NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'approved')),
  markdown     TEXT        NOT NULL,
  source_notes TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_meetings" ON meetings
  FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Full-text search across title + markdown body (supports feature 6).
ALTER TABLE meetings
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,    '') || ' ' ||
      coalesce(markdown, '')
    )
  ) STORED;

CREATE INDEX meetings_search_idx    ON meetings USING GIN (search_vector);
CREATE INDEX meetings_user_date_idx ON meetings (user_id, meeting_date DESC);
CREATE INDEX meetings_org_idx       ON meetings (org_id);

-- ── Motions ───────────────────────────────────────────────────────────────────
-- Extracted from each meeting at generation time.
-- result values mirror what the prompt produces; 'tabled'/'withdrawn' included
-- for future prompt support and manual entry.

CREATE TABLE motions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID        NOT NULL REFERENCES meetings(id)      ON DELETE CASCADE,
  org_id      UUID        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  description TEXT        NOT NULL,
  moved_by    TEXT,
  seconded_by TEXT,
  result      TEXT        CHECK (result IN ('carried', 'defeated', 'tabled', 'withdrawn')),
  vote_tally  TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE motions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_motions" ON motions
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX motions_org_meeting_idx ON motions (org_id, meeting_id);
CREATE INDEX motions_org_result_idx  ON motions (org_id, result);

-- ── Action items ──────────────────────────────────────────────────────────────
-- Extracted from each meeting at generation time; status updated manually by user.
-- due_date stored as text because generated values may be prose
-- ("Next meeting — October 20, 2026") rather than a clean DATE.

CREATE TABLE action_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID        NOT NULL REFERENCES meetings(id)      ON DELETE CASCADE,
  org_id            UUID        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  description       TEXT        NOT NULL,
  responsible_party TEXT,
  due_date          TEXT,
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed')),
  completed_at      TIMESTAMPTZ,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_action_items" ON action_items
  FOR ALL TO authenticated
  USING  (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

CREATE INDEX action_items_org_status_idx  ON action_items (org_id, status);
CREATE INDEX action_items_org_meeting_idx ON action_items (org_id, meeting_id);
