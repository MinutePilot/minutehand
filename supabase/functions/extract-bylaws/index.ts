import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Safe base64 encoding that avoids spread-operator stack overflow on large arrays.
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface ExtractedParameter {
  category:        string;
  label:           string;
  extracted_value: string;
  source_text:     string;
  confidence:      "high" | "medium" | "low";
}

interface Chunk {
  sectionRef: string | null;
  text:       string;
}

// Split bylaw text into chunks, preserving section references where detectable.
// Heuristics: lines that look like "Bylaw 3", "BYLAW 3", "3.", "Section 4.2", headings.
function chunkText(text: string): Chunk[] {
  if (!text.trim()) return [];

  const lines   = text.split("\n");
  const chunks: Chunk[] = [];
  // Matches: "Bylaw 3", "BYLAW 3", "Section 4", "3.", "3.1.", "Part II", etc.
  const sectionRe = /^(?:bylaw|bylaw\s+\d|section|part|schedule|division|article)\s*\d*|^\d+(\.\d+)*\s*\./i;

  let currentRef: string | null = null;
  let currentLines: string[]     = [];

  const flush = () => {
    const t = currentLines.join("\n").trim();
    if (t.length > 30) chunks.push({ sectionRef: currentRef, text: t });
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (sectionRe.test(trimmed)) {
      flush();
      currentRef = trimmed.slice(0, 80);  // cap ref length
    }
    currentLines.push(line);
    // Keep chunks under ~600 words
    if (currentLines.join(" ").split(/\s+/).length > 600) {
      flush();
    }
  }
  flush();

  // If chunking produced nothing useful (no section markers), fall back to
  // fixed-size chunks of ~500 words each.
  if (chunks.length === 0) {
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length; i += 500) {
      chunks.push({ sectionRef: null, text: words.slice(i, i + 500).join(" ") });
    }
  }

  return chunks;
}

const EXTRACTION_SYSTEM = `You are a data extraction assistant analyzing a strata corporation's bylaws document.

Extract specific governance provisions and return them as a JSON array.

Each element must have exactly these fields:
- "category": one of: "quorum" | "voting_thresholds" | "notice_periods" | "proxy_rules" | "written_resolution" | "fining" | "standard_bylaw_modification"
- "label": concise descriptive name (e.g. "Council meeting quorum", "AGM notice period")
- "extracted_value": the specific rule or value extracted (e.g. "Majority of council members in office", "14 days written notice")
- "source_text": verbatim quote from the bylaws supporting this, max 300 characters
- "confidence": "high" | "medium" | "low"
  - high: provision stated explicitly and unambiguously
  - medium: requires minor inference or wording is somewhat ambiguous
  - low: uncertain interpretation, or source text only partially supports extraction

Categories to look for:
- quorum: minimum attendance required for council or general meetings to be valid
- voting_thresholds: vote percentage or type required for different decisions (ordinary, 3/4, unanimous)
- notice_periods: required advance notice for any type of meeting
- proxy_rules: how proxies are formed, submitted, deadlines, who may hold them
- written_resolution: rules for passing resolutions without a meeting (who must sign, how many)
- fining: fine amounts, fine procedures, notice requirements before imposing a fine
- standard_bylaw_modification: any provision that explicitly replaces, modifies, or opts out of a BC Standard Bylaw default

Rules:
- Only extract what is explicitly present in this document
- Do not supply BC Standard Bylaw defaults as if they were provisions in this document
- A category may have multiple entries (e.g. different quorums for council vs general meeting)
- If a category has no relevant provisions, omit it entirely
- Return ONLY a valid JSON array, no preamble or explanation`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  // ── Board Plan check ──────────────────────────────────────────────────────────
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE);
  const { data: hasPlan } = await supabaseService.rpc("has_board_plan", { p_user_id: user.id });
  if (!hasPlan) return json({ error: "Board Plan required" }, 402);

  // ── Parse request ─────────────────────────────────────────────────────────────
  const body = await req.json();
  const { document_id, org_id, storage_path, mime_type, extracted_text } = body as {
    document_id:    string;
    org_id:         string;
    storage_path:   string;
    mime_type:      string;
    extracted_text?: string;
  };

  if (!document_id || !org_id || !storage_path || !mime_type) {
    return json({ error: "Missing required fields" }, 400);
  }

  // ── Org membership check ──────────────────────────────────────────────────────
  const { data: member } = await supabaseService
    .from("org_members")
    .select("role")
    .eq("org_id", org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "Not a member of this org" }, 403);

  // ── Text extraction ───────────────────────────────────────────────────────────
  try {
    let fullText  = extracted_text ?? "";
    let ocrMethod = extracted_text ? "mammoth" : "claude-pdf";

    if (mime_type === "application/pdf" && !extracted_text) {
      const { data: fileBlob, error: dlErr } = await supabaseService.storage
        .from("governance-documents")
        .download(storage_path);

      if (dlErr || !fileBlob) {
        return json({ error: "Could not download file from storage" }, 500);
      }

      const buf = new Uint8Array(await fileBlob.arrayBuffer());
      const b64 = uint8ToBase64(buf);

      const pdfMsg = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: [
            {
              type:   "document",
              source: { type: "base64", media_type: "application/pdf", data: b64 },
            } as never,
            {
              type: "text",
              text: "Extract the complete text content of this document exactly as written. Preserve bylaw numbers, section headings, and paragraph structure. Return only the raw text — no commentary, no reformatting.",
            },
          ],
        }],
      });

      fullText = pdfMsg.content[0].type === "text" ? pdfMsg.content[0].text : "";
    }

    const ocrQuality = fullText.trim().length < 200 ? "low" : "ok";

    // ── Chunk and store ───────────────────────────────────────────────────────────
    const chunks = chunkText(fullText);

    await supabaseService.from("bylaws_chunks").delete().eq("document_id", document_id);

    if (chunks.length > 0) {
      const { error: chunkErr } = await supabaseService.from("bylaws_chunks").insert(
        chunks.map((c, i) => ({
          document_id,
          org_id,
          section_ref: c.sectionRef,
          chunk_text:  c.text,
          chunk_index: i,
        }))
      );
      if (chunkErr) console.error("chunk insert error", chunkErr);
    }

    // ── Parameter extraction ──────────────────────────────────────────────────────
    let parameters: ExtractedParameter[] = [];

    if (fullText.trim().length >= 200) {
      const extractMsg = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 4096,
        system:     EXTRACTION_SYSTEM,
        messages: [{ role: "user", content: fullText }],
      });

      const raw = extractMsg.content[0].type === "text" ? extractMsg.content[0].text.trim() : "[]";

      try {
        // Strip markdown code fence if present
        const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
        const parsed  = JSON.parse(cleaned);
        if (Array.isArray(parsed)) parameters = parsed;
      } catch {
        console.error("Parameter JSON parse failed, proceeding with empty extraction");
      }
    }

    // ── Store parameters ──────────────────────────────────────────────────────────
    await supabaseService.from("bylaws_parameters").delete().eq("document_id", document_id);

    if (parameters.length > 0) {
      const validCategories = new Set([
        "quorum", "voting_thresholds", "notice_periods", "proxy_rules",
        "written_resolution", "fining", "standard_bylaw_modification",
      ]);
      const validConfidence = new Set(["high", "medium", "low"]);

      const rows = parameters
        .filter((p) => validCategories.has(p.category) && p.label && p.extracted_value)
        .map((p) => ({
          document_id,
          org_id,
          category:        p.category,
          label:           p.label.slice(0, 120),
          extracted_value: p.extracted_value.slice(0, 500),
          source_text:     (p.source_text ?? "").slice(0, 400),
          confidence:      validConfidence.has(p.confidence) ? p.confidence : "medium",
        }));

      if (rows.length > 0) {
        const { error: paramErr } = await supabaseService.from("bylaws_parameters").insert(rows);
        if (paramErr) console.error("parameter insert error", paramErr);
      }
    }

    // ── Update document record ────────────────────────────────────────────────────
    await supabaseService.from("bylaws_documents").update({
      full_text:   fullText,
      ocr_method:  ocrMethod,
      ocr_quality: ocrQuality,
      status:      "extraction_done",
      updated_at:  new Date().toISOString(),
    }).eq("id", document_id);

    return json({
      ok:               true,
      text_length:      fullText.length,
      chunks_count:     chunks.length,
      parameters_count: parameters.length,
      ocr_quality:      ocrQuality,
    });

  } catch (err) {
    console.error("extract-bylaws unhandled error", err);

    // Leave the document in 'processing' so the client can surface a retry.
    await supabaseService.from("bylaws_documents").update({
      status:     "processing",
      updated_at: new Date().toISOString(),
    }).eq("id", document_id).neq("status", "extraction_done");

    return json({ error: "Extraction failed", detail: String(err) }, 500);
  }
});
