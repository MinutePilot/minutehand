-- ── Minutes editor: version history + publish audit log ─────────────────────
--
-- Design decisions recorded here:
--
--   edited_html: nullable column on meetings. When null, the app continues
--   to use marked.parse(markdown) as before — no behaviour change for
--   unedited meetings. When set, edited_html is used for preview and export.
--
--   meeting_versions: append-only. Every save creates a new row. Reverting
--   creates a new row from old content. No row is ever updated or deleted.
--
--   meeting_publish_log: immutable audit trail. Records every publish,
--   unpublish, and auto-unpublish (triggered by edit on a published meeting).
--   Answers "what did owners actually see, and when?" independently of the
--   content version history.
--
--   Auto-unpublish on edit (Option 1): When a published meeting is saved via
--   the editor, published flips to false and an auto_unpublished row is
--   written to meeting_publish_log before the new version row is written.
--   Re-publishing is a deliberate separate action by the secretary.
--
--   RLS: both tables use get_user_org_ids() / get_user_admin_org_ids()
--   SECURITY DEFINER helpers from migration 20260914000004, matching the
--   pattern used by all other governance tables.

-- ── Extend meetings ───────────────────────────────────────────────────────────

ALTER TABLE meetings ADD COLUMN edited_html TEXT;

-- ── Meeting versions ──────────────────────────────────────────────────────────

CREATE TABLE meeting_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID        NOT NULL REFERENCES meetings(id)      ON DELETE CASCADE,
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  html_content TEXT        NOT NULL,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_by     UUID        REFERENCES auth.users(id)
);

ALTER TABLE meeting_versions ENABLE ROW LEVEL SECURITY;

-- All org members can read versions; any authenticated member can create them
CREATE POLICY "meeting_versions_select" ON meeting_versions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));

CREATE POLICY "meeting_versions_insert" ON meeting_versions
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));

-- No UPDATE or DELETE policies — versions are immutable by design

CREATE INDEX meeting_versions_meeting_idx ON meeting_versions (meeting_id, saved_at DESC);

-- ── Publish audit log ─────────────────────────────────────────────────────────

CREATE TABLE meeting_publish_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID        NOT NULL REFERENCES meetings(id)      ON DELETE CASCADE,
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action        TEXT        NOT NULL
                CHECK (action IN ('published', 'unpublished', 'auto_unpublished')),
  -- version_id: the most recent content version at the time of publish/unpublish
  version_id    UUID        REFERENCES meeting_versions(id),
  -- html_snapshot: exact HTML that was (or was about to become) live
  html_snapshot TEXT,
  actor_id      UUID        REFERENCES auth.users(id),
  acted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE meeting_publish_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meeting_publish_log_select" ON meeting_publish_log
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids()));

CREATE POLICY "meeting_publish_log_insert" ON meeting_publish_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT get_user_org_ids()));

-- No UPDATE or DELETE — audit log is immutable by design

CREATE INDEX meeting_publish_log_meeting_idx ON meeting_publish_log (meeting_id, acted_at DESC);
