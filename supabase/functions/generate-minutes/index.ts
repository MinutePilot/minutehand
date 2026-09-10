import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { createClient } from "npm:@supabase/supabase-js@^2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Template configs ──────────────────────────────────────────────────────────

interface Template {
  displayName: string;
  terminology: { group: string; chair: string; decisions: string; members: string };
  motionFormat: string;
  requiredSections: string[];
  tone: string;
  extraNotes: string;
}

const TEMPLATES: Record<string, Template> = {
  STRATA: {
    displayName: "Strata Council (BC)",
    terminology: {
      group: "Strata Council",
      chair: "President",
      decisions: "Motions",
      members: "Council Members",
    },
    motionFormat: "MOVED by [Name], SECONDED by [Name] — CARRIED / DEFEATED",
    requiredSections: [
      "Quorum",
      "Call to Order",
      "Approval of Agenda",
      "Approval of Previous Minutes",
      "Correspondence",
      "Financial Report",
      "Old Business",
      "New Business",
      "Action Items",
      "Adjournment",
      "Next Meeting",
    ],
    tone: "formal",
    extraNotes:
      "BC strata corporations are governed by the Strata Property Act. Record all motions in full formal format. Include strata lot numbers when owners are identified by lot.",
  },

  HOA_GENERIC: {
    displayName: "HOA Board",
    terminology: {
      group: "Board",
      chair: "President",
      decisions: "Motions",
      members: "Board Members",
    },
    motionFormat: "MOVED by [Name], SECONDED by [Name] — CARRIED / DEFEATED",
    requiredSections: [
      "Quorum",
      "Call to Order",
      "Approval of Previous Minutes",
      "Financial Report",
      "Old Business",
      "New Business",
      "Action Items",
      "Adjournment",
    ],
    tone: "formal",
    extraNotes: "",
  },

  NONPROFIT_BOARD: {
    displayName: "Nonprofit Board",
    terminology: {
      group: "Board",
      chair: "Chair",
      decisions: "Resolutions",
      members: "Directors",
    },
    motionFormat:
      "RESOLVED that [resolution text]. Moved by [Name], seconded by [Name]. Carried / Defeated.",
    requiredSections: [
      "Quorum",
      "Call to Order",
      "Approval of Previous Minutes",
      "Financial Report",
      "Committee Reports",
      "Old Business",
      "New Business",
      "Action Items",
      "Adjournment",
    ],
    tone: "semi-formal",
    extraNotes: "",
  },

  TEAM_INFORMAL: {
    displayName: "Team / Informal Meeting",
    terminology: {
      group: "Team",
      chair: "Facilitator",
      decisions: "Decisions",
      members: "Attendees",
    },
    motionFormat: "none",
    requiredSections: [],
    tone: "casual",
    extraNotes:
      "Emphasise action items with clear owners and deadlines. No formal motion recording needed.",
  },
};

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(notes: string, templateKey: string): { system: string; user: string } {
  const t = TEMPLATES[templateKey] ?? TEMPLATES["STRATA"];

  const sectionsText =
    t.requiredSections.length > 0
      ? t.requiredSections.map((s) => `- ${s}`).join("\n")
      : "No fixed required sections. Organise around: discussion topics, decisions made, and action items with owners.";

  const motionText =
    t.motionFormat === "none"
      ? "No formal motions for this meeting type."
      : `Format every motion exactly as:\n${t.motionFormat}`;

  const system = `You are a professional meeting secretary producing ${t.tone} meeting minutes for a ${t.terminology.group}.

RULES — follow exactly:
1. Structure the minutes using the required sections listed by the user, in order.
2. Use this terminology throughout — group: "${t.terminology.group}", chair/presiding officer: "${t.terminology.chair}", formal decisions: "${t.terminology.decisions}", voting members: "${t.terminology.members}".
3. ${motionText}
4. Attribute statements only to named people clearly identified in the source material. Never invent or infer attribution.
5. For any required section where the source material contains no information, output the section heading followed by exactly this text: [Not stated — please confirm]
6. If the source material contains ambiguous, contradictory, or sensitive content, flag it with a parenthetical note rather than silently resolving it.
7. Output in Markdown using this exact heading hierarchy — do not deviate:
   - # for the document title only (e.g., "MEETING MINUTES")
   - ## for the organization/corporation name (one line, immediately after the title)
   - ### for the meeting type and date (one line, e.g., "Strata Council Meeting — October 21, 2026")
   - Immediately after ###, output each meeting metadata field as its own blockquote line:
     > **Location:** value
     > **Meeting called to order:** value
     > **Minutes recorded by:** value
     One blockquote per field. Never combine multiple fields onto a single line.
   - A horizontal rule: ---
   - #### for every main section heading (Quorum, Call to Order, Approval of Agenda, Financial Report, etc.)
   - ##### for subsections within a section, if needed
8. End with an Action Items section (#### heading) containing a Markdown table: | Action | Responsible Party | Due Date |
9. Tone: ${t.tone}.${t.extraNotes ? `\n10. ${t.extraNotes}` : ""}`;

  const user = `REQUIRED SECTIONS (produce each, in this order):
${sectionsText}

RAW MEETING NOTES / TRANSCRIPT:
---
${notes}
---

Generate complete, properly formatted meeting minutes from the source material. Follow all system prompt rules. For any required section with no supporting information, use [Not stated — please confirm].`;

  return { system, user };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth + credit check ───────────────────────────────────────────────────

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return json({ error: "Authentication required" }, 401);

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: hasCredit, error: creditError } = await supabaseAdmin.rpc(
    "check_and_deduct_credit",
    { p_user_id: user.id }
  );

  if (creditError) {
    console.error("Credit check error:", creditError);
    return json({ error: "Failed to verify credits" }, 500);
  }

  if (!hasCredit) {
    return json({ error: "No credits remaining", code: "NO_CREDITS" }, 402);
  }

  // ── Parse request ─────────────────────────────────────────────────────────

  let notes: string;
  let template: string;

  try {
    const body = await req.json();
    notes    = (body.notes    ?? "").trim();
    template = ((body.template ?? "STRATA") as string).toUpperCase();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!notes) return json({ error: "notes is required" }, 400);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  const client = new Anthropic({ apiKey });
  const { system, user: userPrompt } = buildPrompt(notes, template);

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const minutes = msg.content[0].type === "text" ? msg.content[0].text : "";
    return json({ minutes, template });
  } catch (err) {
    console.error("Anthropic API error:", err);
    const { error: restoreError } = await supabaseAdmin.rpc("restore_credit", { p_user_id: user.id });
    if (restoreError) console.error("Credit restore failed:", restoreError);
    return json({ error: "Failed to generate minutes. Please try again." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
