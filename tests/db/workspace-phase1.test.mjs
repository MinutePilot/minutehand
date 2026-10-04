// Run with: cd tests/db && npm install && npm test
import { db, failed } from './run.mjs';
import assert from 'node:assert/strict';

assert.deepEqual(failed, [], 'every migration, including the new one, applies cleanly in order');

const A = '00000000-0000-0000-0000-00000000000a';   // owner of org A (the secretary)
const B = '00000000-0000-0000-0000-00000000000b';   // owner of org B (a different organization)
const C = '00000000-0000-0000-0000-00000000000c';   // plain member of org A
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`);

const as = async (uid) => {
  await db.exec('RESET ROLE');
  if (uid) { await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid}', false)`); await db.exec('SET ROLE authenticated'); }
};
const denied = async (sql, why) => {
  let err = null;
  try { await db.exec(sql); } catch (e) { err = e; }
  assert.ok(err, `expected an error: ${why}`); ok(why);
};
const q = async (sql) => (await db.query(sql)).rows;

// ── setup as superuser ──
await as(null);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${A}','a@x.test'),('${B}','b@x.test'),('${C}','c@x.test');
`);
const orgA = (await q(`INSERT INTO organizations (owner_id, name, org_type) VALUES ('${A}','Org A','STRATA') RETURNING id`))[0].id;
const orgB = (await q(`INSERT INTO organizations (owner_id, name, org_type) VALUES ('${B}','Org B','HOA_GENERIC') RETURNING id`))[0].id;
await db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES ('${orgA}','${C}','member') ON CONFLICT DO NOTHING`);
const roles = await q(`SELECT user_id, role FROM org_members WHERE org_id='${orgA}' ORDER BY role`);
assert.equal(roles.length, 2, 'org A has an owner and a plain member');
const dana = (await q(`INSERT INTO roster (org_id, name, role) VALUES ('${orgA}','Dana Whitfield','President') RETURNING id`))[0].id;
const lee  = (await q(`INSERT INTO roster (org_id, name, role) VALUES ('${orgA}','Lee Tran','Director') RETURNING id`))[0].id;

console.log('Existing behaviour');
// A legacy-style row: markdown given, no new columns.
await db.exec(`INSERT INTO meetings (org_id, user_id, markdown, status) VALUES ('${orgA}','${A}','# old minutes','approved')`);
ok('an existing-style approved meeting still inserts');
const legacy = (await q(`INSERT INTO motions (meeting_id, org_id, description)
   SELECT id, org_id, 'old motion' FROM meetings WHERE markdown='# old minutes' RETURNING confirmed`))[0];
assert.equal(legacy.confirmed, true); ok('existing-style motions default to confirmed');

console.log('New meeting states');
await as(A);
const mtg = (await q(`INSERT INTO meetings (org_id, user_id, status, title) VALUES ('${orgA}','${A}','planned','Oct meeting') RETURNING id, markdown`))[0];
assert.equal(mtg.markdown, null); ok('a planned meeting needs no markdown');
await db.exec(`UPDATE meetings SET status='in_progress' WHERE id='${mtg.id}'`); ok('status can move to in_progress');
await denied(`UPDATE meetings SET status='bogus' WHERE id='${mtg.id}'`, 'an unknown status is rejected');

console.log('Secretary (owner) can capture a meeting');
const item = (await q(`INSERT INTO agenda_items (meeting_id, org_id, title, source, sort_order) VALUES ('${mtg.id}','${orgA}','3. Budget','template',3) RETURNING id`))[0].id;
await db.exec(`INSERT INTO attendance (meeting_id, org_id, roster_id, display_name) VALUES ('${mtg.id}','${orgA}','${dana}','Dana Whitfield')`);
await db.exec(`INSERT INTO attendance (meeting_id, org_id, display_name, proxy_for_lot) VALUES ('${mtg.id}','${orgA}','Guest Person','Lot 14')`);
ok('attendance accepts a roster member and a proxy guest');
await denied(`INSERT INTO attendance (meeting_id, org_id, roster_id, display_name) VALUES ('${mtg.id}','${orgA}','${dana}','Dana again')`, 'a roster member cannot be listed twice for one meeting');
await db.exec(`INSERT INTO motions (meeting_id, org_id, description, agenda_item_id, mover_roster_id, seconder_roster_id, result, confirmed)
               VALUES ('${mtg.id}','${orgA}','Approve the budget','${item}','${dana}','${lee}','carried',false)`);
ok('a motion links to its agenda item and roster members, unconfirmed');
await db.exec(`INSERT INTO action_items (meeting_id, org_id, description, agenda_item_id, owner_roster_id, confirmed)
               VALUES ('${mtg.id}','${orgA}','Get roof quotes','${item}','${lee}',false)`);
ok('an action item links the same way');
const t0 = (await q(`SELECT updated_at FROM agenda_items WHERE id='${item}'`))[0].updated_at;
await new Promise(r => setTimeout(r, 15));
await db.exec(`UPDATE agenda_items SET notes='Reviewed the draft' WHERE id='${item}'`);
const t1 = (await q(`SELECT updated_at FROM agenda_items WHERE id='${item}'`))[0].updated_at;
assert.ok(new Date(t1) > new Date(t0)); ok('agenda_items.updated_at moves on update');

console.log('Another organization is locked out');
await as(B);
assert.equal((await q(`SELECT 1 FROM agenda_items`)).length, 0); ok("B cannot read A's agenda items");
assert.equal((await q(`SELECT 1 FROM attendance`)).length, 0);   ok("B cannot read A's attendance");
await denied(`INSERT INTO agenda_items (meeting_id, org_id, title) VALUES ('${mtg.id}','${orgA}','sneaky')`, "B cannot add an item under A's organization");
await denied(`INSERT INTO agenda_items (meeting_id, org_id, title) VALUES ('${mtg.id}','${orgB}','sneaky')`, "B cannot attach an item to A's meeting even under B's own organization id");
await denied(`INSERT INTO attendance (meeting_id, org_id, display_name) VALUES ('${mtg.id}','${orgB}','sneaky')`, "B cannot attach attendance to A's meeting either");

console.log('Plain member vs owner');
await as(C);
assert.equal((await q(`SELECT 1 FROM agenda_items`)).length, 1); ok('a member can read the meeting');
await db.exec(`UPDATE agenda_items SET notes='member edit' WHERE id='${item}'`); ok('a member can edit');
await db.exec(`DELETE FROM agenda_items WHERE id='${item}'`);
assert.equal((await q(`SELECT 1 FROM agenda_items`)).length, 1); ok('a plain member cannot delete (the reason the secretary is made an admin)');
await as(A);
await db.exec(`DELETE FROM agenda_items WHERE id='${item}'`);
assert.equal((await q(`SELECT 1 FROM agenda_items`)).length, 0); ok('the owner can delete');
const m = (await q(`SELECT agenda_item_id FROM motions WHERE description='Approve the budget'`))[0];
assert.equal(m.agenda_item_id, null); ok('deleting an agenda item keeps its motion, unlinked');

console.log('Roster changes do not rewrite history');
await db.exec(`DELETE FROM roster WHERE id='${dana}'`);
const att = (await q(`SELECT roster_id, display_name FROM attendance WHERE display_name='Dana Whitfield'`))[0];
assert.equal(att.roster_id, null); assert.equal(att.display_name, 'Dana Whitfield'); ok('a removed roster member leaves their name on past attendance');

console.log('Beta switch');
await as(null);
await db.exec(`INSERT INTO workspace_beta (org_id) VALUES ('${orgA}')`);
await as(A);
assert.equal((await q(`SELECT 1 FROM workspace_beta`)).length, 1); ok('A sees that its organization is switched on');
await denied(`INSERT INTO workspace_beta (org_id) VALUES ('${orgA}')`, 'a user cannot insert their own switch');
await denied(`INSERT INTO workspace_beta (org_id) VALUES ('${orgB}')`, "a user cannot switch another organization on");
await db.exec(`DELETE FROM workspace_beta WHERE org_id='${orgA}'`);
assert.equal((await q(`SELECT 1 FROM workspace_beta`)).length, 1); ok('a user cannot switch their organization off either');
await as(B);
assert.equal((await q(`SELECT 1 FROM workspace_beta`)).length, 0); ok("B cannot see A's switch");

console.log('\nALL MIGRATION CHECKS PASSED');
