// Sends transactional email notifications for support ticket events.
// Called by DB triggers via pg_net — not directly by the client.
//
// Required Supabase secrets:
//   RESEND_API_KEY   — from resend.com
//   ADMIN_EMAIL      — where new-ticket alerts go (your inbox)
//   APP_DOMAIN       — e.g. https://minutehand.ca (for reply links)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface NewTicketPayload {
  event: "new_ticket";
  ticket_id: string;
  subject: string;
  org_name: string;
  org_id: string;
  from_email: string;
}

interface AdminReplyPayload {
  event: "admin_reply";
  ticket_id: string;
  subject: string;
  org_name: string;
  to_email: string;
}

type Payload = NewTicketPayload | AdminReplyPayload;

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MinuteHand Support <support@minutehand.ca>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const apiKey     = Deno.env.get("RESEND_API_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const appDomain  = Deno.env.get("APP_DOMAIN") ?? "https://minutehand.ca";

  if (!apiKey) {
    console.error("RESEND_API_KEY not configured");
    return new Response(JSON.stringify({ error: "Email not configured" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    if (payload.event === "new_ticket") {
      if (!adminEmail) {
        console.error("ADMIN_EMAIL not configured");
        return new Response(JSON.stringify({ ok: true, skipped: "no admin email" }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      await sendEmail(
        apiKey,
        adminEmail,
        `[MinuteHand Support] New ticket: ${payload.subject}`,
        `
          <p>A new support ticket was opened.</p>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Org</td><td><strong>${payload.org_name}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">From</td><td>${payload.from_email}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Subject</td><td>${payload.subject}</td></tr>
          </table>
          <p style="margin-top:16px">
            <a href="${appDomain}/admin.html" style="background:#EF9F27;color:#412402;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600">
              Open Admin Panel →
            </a>
          </p>
        `
      );
    } else if (payload.event === "admin_reply") {
      await sendEmail(
        apiKey,
        payload.to_email,
        `Re: ${payload.subject} — MinuteHand Support`,
        `
          <p>Hi,</p>
          <p>The MinuteHand support team has replied to your ticket: <strong>${payload.subject}</strong></p>
          <p style="margin-top:16px">
            <a href="${appDomain}/board.html" style="background:#EF9F27;color:#412402;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600">
              View reply in dashboard →
            </a>
          </p>
          <p style="margin-top:24px;font-size:12px;color:#999">
            To view the full thread, open the Support tab in your MinuteHand governance dashboard.
          </p>
        `
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-ticket error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
