-- Create public audio uploads bucket (50 MB per file — Supabase Free tier limit)
-- To increase: upgrade to Pro and update file_size_limit here + MAX_AUDIO_BYTES in app.js and board.js
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio',
  'audio',
  true,
  52428800,
  ARRAY['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','video/mp4']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anonymous users to upload into this bucket
CREATE POLICY "anon_audio_upload"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'audio');
