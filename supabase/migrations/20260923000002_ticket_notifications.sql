-- ── Support ticket notifications ──────────────────────────────────────────────
--
-- Triggers a webhook on two events:
--   1. New support_tickets row — notifies the platform admin by email
--   2. New support_messages row with sender_type = 'admin' — notifies the
--      org owner that a reply has arrived
--
-- Implementation: net.http_post() from pg_net (ships with Supabase) fires
-- async from a trigger, so no latency is added to the INSERT path.
--
-- The project URL is hardcoded (it is not a secret — it is already in
-- config.js). The service role key must NOT be committed. After running
-- this migration, execute once in the Supabase SQL editor:
--
--   ALTER DATABASE postgres
--     SET "app.settings.service_role_key" = '<your-service-role-key>';
--
-- Find the key: Supabase dashboard → Settings → API → service_role key.
-- Until this is set the triggers will log a warning and skip the HTTP call
-- rather than blocking the INSERT.

-- ── Enable pg_net ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── Trigger function: new ticket created ─────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_notify_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_name    TEXT;
  v_owner_email TEXT;
  v_payload     JSONB;
  v_service_key TEXT;
BEGIN
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING 'fn_notify_new_ticket: app.settings.service_role_key not set — skipping notification';
    RETURN NEW;
  END IF;

  SELECT o.name, u.email
    INTO v_org_name, v_owner_email
    FROM organizations o
    JOIN auth.users    u ON u.id = o.owner_id
   WHERE o.id = NEW.org_id;

  v_payload := jsonb_build_object(
    'event',      'new_ticket',
    'ticket_id',  NEW.id,
    'subject',    NEW.subject,
    'org_name',   v_org_name,
    'org_id',     NEW.org_id,
    'from_email', v_owner_email
  );

  PERFORM net.http_post(
    url     := 'https://phzmhvslrzmrufzcjqei.supabase.co/functions/v1/notify-ticket',
    body    := v_payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_ticket
  AFTER INSERT ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_new_ticket();

-- ── Trigger function: admin reply posted ─────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_notify_admin_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_name    TEXT;
  v_owner_email TEXT;
  v_subject     TEXT;
  v_payload     JSONB;
  v_service_key TEXT;
BEGIN
  IF NEW.sender_type != 'admin' THEN
    RETURN NEW;
  END IF;

  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING 'fn_notify_admin_reply: app.settings.service_role_key not set — skipping notification';
    RETURN NEW;
  END IF;

  SELECT o.name, u.email, st.subject
    INTO v_org_name, v_owner_email, v_subject
    FROM support_tickets st
    JOIN organizations   o  ON o.id  = st.org_id
    JOIN auth.users      u  ON u.id  = o.owner_id
   WHERE st.id = NEW.ticket_id;

  v_payload := jsonb_build_object(
    'event',     'admin_reply',
    'ticket_id', NEW.ticket_id,
    'subject',   v_subject,
    'org_name',  v_org_name,
    'to_email',  v_owner_email
  );

  PERFORM net.http_post(
    url     := 'https://phzmhvslrzmrufzcjqei.supabase.co/functions/v1/notify-ticket',
    body    := v_payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_admin_reply
  AFTER INSERT ON support_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_admin_reply();
