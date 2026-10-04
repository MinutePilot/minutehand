// Turns one chat message from the secretary into unconfirmed entries for the minutes.
//
// Called by the workspace page with the signed-in user's token. The function looks up the
// meeting, roster and agenda item itself, so the browser cannot claim a different organization.
// It only returns suggestions. Nothing is saved here.
//
// Required Supabase secrets: ANTHROPIC_API_KEY
// Optional:                  CHAT_ENTRY_DAILY_CAP (messages per organization per day, default 200)

import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { createClient } from "npm:@supabase/supabase-js@^2";
import { TOOL, systemPrompt, userPrompt, cleanEntries, checkRequest } from "./logic.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-5-5";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const fail = (code: string, status: number) => json({ code }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("BAD_REQUEST", 405);

  // ── Who is asking ──────────────────────────────────────────────────────────
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("NOT_SIGNED_IN", 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return fail("NOT_SIGNED_IN", 401);
  const userId = auth.user.id;

  // ── What they asked ────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await req.json(); } catch { return fail("BAD_REQUEST", 400); }
  const asked = checkRequest(body);
  if ("error" in asked) return fail(asked.error as string, 400);

  // ── Is the meeting theirs ──────────────────────────────────────────────────
  const { data: meeting } = await admin.from("meetings").select("id, org_id, meeting_date").eq("id", asked.meetingId).maybeSingle();
  if (!meeting) return fail("MEETING_NOT_FOUND", 404);

  const { data: member } = await admin.from("org_members").select("user_id").eq("org_id", meeting.org_id).eq("user_id", userId).maybeSingle();
  if (!member) return fail("NOT_A_MEMBER", 403);

  const { data: beta } = await admin.from("workspace_beta").select("org_id").eq("org_id", meeting.org_id).maybeSingle();
  if (!beta) return fail("NO_ACCESS", 403);

  const [rosterRes, itemRes] = await Promise.all([
    admin.from("roster").select("id, name, role").eq("org_id", meeting.org_id).eq("status", "active").order("sort_order"),
    asked.agendaItemId
      ? admin.from("agenda_items").select("id, title").eq("id", asked.agendaItemId).eq("meeting_id", meeting.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (rosterRes.error) { console.error(rosterRes.error); return fail("UNAVAILABLE", 502); }
  if (asked.agendaItemId && !itemRes.data) return fail("BAD_REQUEST", 400);

  // ── The daily cap ──────────────────────────────────────────────────────────
  const cap = Number(Deno.env.get("CHAT_ENTRY_DAILY_CAP") ?? 200);
  const { data: allowed, error: capError } = await admin.rpc("take_chat_entry_slot", { p_org: meeting.org_id, p_cap: cap });
  if (capError) { console.error(capError); return fail("UNAVAILABLE", 502); }
  if (!allowed) return fail("LIMIT", 429);

  // ── Ask the model ──────────────────────────────────────────────────────────
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not configured"); return fail("UNAVAILABLE", 502); }

  let raw: unknown = null;
  try {
    const msg = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(),
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: userPrompt({ message: asked.message, roster: rosterRes.data ?? [], agendaItem: itemRes.data, meetingDate: meeting.meeting_date }),
      }],
    });
    raw = msg.content.find((b: { type: string }) => b.type === "tool_use")?.input ?? null;
  } catch (err) {
    console.error("Anthropic error:", err);
    return fail("UNAVAILABLE", 502);
  }

  return json(cleanEntries(raw, rosterRes.data ?? []));
});
