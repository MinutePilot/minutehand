-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 1 workspace: live meeting capture
--
-- Additive only. Nothing is dropped or renamed, and existing rows keep working:
--   * meetings.markdown becomes optional (a live meeting has no minutes yet)
--   * the meetings.status check is widened, not narrowed
--   * new columns are nullable or have defaults
--   * new tables copy the access pattern of motions / action_items:
--     organization members read, add and change; owners and admins delete.
--
-- To undo (only while the new tables hold no data you want):
--   DROP TABLE workspace_beta, attendance, agenda_items;
--   ALTER TABLE motions       DROP COLUMN agenda_item_id, DROP COLUMN mover_roster_id,
--                             DROP COLUMN seconder_roster_id, DROP COLUMN confirmed;
--   ALTER TABLE action_items  DROP COLUMN agenda_item_id, DROP COLUMN owner_roster_id,
--                             DROP COLUMN confirmed;
--   ALTER TABLE meetings      DROP COLUMN start_time, DROP COLUMN end_time,
--                             DROP COLUMN location, DROP COLUMN chair_roster_id;
--   ALTER TABLE organizations DROP COLUMN default_meeting_time, DROP COLUMN default_location;
-- ═══════════════════════════════════════════════════════════════════════════

-- ── organizations: defaults for new meetings ────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_meeting_time TIME,
  ADD COLUMN IF NOT EXISTS default_location     TEXT;

-- ── meetings: a meeting is a live record before it is minutes ───────────────
ALTER TABLE meetings ALTER COLUMN markdown DROP NOT NULL;

-- Replace the old two-value status check, whatever it is named.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.meetings'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.meetings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('planned', 'in_progress', 'review', 'draft', 'approved'));

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS start_time      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location        TEXT,
  ADD COLUMN IF NOT EXISTS chair_roster_id UUID REFERENCES roster(id) ON DELETE SET NULL;

-- Lets child tables prove they belong to the same organization as their meeting.
ALTER TABLE meetings
  ADD CONSTRAINT meetings_id_org_unique UNIQUE (id, org_id);

-- ── agenda_items ────────────────────────────────────────────────────────────
-- The in-camera flag lives here; motions and action items inherit it from
-- their agenda item, so there is one place to set it and one place to check.
CREATE TABLE agenda_items (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id     UUID        NOT NULL,
  org_id         UUID        NOT NULL,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  title          TEXT        NOT NULL,
  notes          TEXT        NOT NULL DEFAULT '',
  source         TEXT        NOT NULL DEFAULT 'added'
                 CHECK (source IN ('template', 'added')),
  is_in_camera   BOOLEAN     NOT NULL DEFAULT false,
  public_title   TEXT,
  public_summary TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_items_meeting_fk
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);

CREATE INDEX agenda_items_meeting_idx ON agenda_items (meeting_id, sort_order);

-- ── attendance ──────────────────────────────────────────────────────────────
-- display_name is a snapshot, so a renamed or removed roster member does not
-- change a past meeting. A guest has no roster_id; a proxy names the lot they
-- represent. Proxies count as present for attendance and votes.
CREATE TABLE attendance (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID        NOT NULL,
  org_id        UUID        NOT NULL,
  roster_id     UUID        REFERENCES roster(id) ON DELETE SET NULL,
  display_name  TEXT        NOT NULL,
  proxy_for_lot TEXT,
  status        TEXT        NOT NULL DEFAULT 'present'
                CHECK (status IN ('present', 'absent', 'regrets')),
  arrived_at    TIMESTAMPTZ,
  left_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_meeting_fk
    FOREIGN KEY (meeting_id, org_id) REFERENCES meetings (id, org_id) ON DELETE CASCADE
);

CREATE INDEX attendance_meeting_idx ON attendance (meeting_id);
-- A roster member appears once per meeting.
CREATE UNIQUE INDEX attendance_member_once_idx
  ON attendance (meeting_id, roster_id) WHERE roster_id IS NOT NULL;

-- ── motions and action items: link to the agenda and to roster members ──────
-- confirmed defaults to true so every existing row stays confirmed. The
-- workspace inserts false for entries it creates from chat.
ALTER TABLE motions
  ADD COLUMN IF NOT EXISTS agenda_item_id     UUID REFERENCES agenda_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mover_roster_id    UUID REFERENCES roster(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seconder_roster_id UUID REFERENCES roster(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed          BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS agenda_item_id  UUID REFERENCES agenda_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_roster_id UUID REFERENCES roster(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed       BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX motions_agenda_item_idx      ON motions (agenda_item_id);
CREATE INDEX action_items_agenda_item_idx ON action_items (agenda_item_id);

-- ── updated_at for agenda_items ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION workspace_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agenda_items_touch
  BEFORE UPDATE ON agenda_items
  FOR EACH ROW EXECUTE FUNCTION workspace_touch_updated_at();

-- ── workspace_beta: which organizations can open the workspace ──────────────
-- Members can read their organization's row but nobody can write to it through
-- the API, so an organization cannot switch itself on. To enable one, run in
-- the SQL editor:
--   INSERT INTO workspace_beta (org_id) VALUES ('<organization id>');
CREATE TABLE workspace_beta (
  org_id     UUID        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Row level security ──────────────────────────────────────────────────────
ALTER TABLE agenda_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_beta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_items_select" ON agenda_items
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "agenda_items_insert" ON agenda_items
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "agenda_items_update" ON agenda_items
  FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "agenda_items_delete" ON agenda_items
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_user_admin_org_ids()));

CREATE POLICY "attendance_select" ON attendance
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "attendance_insert" ON attendance
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "attendance_update" ON attendance
  FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));
CREATE POLICY "attendance_delete" ON attendance
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT get_user_admin_org_ids()));

CREATE POLICY "workspace_beta_select" ON workspace_beta
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));
