import { createClient } from "npm:@supabase/supabase-js@^2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PACKS = {
  "1_credit":   { name: "1 Meeting Credit",             credits: 1,  amount: "7.00",  currency: "CAD" },
  "5_credits":  { name: "5 Meeting Credits",            credits: 5,  amount: "20.00", currency: "CAD" },
  "board_plan": { name: "MinuteHand Board Plan (1 yr)", credits: 12, amount: "75.00", currency: "CAD" },
} as const;

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

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json({ error: "Invalid session" }, 401);

  let pack: string, origin: string;
  try {
    ({ pack, origin } = await req.json());
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const packInfo = PACKS[pack as keyof typeof PACKS];
  if (!packInfo) return json({ error: "Invalid pack" }, 400);
  if (!origin)   return json({ error: "origin is required" }, 400);

  try {
    const token = await getAccessToken();

    const orderResp = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: packInfo.currency, value: packInfo.amount },
          description: packInfo.name,
          custom_id: `${pack}:${user.id}`,
        }],
        application_context: {
          brand_name: "MinuteHand",
          user_action: "PAY_NOW",
          return_url: `${origin}?payment=approved`,
          cancel_url: `${origin}?payment=cancelled`,
        },
      }),
    });

    if (!orderResp.ok) {
      console.error("PayPal order error:", await orderResp.text());
      return json({ error: "Failed to create PayPal order" }, 500);
    }

    const order = await orderResp.json();
    const approvalUrl = (order.links as { rel: string; href: string }[])
      .find((l) => l.rel === "approve")?.href;

    if (!approvalUrl) return json({ error: "No approval URL returned by PayPal" }, 500);

    return json({ url: approvalUrl });
  } catch (err) {
    console.error("PayPal error:", err);
    return json({ error: "Failed to create payment" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
