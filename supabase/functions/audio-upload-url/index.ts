// Returns a presigned R2 PUT URL for the client to upload audio directly,
// plus a presigned GET URL for Deepgram to fetch it from transcribe.
// The transcribe function deletes the R2 object after transcription completes.

import { S3Client, PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const accountId       = Deno.env.get("CLOUDFLARE_R2_ACCOUNT_ID");
  const accessKeyId     = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket          = Deno.env.get("CLOUDFLARE_R2_BUCKET") ?? "minutehand-audio-temp";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return json({ error: "R2 credentials not configured" }, 500);
  }

  let ext = "mp3";
  let contentType = "audio/mpeg";
  try {
    const body = await req.json();
    if (body.ext) ext = String(body.ext).replace(/[^a-z0-9]/gi, "").slice(0, 8);
    if (body.contentType) contentType = String(body.contentType);
  } catch { /* use defaults */ }

  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const [uploadUrl, audioUrl] = await Promise.all([
    // PUT URL for the browser upload — 1 hour
    getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 3600 },
    ),
    // GET URL for Deepgram — 2 hours (large files can take longer to transcribe)
    getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 7200 },
    ),
  ]);

  return json({ uploadUrl, audioUrl, key });
});
