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
5b. OMITTING ZERO-SIGNAL BOILERPLATE: For required sections that are purely procedural template items with genuinely zero supporting content in the source material (no mention of correspondence, no old business raised, no agenda-approval step referenced at all), omit the section entirely rather than including it with a placeholder. Do not invent a section that never arose. In practice: Quorum, Financial Report, and Adjournment are almost always worth including; Correspondence, Approval of Agenda, Approval of Previous Minutes, and Old Business should be omitted if the source has no signal for them.
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

// ── Board Plan: structured JSON output suffix ─────────────────────────────────
// Appended to the system prompt for Board Plan users. Same Claude call, same
// credit cost — the structured field is extracted from what Claude writes in
// the markdown field, so no additional AI work is required.

function boardPlanJsonSuffix(): string {
  return `

OUTPUT FORMAT — REQUIRED FOR THIS REQUEST:
Return a single valid JSON object. No text before or after it. No markdown code fences.
The object must have exactly two top-level keys:

"markdown": string — the complete meeting minutes formatted exactly per all rules above.

"structured": object extracted from what you wrote in "markdown":
{
  "meeting_date": "YYYY-MM-DD if determinable from the source, otherwise null",
  "title": "the ### heading line, e.g. 'Strata Council Meeting — September 15, 2026'",
  "motions": [
    {
      "description": "the motion substance — what was moved, not the MOVED/SECONDED/CARRIED attribution line",
      "moved_by": "name string or null",
      "seconded_by": "name string or null",
      "result": "carried | defeated | tabled | withdrawn",
      "vote_tally": "'3-0' format string or null",
      "sort_order": 1
    }
  ],
  "action_items": [
    {
      "description": "the Action column text from the Action Items table",
      "responsible_party": "name string or null",
      "due_date_text": "the Due Date column text exactly as written, or null",
      "due_date_parsed": "YYYY-MM-DD only when a specific calendar date is unambiguously implied — null for 'ongoing', 'TBD', 'at board's discretion', or any vague timing",
      "sort_order": 1
    }
  ]
}

Extract motions and action items directly from what you wrote in the markdown field. Do not fabricate structured data not present in the generated minutes.`;
}

// ── Structured output types ───────────────────────────────────────────────────

interface StructuredMotion {
  description: string;
  moved_by: string | null;
  seconded_by: string | null;
  result: "carried" | "defeated" | "tabled" | "withdrawn";
  vote_tally: string | null;
  sort_order: number;
}

interface StructuredActionItem {
  description: string;
  responsible_party: string | null;
  due_date_text: string | null;
  due_date_parsed: string | null;
  sort_order: number;
}

interface StructuredData {
  meeting_date: string | null;
  title: string | null;
  motions: StructuredMotion[];
  action_items: StructuredActionItem[];
}

interface BoardPlanResponse {
  markdown: string;
  structured: StructuredData;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

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

  // ── Credit check ──────────────────────────────────────────────────────────

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

  // ── Board Plan tier check ─────────────────────────────────────────────────

  const { data: isBoardPlan } = await supabaseAdmin.rpc("has_board_plan", { p_user_id: user.id });

  let orgId: string | null = null;
  if (isBoardPlan) {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!org) {
      // Restore the credit — we're not generating anything
      await supabaseAdmin.rpc("restore_credit", { p_user_id: user.id });
      return json({ error: "Organization not set up", code: "NO_ORG" }, 402);
    }
    orgId = org.id;
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  const client = new Anthropic({ apiKey });
  const { system, user: userPrompt } = buildPrompt(notes, template);
  const finalSystem = isBoardPlan ? system + boardPlanJsonSuffix() : system;

  let rawText = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: isBoardPlan ? 8192 : 4096,
      system: finalSystem,
      messages: [{ role: "user", content: userPrompt }],
    });
    rawText = msg.content[0].type === "text" ? msg.content[0].text : "";
  } catch (err) {
    console.error("Anthropic API error:", err);
    await supabaseAdmin.rpc("restore_credit", { p_user_id: user.id });
    return json({ error: "Failed to generate minutes. Please try again." }, 500);
  }

  // ── Standard tier: return markdown directly ───────────────────────────────

  if (!isBoardPlan) {
    return json({ minutes: rawText, template });
  }

  // ── Board Plan: parse structured JSON response ────────────────────────────

  let markdown = rawText;
  let structured: StructuredData | null = null;

  try {
    // Strip markdown fences if Claude wrapped the JSON despite instructions
    const cleaned = rawText
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
    const parsed: BoardPlanResponse = JSON.parse(cleaned);
    markdown   = parsed.markdown   ?? rawText;
    structured = parsed.structured ?? null;
  } catch (err) {
    console.error("Board Plan JSON parse failed:", err);
    // Graceful degradation: minutes were generated, return them without saving
    return json({ minutes: rawText, template, warning: "structured_parse_failed" });
  }

  // ── Board Plan: persist meeting + motions + action items ──────────────────

  let meetingId: string | null = null;
  try {
    const { data: meeting, error: meetingErr } = await supabaseAdmin
      .from("meetings")
      .insert({
        org_id:       orgId,
        user_id:      user.id,
        meeting_date: structured?.meeting_date ?? null,
        title:        structured?.title        ?? null,
        template,
        status:       "draft",
        markdown,
        source_notes: notes,
      })
      .select("id")
      .single();

    if (meetingErr) throw meetingErr;
    meetingId = meeting.id;

    if (structured?.motions?.length) {
      const { error: motionsErr } = await supabaseAdmin.from("motions").insert(
        structured.motions.map((m) => ({
          meeting_id:  meetingId,
          org_id:      orgId,
          description: m.description,
          moved_by:    m.moved_by    ?? null,
          seconded_by: m.seconded_by ?? null,
          result:      m.result,
          vote_tally:  m.vote_tally  ?? null,
          sort_order:  m.sort_order,
        }))
      );
      if (motionsErr) console.error("Motions insert error:", motionsErr);
    }

    if (structured?.action_items?.length) {
      const { error: aiErr } = await supabaseAdmin.from("action_items").insert(
        structured.action_items.map((a) => ({
          meeting_id:        meetingId,
          org_id:            orgId,
          description:       a.description,
          responsible_party: a.responsible_party ?? null,
          due_date_text:     a.due_date_text      ?? null,
          due_date_parsed:   a.due_date_parsed    ?? null,
          sort_order:        a.sort_order,
        }))
      );
      if (aiErr) console.error("Action items insert error:", aiErr);
    }
  } catch (err) {
    console.error("Meeting persist error:", err);
    // Minutes were generated successfully — return them even if DB write failed
    return json({ minutes: markdown, template, warning: "persist_failed" });
  }

  return json({ minutes: markdown, template, meeting_id: meetingId });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
