-- ── Switch notification triggers to read service role key from Vault ──────────
--
-- Replaces current_setting('app.settings.service_role_key') with a Vault
-- lookup. The secret was created via:
--   SELECT vault.create_secret('<key>', 'service_role_key');

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
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING 'fn_notify_new_ticket: service_role_key not found in vault — skipping notification';
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

  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE WARNING 'fn_notify_admin_reply: service_role_key not found in vault — skipping notification';
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
