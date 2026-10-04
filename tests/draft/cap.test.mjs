// Tests the migration for step 8 on a real Postgres (PGlite): the new column and the drafting cap.
// Run with: cd tests/draft && npm install && npm run test:cap
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/20261004000001_draft_minutes.sql'), 'utf8');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE organizations (id UUID PRIMARY KEY);
  INSERT INTO organizations VALUES ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
  CREATE TABLE meeting_versions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), html_content TEXT NOT NULL, markdown_content TEXT);
  INSERT INTO meeting_versions (html_content, markdown_content) VALUES ('<p>old</p>', 'old');
`);
await db.exec(sql);
await db.exec(sql);   // twice must be harmless

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const take = async (org, cap) => (await db.query('SELECT take_draft_slot($1, $2) AS ok', [org, cap])).rows[0].ok;
const today = "usage_date = (now() AT TIME ZONE 'utc')::date";
const calls = async (org) => (await db.query(`SELECT calls FROM draft_usage WHERE org_id = $1 AND ${today}`, [org])).rows[0]?.calls;

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 4).join('\n    ')}`); process.exit(1); }
};

await test('the migration runs twice without error', async () => {});
await test('existing versions are untouched and the new column starts empty', async () => {
  const r = (await db.query('SELECT html_content, markdown_content, draft FROM meeting_versions')).rows;
  assert.deepEqual(r, [{ html_content: '<p>old</p>', markdown_content: 'old', draft: null }]);
});
await test('the draft column holds structured data', async () => {
  await db.exec(`INSERT INTO meeting_versions (html_content, draft) VALUES ('x', '{"kind":"workspace-draft","draft":{"sections":[]}}')`);
  const r = (await db.query(`SELECT draft->>'kind' AS k FROM meeting_versions WHERE draft IS NOT NULL`)).rows;
  assert.deepEqual(r, [{ k: 'workspace-draft' }]);
});
await test('drafts inside the cap are allowed and the next is refused, without counting', async () => {
  assert.equal(await take(A, 2), true);
  assert.equal(await take(A, 2), true);
  assert.equal(await take(A, 2), false);
  assert.equal(await take(A, 2), false);
  assert.equal(await calls(A), 2);
});
await test('another organization has its own count, and a new day starts again', async () => {
  assert.equal(await take(B, 2), true);
  assert.equal(await calls(B), 1);
  await db.exec(`UPDATE draft_usage SET usage_date = usage_date - 1 WHERE org_id = '${A}'`);
  assert.equal(await take(A, 2), true);
  assert.equal(await calls(A), 1);
});
await test('a signed-in user cannot call the function or read the counters', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(() => db.query('SELECT take_draft_slot($1, 5)', [A]), /permission denied/);
    await assert.rejects(() => db.query('SELECT * FROM draft_usage'), /permission denied/);
    await db.exec('RESET ROLE');
  }
});
await test('the service role can use it', async () => {
  await db.exec('SET ROLE service_role');
  assert.equal(await take(B, 50), true);
  await db.exec('RESET ROLE');
});

console.log(`\nALL ${passed} DRAFT CAP CHECKS PASSED`);
