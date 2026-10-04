// Tests the daily cap function from the migration, run on a real Postgres (PGlite).
// Run with: cd tests/chat && npm install && npm run test:cap
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const sql = fs.readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/20261004000000_chat_entry_usage.sql'), 'utf8');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE organizations (id UUID PRIMARY KEY);
  INSERT INTO organizations VALUES ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
`);
await db.exec(sql);
await db.exec(sql);   // running it twice must be harmless

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const take = async (org, cap) => (await db.query('SELECT take_chat_entry_slot($1, $2) AS ok', [org, cap])).rows[0].ok;
const calls = async (org) => (await db.query("SELECT calls FROM chat_entry_usage WHERE org_id = $1 AND usage_date = (now() AT TIME ZONE 'utc')::date", [org])).rows[0]?.calls;

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 4).join('\n    ')}`); process.exit(1); }
};

await test('the migration runs twice without error', async () => {});
await test('messages inside the cap are allowed and the next is refused', async () => {
  assert.equal(await take(A, 3), true);
  assert.equal(await take(A, 3), true);
  assert.equal(await take(A, 3), true);
  assert.equal(await take(A, 3), false);
  assert.equal(await take(A, 3), false);
});
await test('a refused message is not counted, so the count stops at the cap', async () => {
  assert.equal(await calls(A), 3);
});
await test('another organization has its own count', async () => {
  assert.equal(await take(B, 3), true);
  assert.equal(await calls(B), 1);
});
await test('a new day starts again from zero', async () => {
  await db.exec(`UPDATE chat_entry_usage SET usage_date = usage_date - 1 WHERE org_id = '${A}'`);
  assert.equal(await take(A, 3), true);
  assert.equal(await calls(A), 1);
});
await test('a cap of zero refuses everything', async () => {
  assert.equal(await take('22222222-2222-2222-2222-222222222222', 0), false);
});
await test('a signed-in user cannot call the function or read the counters directly', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(() => db.query('SELECT take_chat_entry_slot($1, 5)', [A]), /permission denied/);
    await assert.rejects(() => db.query('SELECT * FROM chat_entry_usage'), /permission denied/);
    await db.exec('RESET ROLE');
  }
});
await test('the service role can call it', async () => {
  await db.exec('SET ROLE service_role');
  assert.equal(await take(B, 50), true);
  await db.exec('RESET ROLE');
});

console.log(`\nALL ${passed} CHAT CAP CHECKS PASSED`);
