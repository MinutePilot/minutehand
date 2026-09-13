import Anthropic from "npm:@anthropic-ai/sdk";

const anthropic = new Anthropic();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { orgName, ownerName, strataLot, description } = await req.json();

    if (!orgName || !ownerName || !strataLot || !description) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: orgName, ownerName, strataLot, description" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: `You are a strata management assistant helping draft formal owner alteration requests for BC strata corporations.

Draft exactly 3 concise formal paragraphs describing what the owner is requesting. Requirements:
- Write in third person ("The owner of Strata Lot [lot] requests permission to…")
- Use clear, precise language suitable for a legal record
- Paragraph 1: what is being requested and where (location within the strata lot)
- Paragraph 2: construction detail — materials, dimensions, appearance
- Paragraph 3: nature of the installation — permanent vs. temporary, how it attaches (or doesn't) to the building/common property
- Keep each paragraph to 2–3 sentences
- Do NOT include: headings, signature blocks, the owner's name at the top, or bullet-point owner confirmations — those are added by the template
- Do NOT advocate for or against approval

Organization: ${orgName}
Owner: ${ownerName}
Strata Lot: ${strataLot}
Secretary's informal description: ${description}`,
        },
      ],
    });

    const formalRequest = (message.content[0] as { type: string; text: string }).text.trim();

    return new Response(
      JSON.stringify({ formalRequest }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
