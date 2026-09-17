-- ── Portal: expose edited_html ────────────────────────────────────────────────
--
-- get_portal_meetings previously returned only `markdown` (the original
-- AI-generated text).  When a secretary edits minutes in the Quill editor,
-- the edited content is stored in meetings.edited_html — a field added in
-- migration 20260916000000_minutes_editor.sql — but that column was not
-- included in the portal function, so the portal always showed pre-edit text.
--
-- This migration replaces the function with a LANGUAGE sql version that:
--   • Adds edited_html to the return table
--   • Avoids the PL/pgSQL OUT-parameter/column ambiguity that occurs when
--     dropping and recreating a RETURNS TABLE function with a new column
--
-- portal.js is updated separately to use edited_html ?? markdown, matching
-- the fallback pattern already used in board.js:2139-2140.

-- Must drop before recreating because the return table gains a new column
DROP FUNCTION IF EXISTS get_portal_meetings(TEXT);

CREATE FUNCTION get_portal_meetings(p_token TEXT)
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  meeting_date  DATE,
  template      TEXT,
  markdown      TEXT,
  edited_html   TEXT,
  published_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    m.id,
    m.title,
    m.meeting_date,
    m.template,
    m.markdown,
    m.edited_html,
    m.published_at
  FROM   meetings m
  JOIN   organizations o ON o.id = m.org_id
  WHERE  o.portal_token = p_token
    AND  p_token IS NOT NULL
    AND  length(trim(p_token)) >= 32
    AND  m.published = true
  ORDER  BY m.meeting_date DESC NULLS LAST, m.created_at DESC;
$$;

-- Re-grant after drop/recreate (DROP removes the prior grant)
GRANT EXECUTE ON FUNCTION get_portal_meetings(TEXT) TO anon;
