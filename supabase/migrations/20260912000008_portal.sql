-- ── Owner-facing minutes portal ───────────────────────────────────────────────
--
-- Adds:
--   meetings.published      — explicit secretary publish action; NOT automatic
--   meetings.published_at   — timestamp of most recent publish
--   organizations.portal_token — 256-bit random hex token; rotatable
--
-- Public-read functions callable by the `anon` role:
--   get_portal_meetings(p_token)  — returns only published rows for token's org
--   get_portal_org_name(p_token)  — returns org display name
--
-- Authenticated-only:
--   regenerate_portal_token()     — rotates the token, invalidating old portal links
--
-- Security properties:
--   • anon has NO direct table grants (meetings, organizations, etc. are all
--     behind RLS with authenticated-only policies — unchanged from before)
--   • Both anon functions are SECURITY DEFINER but contain explicit filters;
--     they never expose unpublished rows or cross-org data
--   • Invalid/missing tokens return empty rows, not errors, so callers cannot
--     probe whether a token pattern is valid
--   • Token length: encode(gen_random_bytes(32), 'hex') = 64 hex chars = 256 bits
--     At 10 billion guesses/second, exhausting the space takes ~10^59 years

-- ── Meetings: publish status ──────────────────────────────────────────────────

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS published    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Partial index — only published rows, used by get_portal_meetings
CREATE INDEX IF NOT EXISTS meetings_portal_idx
  ON meetings (org_id, meeting_date DESC)
  WHERE published = true;

-- ── Organizations: portal token ───────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS portal_token TEXT UNIQUE;

-- Generate a token for every existing org
-- (new orgs get a token at INSERT time via the DEFAULT trigger below)
UPDATE organizations
  SET portal_token = encode(gen_random_bytes(32), 'hex')
  WHERE portal_token IS NULL;

-- Ensure future INSERTs always get a token
CREATE OR REPLACE FUNCTION _org_ensure_portal_token()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.portal_token IS NULL THEN
    NEW.portal_token := encode(gen_random_bytes(32), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_portal_token_insert ON organizations;
CREATE TRIGGER org_portal_token_insert
  BEFORE INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION _org_ensure_portal_token();

-- ── get_portal_meetings ───────────────────────────────────────────────────────
-- Callable by anon. Returns published meetings for the matching org only.
-- Returns empty set for any invalid, missing, or short token — no error raised.

CREATE OR REPLACE FUNCTION get_portal_meetings(p_token TEXT)
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  meeting_date  DATE,
  template      TEXT,
  markdown      TEXT,
  published_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Reject trivially short tokens before touching the DB
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN;
  END IF;

  SELECT id INTO v_org_id
  FROM   organizations
  WHERE  portal_token = p_token;

  -- Unknown token: return empty, same shape as valid-but-empty, no signal
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.title,
    m.meeting_date,
    m.template,
    m.markdown,
    m.published_at
  FROM   meetings m
  WHERE  m.org_id    = v_org_id
    AND  m.published = true
  ORDER  BY m.meeting_date DESC NULLS LAST, m.created_at DESC;
END;
$$;

-- ── get_portal_org_name ───────────────────────────────────────────────────────
-- Returns the org display name for the portal header; null on invalid token.
-- Intentionally minimal — exposes only the name, nothing else about the org.

CREATE OR REPLACE FUNCTION get_portal_org_name(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_name
  FROM   organizations
  WHERE  portal_token = p_token;

  RETURN v_name;  -- NULL if token unknown
END;
$$;

-- ── regenerate_portal_token ───────────────────────────────────────────────────
-- Rotates the portal token for the caller's org. Old token stops working
-- immediately. Returns the new token so the caller can update the UI.

CREATE OR REPLACE FUNCTION regenerate_portal_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid UUID := auth.uid();
  v_org_id   UUID;
  new_token  TEXT;
BEGIN
  IF caller_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_org_id
  FROM   organizations
  WHERE  owner_id = caller_uid;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '42501';
  END IF;

  new_token := encode(gen_random_bytes(32), 'hex');

  UPDATE organizations
  SET    portal_token = new_token
  WHERE  id = v_org_id;

  RETURN new_token;
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
-- Only the two read functions are exposed to anon; token rotation requires auth.
-- No table grants to anon — ever. RLS on all tables remains authenticated-only.

GRANT EXECUTE ON FUNCTION get_portal_meetings(TEXT)  TO anon;
GRANT EXECUTE ON FUNCTION get_portal_org_name(TEXT)  TO anon;
GRANT EXECUTE ON FUNCTION regenerate_portal_token()  TO authenticated;
