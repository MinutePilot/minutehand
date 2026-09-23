-- ── Support ticket notifications ──────────────────────────────────────────────
--
-- Triggers a webhook on two events:
--   1. New support_tickets row — notifies the platform admin (you) by email
--   2. New support_messages row with sender_type = 'admin' — notifies the
--      org that a reply has arrived
--
-- Implementation: pg_net HTTP POST from a trigger to the notify-ticket
-- Supabase Edge Function. pg_net fires async so it doesn't add latency to
-- the INSERT path.
--
-- The Edge Function uses Resend (resend.com) to send transactional email.
-- Add RESEND_API_KEY to your Supabase project secrets before deploying.
-- The ADMIN_EMAIL secret sets the destination for new-ticket notifications.

-- ── Enable pg_net if not already enabled ──────────────────────────────────────
-- pg_net ships with Supabase; this is a no-op if already enabled.
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── Trigger function: new ticket created ─────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_notify_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_name   TEXT;
  v_owner_email TEXT;
  v_payload    JSONB;
BEGIN
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

  PERFORM extensions.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/notify-ticket',
    body    := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
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
BEGIN
  -- Only fire for admin-side messages
  IF NEW.sender_type != 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT o.name, u.email, st.subject
    INTO v_org_name, v_owner_email, v_subject
    FROM support_tickets st
    JOIN organizations   o  ON o.id  = st.org_id
    JOIN auth.users      u  ON u.id  = o.owner_id
   WHERE st.id = NEW.ticket_id;

  v_payload := jsonb_build_object(
    'event',       'admin_reply',
    'ticket_id',   NEW.ticket_id,
    'subject',     v_subject,
    'org_name',    v_org_name,
    'to_email',    v_owner_email
  );

  PERFORM extensions.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/notify-ticket',
    body    := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_admin_reply
  AFTER INSERT ON support_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_admin_reply();
