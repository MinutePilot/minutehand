// Transcription vendor: Deepgram nova-2 with speaker diarization.
// To swap vendors, replace the callDeeepgram function and adjust the word shape.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&smart_format=true&punctuate=true";
const INTRO_WINDOW_SEC = 120; // scan first 2 min for speaker name introductions

interface Word {
  word: string;
  punctuated_word?: string;
  speaker: number;
  start: number;
}

interface Speaker {
  id: number;
  label: string;
  guessedName: string;
}

// Patterns that typically appear when someone introduces themselves
const INTRO_PATTERNS = [
  /(?:I'm|I am|this is|my name is|it's|hi,?\s*I'm|hello,?\s*I'm)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
  /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:here|speaking)\b/,
  /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?),\s*(?:president|vice.president|secretary|treasurer|chair|director|council member)/i,
];

function buildTranscriptAndSpeakers(words: Word[]): {
  rawTranscript: string;
  speakers: Speaker[];
} {
  if (words.length === 0) return { rawTranscript: "", speakers: [] };

  // Merge consecutive words by the same speaker into turns
  const turns: { speaker: number; text: string[] }[] = [];
  let cur = { speaker: words[0].speaker, text: [] as string[] };

  for (const w of words) {
    if (w.speaker !== cur.speaker) {
      turns.push(cur);
      cur = { speaker: w.speaker, text: [] };
    }
    cur.text.push(w.punctuated_word ?? w.word);
  }
  turns.push(cur);

  const speakerIds = [...new Set(words.map((w) => w.speaker))].sort((a, b) => a - b);

  // Guess names from each speaker's own words in the opening window
  const guessedNames: Record<number, string> = {};
  for (const id of speakerIds) {
    const openingText = words
      .filter((w) => w.speaker === id && w.start < INTRO_WINDOW_SEC)
      .map((w) => w.punctuated_word ?? w.word)
      .join(" ");

    for (const pattern of INTRO_PATTERNS) {
      const m = openingText.match(pattern);
      if (m?.[1]) {
        guessedNames[id] = m[1].trim();
        break;
      }
    }
  }

  // Build raw transcript with "Speaker N:" labels (user will replace with real names)
  const lines = turns.map((t) => `Speaker ${t.speaker + 1}: ${t.text.join(" ")}`);

  const speakers: Speaker[] = speakerIds.map((id) => ({
    id,
    label: `Speaker ${id + 1}`,
    guessedName: guessedNames[id] ?? "",
  }));

  return { rawTranscript: lines.join("\n"), speakers };
}

async function callDeeepgram(audioUrl: string, apiKey: string) {
  const resp = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("Deepgram error:", resp.status, body);
    throw new Error(`Deepgram returned ${resp.status}`);
  }

  const data = await resp.json();
  const words: Word[] = data?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let audioUrl: string;
  try {
    const body = await req.json();
    audioUrl = (body.audioUrl ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!audioUrl) return json({ error: "audioUrl is required" }, 400);

  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) return json({ error: "DEEPGRAM_API_KEY not configured" }, 500);

  try {
    const words = await callDeeepgram(audioUrl, apiKey);
    const { rawTranscript, speakers } = buildTranscriptAndSpeakers(words);
    return json({ rawTranscript, speakers });
  } catch (err) {
    console.error("Transcription error:", err);
    return json({ error: "Transcription failed. Please try again." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
