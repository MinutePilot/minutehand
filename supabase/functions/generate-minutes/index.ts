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
4. ATTRIBUTION — STRICT RULE: Attribute statements, votes, and action-item ownership only to people who are explicitly named in the source material. Never invent or guess a specific person's name — not even with a hedging caveat like "likely" or "presumably" or a footnote. If a name is not stated in the source, describe the fact without a name:
   - Vote tallies: state the count and any explicitly named positions (e.g. "CARRIED 3–1; Jane D opposed; Ellen R absent for vote") but do not name unconfirmed voters. Do not fill in a missing voter's name even in a footnote.
   - Action items: if no owner is named in the source, leave Responsible Party as "[Owner not stated]" rather than inferring a name.
   - Motion attribution: only record MOVED/SECONDED names that are explicitly stated in the source.
5a. FLAGGING IMPORTANT GAPS: For any required section where the source contains no information AND the gap is materially significant — such as quorum threshold not stated, exact financial figures described as approximate, or meeting location genuinely unknown — include the section heading and flag it as: [Not stated — please confirm]
5b. OMITTING ZERO-SIGNAL BOILERPLATE: For required sections that are purely procedural template items with genuinely zero supporting content in the source material (no mention of correspondence, no old business raised, no agenda-approval step referenced at all), omit the section entirely rather than including it with a placeholder. Do not invent a section that never arose. In practice: Quorum, Financial Report, and Adjournment are almost always worth including; Correspondence, Approval of Agenda, and Old Business should be omitted if the source has no signal for them.
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
   - For the Location/Format field: if the source contains clear contextual signals about meeting format (phrases such as "on the call," "dialed in," "via Zoom," "via Teams," "via Meet," "joined by phone," "in the boardroom," "attended in person"), infer the format and label it clearly, e.g. "> **Location:** Video call (Zoom) — inferred from source context". Only use "[Not stated — please confirm]" when the source has no signals at all about format or location.
   - A horizontal rule: ---
   - #### for every main section heading (Quorum, Call to Order, Approval of Agenda, Financial Report, etc.)
   - ##### for subsections within a section, if needed
8. End with an Action Items section (#### heading) containing a Markdown table: | Action | Responsible Party | Due Date |
   - For the Due Date field: if the action item's own description or surrounding source context implies a target date or meeting (e.g. "for review at the next meeting," "before the AGM," "by end of week," "obtain by [date]"), populate Due Date from that context rather than flagging as not stated. Only use "[Not stated — please confirm]" when there is genuinely no timing signal in the source.
9. DRAFT DISCLAIMER — MANDATORY: After the Action Items table, always append this closing line as its own paragraph: "These minutes are presented in draft form and are subject to approval at the next ${t.displayName}." If the next meeting date is stated in the source material, append it in parentheses after the sentence. This line must appear in every generated document without exception.
10. Tone: ${t.tone}.${t.extraNotes ? `\n11. ${t.extraNotes}` : ""}`;

  const user = `REQUIRED SECTIONS (produce each, in this order):
${sectionsText}

RAW MEETING NOTES / TRANSCRIPT:
---
${notes}
---

Generate complete, properly formatted meeting minutes from the source material. Follow all system prompt rules exactly. For required sections where the gap is materially significant, use [Not stated — please confirm]. For purely procedural sections with zero source signal, omit the section entirely. End with the mandatory draft disclaimer.`;

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
