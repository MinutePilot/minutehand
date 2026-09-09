import Stripe from "npm:stripe@^14";
import { createClient } from "npm:@supabase/supabase-js@^2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PACKS = {
  "1_credit": {
    name: "1 Meeting Credit",
    description: "Generate one set of meeting minutes",
    credits: 1,
    amountCents: 700,
    currency: "cad",
  },
  "5_credits": {
    name: "5 Meeting Credits",
    description: "Generate five sets of meeting minutes",
    credits: 5,
    amountCents: 2000,
    currency: "cad",
  },
} as const;

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

  let pack: string;
  let origin: string;

  try {
    const body = await req.json();
    pack = body.pack;
    origin = body.origin;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const packInfo = PACKS[pack as keyof typeof PACKS];
  if (!packInfo) return json({ error: "Invalid pack" }, 400);
  if (!origin) return json({ error: "origin is required" }, 400);

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      allow_promotion_codes: true,
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: packInfo.currency,
            product_data: {
              name: packInfo.name,
              description: packInfo.description,
            },
            unit_amount: packInfo.amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: { user_id: user.id, pack },
      success_url: `${origin}?payment=success`,
      cancel_url: `${origin}?payment=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return json({ error: "Failed to create checkout session" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
