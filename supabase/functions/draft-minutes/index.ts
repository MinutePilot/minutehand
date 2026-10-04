// Drafts, approves and reopens a meeting's minutes. See handler.mjs for what each action does.
//
// Called by the workspace page with the signed-in user's token; only organization owners and
// admins may use it. The function reads the meeting's entries itself, so the browser cannot
// claim different ones.
//
// Required Supabase secrets: ANTHROPIC_API_KEY
// Optional:                  DRAFT_DAILY_CAP (drafts per organization per day, default 20)

import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { createClient } from "npm:@supabase/supabase-js@^2";
import { makeHandler } from "./handler.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "missing" });

Deno.serve(makeHandler({ admin, anthropic, env: { DRAFT_DAILY_CAP: Deno.env.get("DRAFT_DAILY_CAP") } }));
