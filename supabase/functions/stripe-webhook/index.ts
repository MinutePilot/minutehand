// Called by Stripe — no JWT verification (verify_jwt = false in config.toml)
import Stripe from "npm:stripe@^14";
import { createClient } from "npm:@supabase/supabase-js@^2";

const PACK_CREDITS: Record<string, number> = {
  "1_credit": 1,
  "5_credits": 5,
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const pack = session.metadata?.pack;
    const credits = pack ? PACK_CREDITS[pack] : null;

    if (!userId || !credits) {
      console.error("Missing metadata in session:", session.id);
      return new Response("Missing metadata", { status: 400 });
    }

    // Only grant credits for paid sessions (not $0 promo codes that bypass payment)
    if (session.payment_status !== "paid" && session.amount_total !== 0) {
      console.log("Session not paid, skipping credit grant:", session.id);
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error } = await supabase.rpc("add_credits", {
      p_user_id: userId,
      p_amount: credits,
      p_stripe_payment_id: (session.payment_intent as string) ?? session.id,
    });

    if (error) {
      console.error("Failed to add credits:", error);
      return new Response("Failed to add credits", { status: 500 });
    }

    console.log(`Added ${credits} credits to user ${userId}`);
  }

  return new Response("OK", { status: 200 });
});
