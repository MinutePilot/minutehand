// Applies every migration, in order, to an in-memory Postgres (PGlite) with just enough
// of Supabase's auth schema, roles and extensions stubbed in to run them.
// Developer-only: nothing here is loaded by the website.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
  CREATE SCHEMA extensions; CREATE SCHEMA vault;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE FUNCTION vault.create_secret(a text, b text DEFAULT NULL, c text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
  CREATE SCHEMA net;
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
`);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const failed = [];
for (const f of files) {
  const sql = fs.readFileSync(`${dir}/${f}`, 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pg_net[^;]*;/gi, '');
  try { await db.exec(sql); console.log('ok   ', f); }
  catch (e) { console.log('FAIL ', f, '-', String(e.message).split('\n')[0]); failed.push(f); }
}
export { db, failed };
