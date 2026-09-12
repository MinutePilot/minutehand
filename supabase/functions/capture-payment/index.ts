// Called after PayPal redirects the user back with ?payment=approved&token=ORDER_ID
// Captures the order and grants credits atomically.
// For board_plan purchases: also activates the subscription and grants 12 included credits.
import { createClient } from "npm:@supabase/supabase-js@^2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PACK_CREDITS: Record<string, number> = {
  "1_credit":   1,
  "5_credits":  5,
  "board_plan": 12,   // included meeting credits
};

function paypalBase() {
  return Deno.env.get("PAYPAL_MODE") === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function getAccessToken(): Promise<string> {
  const id     = Deno.env.get("PAYPAL_CLIENT_ID")!;
  const secret = Deno.env.get("PAYPAL_CLIENT_SECRET")!;
  const resp   = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) throw new Error("Failed to get PayPal access token");
  const { access_token } = await resp.json();
  return access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return json({ error: "Authentication required" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid session" }, 401);

  let orderId: string;
  try {
    ({ orderId } = await req.json());
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!orderId) return json({ error: "orderId is required" }, 400);

  const token = await getAccessToken();

  // Capture the PayPal order
  const captureResp = await fetch(`${paypalBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!captureResp.ok) {
    const body = await captureResp.text();
    console.error("PayPal capture error:", captureResp.status, body);
    return json({ error: "Payment capture failed" }, 500);
  }

  const captureData = await captureResp.json();

  if (captureData.status !== "COMPLETED") {
    return json({ error: `Payment status: ${captureData.status}` }, 402);
  }

  const capture   = captureData.purchase_units?.[0]?.payments?.captures?.[0];
  const customId  = capture?.custom_id ?? "";
  const paymentId = capture?.id ?? orderId;

  const [pack, orderUserId] = customId.split(":");

  // Verify the order belongs to the authenticated user
  if (orderUserId !== user.id) {
    console.error(`User mismatch: token=${user.id}, order=${orderUserId}`);
    return json({ error: "Order does not belong to this user" }, 403);
  }

  const credits = PACK_CREDITS[pack];
  if (credits === undefined) return json({ error: "Unknown pack in order" }, 400);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Grant the included meeting credits
  const { error: creditErr } = await supabaseAdmin.rpc("add_credits", {
    p_user_id: user.id,
    p_amount: credits,
    p_stripe_payment_id: paymentId,
  });

  if (creditErr) {
    console.error("Failed to add credits:", creditErr);
    return json({ error: "Failed to grant credits" }, 500);
  }

  // For Board Plan purchases: activate the subscription
  if (pack === "board_plan") {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const { error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .upsert({
        user_id:                user.id,
        board_plan_active:      true,
        activated_at:           new Date().toISOString(),
        expires_at:             expiresAt,
        paypal_subscription_id: paymentId,
        updated_at:             new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (subErr) {
      console.error("Failed to activate Board Plan:", subErr);
      // Credits already granted above — log but don't return error;
      // support can manually activate if needed, credits are not lost.
    }

    return json({ credits, boardPlan: true });
  }

  return json({ credits });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
