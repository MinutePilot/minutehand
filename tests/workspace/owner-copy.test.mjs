// Tests for what an owner is allowed to see (workspace-owner-copy.js). No browser needed.
// Run with: cd tests/workspace && npm run test:owner-copy
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const code = fs.readFileSync(path.resolve(import.meta.dirname, '../../workspace-owner-copy.js'), 'utf8');
const OwnerCopy = vm.runInNewContext(`${code}\n;OwnerCopy`);

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 8).join('\n    ')}`); process.exit(1); }
};

const MEETING = { id: 'mt1', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00Z', location: 'Amenity room',
                  markdown: 'SECRET-MARKDOWN', source_notes: 'SECRET-SOURCE', status: 'in_progress', user_id: 'u1' };
const AGENDA = [
  { id: 'a1', title: 'Call to order', notes: 'Opened at 7:00', sort_order: 0, is_in_camera: false },
  { id: 'a2', title: 'SECRET-TITLE Dispute with Lot 12', notes: 'SECRET-NOTES lawyer said we will lose', sort_order: 1, is_in_camera: true,
    public_title: 'Legal matter', public_summary: 'Advice was received.' },
  { id: 'a3', title: 'Budget', notes: '', sort_order: 2, is_in_camera: false },
];
const MOTIONS = [
  { id: 'm1', agenda_item_id: 'a3', description: 'Approve the budget', moved_by: 'Alice', seconded_by: 'Ben', result: 'carried', vote_tally: '5-1', sort_order: 1, secret_column: 'SECRET-COLUMN' },
  { id: 'm0', agenda_item_id: 'a3', description: 'Receive the audit', moved_by: 'Cara', seconded_by: 'Ben', result: 'carried', vote_tally: null, sort_order: 0 },
  { id: 'm2', agenda_item_id: 'a2', description: 'SECRET-MOTION settle for $40,000', moved_by: 'SECRET-MOVER', seconded_by: 'SECRET-SECONDER', result: 'SECRET-RESULT', vote_tally: 'SECRET-VOTES', sort_order: 2 },
];
const ACTIONS = [
  { id: 'c1', agenda_item_id: 'a3', description: 'Get roof quotes', responsible_party: 'Ben', due_date_text: null, due_date_parsed: '2026-10-23', sort_order: 3 },
  { id: 'c2', agenda_item_id: 'a2', description: 'SECRET-ACTION call the lawyer', responsible_party: 'SECRET-OWNER', due_date_text: 'SECRET-DUE', due_date_parsed: '2026-12-01', sort_order: 4 },
];
const ATTENDANCE = [{ display_name: 'Alice Adams', status: 'present', proxy_for_lot: null, roster_id: 'r1' }, { display_name: 'Guest', status: 'present', proxy_for_lot: 'Lot 14' }];
const plain = (v) => JSON.parse(JSON.stringify(v));   // the module runs in its own context; compare plain data
const build = (over = {}) => plain(OwnerCopy.build({ meeting: MEETING, agenda: AGENDA, attendance: ATTENDANCE, motions: MOTIONS, actions: ACTIONS, ...over }));

console.log('The in-camera item');
test('shows only its public title and summary, in its place in the agenda', () => {
  const c = build();
  assert.deepEqual(c.sections.map((s) => [s.number, s.title]), [[1, 'Call to order'], [2, 'Legal matter'], [3, 'Budget']]);
  assert.deepEqual(c.sections[1], { number: 2, inCamera: true, title: 'Legal matter', summary: 'Advice was received.' });
});
test('nothing else about it is anywhere in the copy: not its title, notes, motions, actions, names, votes or dates', () => {
  const everything = JSON.stringify(build());
  assert.ok(!everything.includes('SECRET'), `leaked: ${everything.match(/SECRET[-A-Z0-9]*/g)}`);
  for (const bit of ['Dispute', 'lawyer', 'Lot 12', '40,000', '2026-12-01']) assert.ok(!everything.includes(bit), bit);
});
test('with no public title it is called "In camera session", and with no summary there is none', () => {
  const c = build({ agenda: AGENDA.map((a) => (a.id === 'a2' ? { ...a, public_title: null, public_summary: '   ' } : a)) });
  assert.deepEqual(c.sections[1], { number: 2, inCamera: true, title: 'In camera session', summary: '' });
});
test('the public text is the secretary’s own words, passed through as plain text', () => {
  const c = build({ agenda: AGENDA.map((a) => (a.id === 'a2' ? { ...a, public_title: '<b>Legal</b>\n matter', public_summary: '<script>x</script>' } : a)) });
  assert.equal(c.sections[1].title, '<b>Legal</b> matter');
  assert.equal(c.sections[1].summary, '<script>x</script>');
});

console.log('Failing closed');
test('an item counts as public only when it is exactly "not in camera"', () => {
  for (const flag of [true, null, undefined, 'false', 0, '', 'no']) {
    const c = build({ agenda: AGENDA.map((a) => (a.id === 'a3' ? { ...a, is_in_camera: flag } : a)) });
    assert.equal(c.sections[2].inCamera, true, `flag ${JSON.stringify(flag)}`);
    assert.ok(!JSON.stringify(c).includes('Approve the budget'), `flag ${JSON.stringify(flag)} leaked its motion`);
  }
});
test('a row with the column missing entirely is treated as in camera', () => {
  const { is_in_camera, ...bare } = AGENDA[0];
  const c = build({ agenda: [bare] });
  assert.equal(c.sections[0].inCamera, true);
  assert.ok(!JSON.stringify(c).includes('Opened at 7:00'));
});
test('motions and action items with no agenda item, or an unknown one, are held back and counted', () => {
  const stray = [{ id: 'x1', agenda_item_id: null, description: 'SECRET-ORPHAN', sort_order: 9 }, { id: 'x2', agenda_item_id: 'deleted-item', description: 'SECRET-ORPHAN2', sort_order: 10 }];
  const c = build({ motions: [...MOTIONS, ...stray], actions: [...ACTIONS, { id: 'x3', agenda_item_id: null, description: 'SECRET-ORPHAN3', sort_order: 11 }] });
  assert.ok(!JSON.stringify(c).includes('SECRET'));
  assert.deepEqual(c.heldBack, { motions: 2, actions: 1 });
});

console.log('What the owner does see');
test('the other items come through in order, with their motions and action items', () => {
  const c = build();
  assert.equal(c.sections[0].notes, 'Opened at 7:00');
  assert.deepEqual(c.sections[2].motions.map((m) => m.description), ['Receive the audit', 'Approve the budget'], 'in the order they were made');
  assert.deepEqual(c.sections[2].motions[1], { description: 'Approve the budget', moved_by: 'Alice', seconded_by: 'Ben', result: 'carried', vote_tally: '5-1' });
  assert.deepEqual(c.sections[2].actions, [{ description: 'Get roof quotes', responsible_party: 'Ben', due_date_text: null, due_date_parsed: '2026-10-23' }]);
  assert.deepEqual(c.heldBack, { motions: 0, actions: 0 });
});
test('the header and attendance come through, including a proxy’s lot', () => {
  const c = build();
  assert.deepEqual([c.title, c.meeting_date, c.location], ['October Council Meeting', '2026-10-21', 'Amenity room']);
  assert.deepEqual(c.attendance, [{ display_name: 'Alice Adams', status: 'present', proxy_for_lot: null }, { display_name: 'Guest', status: 'present', proxy_for_lot: 'Lot 14' }]);
});
test('only listed fields are copied, so a column added later is not shared by accident', () => {
  const c = build();
  const all = JSON.stringify(c);
  for (const hidden of ['SECRET-COLUMN', 'SECRET-MARKDOWN', 'SECRET-SOURCE', 'user_id', 'roster_id', 'status":"in_progress']) assert.ok(!all.includes(hidden), hidden);
  assert.deepEqual(Object.keys(c.sections[2].motions[0]).sort(), ['description', 'moved_by', 'result', 'seconded_by', 'vote_tally']);
});
test('the order of the agenda follows sort_order, whatever order the rows arrive in', () => {
  const c = build({ agenda: [...AGENDA].reverse() });
  assert.deepEqual(c.sections.map((s) => s.title), ['Call to order', 'Legal matter', 'Budget']);
});
test('it does not change what it was given', () => {
  const before = JSON.stringify([MEETING, AGENDA, MOTIONS, ACTIONS, ATTENDANCE]);
  build();
  assert.equal(JSON.stringify([MEETING, AGENDA, MOTIONS, ACTIONS, ATTENDANCE]), before);
});
test('an empty meeting gives an empty copy, not an error', () => {
  const c = plain(OwnerCopy.build({ meeting: null, agenda: null, attendance: null, motions: null, actions: null }));
  assert.deepEqual(c.sections, []);
  assert.deepEqual(c.heldBack, { motions: 0, actions: 0 });
});

console.log(`\nALL ${passed} OWNER COPY CHECKS PASSED`);
