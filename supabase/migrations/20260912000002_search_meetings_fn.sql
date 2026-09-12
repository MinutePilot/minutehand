-- ── search_meetings RPC ───────────────────────────────────────────────────────
-- Called client-side via supabase.rpc('search_meetings', { p_org_id, p_query }).
-- Returns matching meetings with ts_headline excerpts for display.
-- SECURITY DEFINER bypasses RLS, so we enforce ownership explicitly via
-- m.user_id = auth.uid() in addition to the org_id check.

CREATE OR REPLACE FUNCTION search_meetings(
  p_org_id UUID,
  p_query  TEXT
)
RETURNS TABLE (
  id           UUID,
  meeting_date DATE,
  title        TEXT,
  template     TEXT,
  headline     TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.meeting_date,
    m.title,
    m.template,
    ts_headline(
      'english',
      m.markdown,
      plainto_tsquery('english', p_query),
      'MaxFragments=3, MaxWords=40, MinWords=15, StartSel=<mark>, StopSel=</mark>'
    ) AS headline
  FROM meetings m
  WHERE m.org_id    = p_org_id
    AND m.user_id   = auth.uid()
    AND m.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY m.meeting_date DESC;
$$;
