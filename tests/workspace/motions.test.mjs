// Browser tests for motions and action items in the minutes (step 5, second half).
// Run with: cd tests/workspace && npm install && npm run test:motions
import assert from 'node:assert/strict';
import { browser, open, test, finish, visible } from './harness.mjs';

const ROSTER = [
  { id: 'r1', name: 'Alice Adams', role: 'President' },
  { id: 'r2', name: 'Ben Brooks', role: 'Treasurer' },
  { id: 'r3', name: 'Cara Chen', role: 'Director' },
];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'in_progress' };
const AGENDA = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Budget' },
  { meeting_id: 'mt-oct', title: 'Adjournment' },
];

const btn = (page, name) => page.getByRole('button', { name, exact: true });
const section = (page, n) => page.locator('.doc-section').nth(n);
const motions = (page, n) => section(page, n).locator('.blk-motion');
const actions = (page, n) => section(page, n).locator('.blk-action');
const saved = (page) => page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'saved'
  && document.getElementById('minutes-saved').textContent.includes('Saved'), null, { timeout: 15000 });
const label = (block, caption) => block.locator('.blk-field', { hasText: caption }).locator('select, input');
const noteOf = (block) => block.locator('.blk-note').innerText();

async function openMinutes(scenario = {}, opts) {
  const t = await open(browser, { meetings: [OCT], agenda: AGENDA, roster: ROSTER, ...scenario }, opts);
  await t.page.waitForSelector('#meetings-list li');
  await t.page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await t.page.waitForSelector('#agenda-list li');
  await t.page.click('#meeting-run');
  await t.page.waitForSelector('#view-minutes:visible');
  await t.page.waitForSelector('.doc-section');
  return t;
}

// Add a motion to section n and fill it in.
async function addMotion(page, n, { text, mover, seconder, result, votes } = {}) {
  await section(page, n).getByRole('button', { name: 'Add a motion', exact: true }).click();
  const block = motions(page, n).last();
  if (text) await page.keyboard.type(text);
  if (mover) await label(block, 'Moved by').selectOption({ label: mover });
  if (seconder) await label(block, 'Seconded by').selectOption({ label: seconder });
  if (result) await label(block, 'Result').selectOption(result);
  if (votes) await label(block, 'Votes').fill(votes);
  return block;
}
async function addAction(page, n, { text, who, due } = {}) {
  await section(page, n).getByRole('button', { name: 'Add an action item', exact: true }).click();
  const block = actions(page, n).last();
  if (text) await page.keyboard.type(text);
  if (who) await label(block, 'Who').selectOption({ label: who });
  if (due) await label(block, 'Due').fill(due);
  return block;
}

const DONE_MOTION = { id: 'mo1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Approve the budget', moved_by: 'Alice Adams', seconded_by: 'Ben Brooks',
                      mover_roster_id: 'r1', seconder_roster_id: 'r2', result: 'carried', vote_tally: '5-1', confirmed: true, sort_order: 0 };

console.log('Adding a motion');
await test('Add a motion puts an unconfirmed, empty motion in that agenda item, ready to type, and nothing is saved until something is typed', async () => {
  const { page, ctx, seen } = await openMinutes();
  await section(page, 1).getByRole('button', { name: 'Add a motion', exact: true }).click();
  const block = motions(page, 1).last();
  assert.equal(await motions(page, 0).count(), 0, 'only the chosen item');
  assert.equal(await block.evaluate((e) => e.classList.contains('is-unconfirmed')), true);
  assert.equal(await noteOf(block), 'Still needed: what was moved, who moved it, who seconded it, the result.');
  assert.equal(await block.locator('.blk-confirm').isDisabled(), true);
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.filter((w) => w.table === 'motions').length, 0, 'a blank motion is not worth a row');
  await page.keyboard.type('Approve the budget');
  await saved(page);
  assert.equal(seen.writes.filter((w) => w.table === 'motions' && w.method === 'POST').length, 1);
  await ctx.close();
});

await test('a motion can be confirmed only when wording, mover, seconder and result are all set, and says what is missing', async () => {
  const { page, ctx } = await openMinutes();
  const block = await addMotion(page, 1, { text: 'Approve the budget' });
  const confirm = block.locator('.blk-confirm');
  assert.equal(await noteOf(block), 'Still needed: who moved it, who seconded it, the result.');
  await label(block, 'Moved by').selectOption({ label: 'Alice Adams' });
  assert.equal(await noteOf(block), 'Still needed: who seconded it, the result.');
  await label(block, 'Seconded by').selectOption({ label: 'Alice Adams' });
  assert.equal(await noteOf(block), 'Still needed: the result.');
  await label(block, 'Result').selectOption('carried');
  assert.equal(await noteOf(block), 'The mover and seconder should be different people.');
  assert.equal(await confirm.isDisabled(), true, 'the same person cannot do both');
  await label(block, 'Seconded by').selectOption({ label: 'Ben Brooks' });
  assert.equal(await noteOf(block), 'Check it, then confirm.');
  assert.equal(await confirm.isEnabled(), true);
  assert.equal(await label(block, 'Votes').inputValue(), '', 'votes are optional');
  await ctx.close();
});

await test('a finished motion saves one row with every field in the right place', async () => {
  const { page, ctx, s, seen } = await openMinutes();
  const block = await addMotion(page, 1, { text: 'Approve the budget', mover: 'Alice Adams', seconder: 'Ben Brooks', result: 'carried', votes: '5-1' });
  await block.locator('.blk-confirm').click();
  assert.equal(await block.evaluate((e) => e.classList.contains('is-confirmed')), true);
  await saved(page);
  assert.equal(s.motions.length, 1);
  const row = s.motions[0];
  assert.deepEqual(
    { description: row.description, moved_by: row.moved_by, seconded_by: row.seconded_by, mover_roster_id: row.mover_roster_id,
      seconder_roster_id: row.seconder_roster_id, result: row.result, vote_tally: row.vote_tally, confirmed: row.confirmed,
      agenda_item_id: row.agenda_item_id, meeting_id: row.meeting_id, org_id: row.org_id, sort_order: row.sort_order },
    { description: 'Approve the budget', moved_by: 'Alice Adams', seconded_by: 'Ben Brooks', mover_roster_id: 'r1',
      seconder_roster_id: 'r2', result: 'carried', vote_tally: '5-1', confirmed: true,
      agenda_item_id: 'ag2', meeting_id: 'mt-oct', org_id: 'org-1', sort_order: 0 },
  );
  assert.equal(seen.writes.filter((w) => w.table === 'motions' && w.method === 'POST').length, 1, 'saved as it was filled in, not once per field');
  await ctx.close();
});

await test('what was saved comes back exactly the same after a reload, including that it is confirmed', async () => {
  const { page, ctx } = await openMinutes();
  const block = await addMotion(page, 1, { text: 'Approve the budget', mover: 'Alice Adams', seconder: 'Ben Brooks', result: 'carried', votes: '5-1' });
  await block.locator('.blk-confirm').click();
  await saved(page);
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.blk-motion');
  const again = motions(page, 1).first();
  assert.equal(await again.locator('.blk-text').innerText(), 'Approve the budget');
  assert.equal(await label(again, 'Moved by').inputValue(), 'r1');
  assert.equal(await label(again, 'Seconded by').inputValue(), 'r2');
  assert.equal(await label(again, 'Result').inputValue(), 'carried');
  assert.equal(await label(again, 'Votes').inputValue(), '5-1');
  assert.equal(await again.evaluate((e) => e.classList.contains('is-confirmed')), true);
  assert.equal(await page.locator('#minutes-draft').isVisible(), false);
  await ctx.close();
});

await test('editing a confirmed motion so it is no longer complete takes the confirmation away', async () => {
  const { page, ctx, s } = await openMinutes({ motions: [DONE_MOTION] });
  const block = motions(page, 1).first();
  assert.equal(await block.evaluate((e) => e.classList.contains('is-confirmed')), true);
  await label(block, 'Result').selectOption('');
  assert.equal(await block.evaluate((e) => e.classList.contains('is-unconfirmed')), true);
  await saved(page);
  assert.equal(s.motions[0].confirmed, false);
  assert.equal(s.motions[0].result, null);
  await label(block, 'Result').selectOption('tabled');
  await block.locator('.blk-confirm').click();
  await saved(page);
  assert.equal(s.motions[0].confirmed, true);
  assert.equal(s.motions[0].result, 'tabled');
  // clearing the wording does the same
  await block.locator('.blk-text').click();
  await page.keyboard.press('End');
  for (let i = 0; i < 30; i++) await page.keyboard.press('Backspace');
  assert.equal((await block.locator('.blk-text').innerText()).trim(), '');
  assert.equal(await block.evaluate((e) => e.classList.contains('is-unconfirmed')), true);
  await ctx.close();
});

await test('Enter inside a motion does not split it, while Enter in the notes still adds a line', async () => {
  const { page, ctx } = await openMinutes();
  const block = await addMotion(page, 1, { text: 'Approve' });
  await page.keyboard.press('Enter');
  await page.keyboard.type(' the budget');
  assert.equal(await motions(page, 1).count(), 1);
  assert.equal(await block.locator('.blk-text').innerText(), 'Approve the budget');
  await section(page, 1).locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('More notes');
  assert.equal(await section(page, 1).locator('.doc-section-body > p').count(), 2);
  await ctx.close();
});

console.log('Removing, and not losing things by accident');
await test('removing a motion takes two clicks and deletes its row; Keep backs out', async () => {
  const { page, ctx, s, seen } = await openMinutes({ motions: [DONE_MOTION] });
  const block = motions(page, 1).first();
  await block.getByRole('button', { name: 'Remove this motion', exact: true }).click();
  assert.match(await block.locator('.blk-remove').innerText(), /Remove this motion\?/);
  await block.getByRole('button', { name: 'Keep this motion', exact: true }).click();
  assert.equal(await motions(page, 1).count(), 1);
  assert.equal(seen.writes.length, 0);
  await block.getByRole('button', { name: 'Remove this motion', exact: true }).click();
  await block.getByRole('button', { name: 'Yes, remove this motion', exact: true }).click();
  await saved(page);
  assert.equal(await motions(page, 1).count(), 0);
  assert.equal(s.motions.length, 0);
  assert.deepEqual(seen.writes.filter((w) => w.table === 'motions').map((w) => w.method), ['DELETE']);
  await ctx.close();
});

await test('selecting across blocks and pressing Delete cannot remove a motion or an action item', async () => {
  const { page, ctx, s, seen } = await openMinutes({
    motions: [DONE_MOTION],
    actions: [{ id: 'ac1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Get quotes', responsible_party: 'Ben Brooks', owner_roster_id: 'r2', sort_order: 1 }],
  });
  await section(page, 1).locator('.doc-section-body > p').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  assert.equal(await motions(page, 1).count(), 1);
  assert.equal(await actions(page, 1).count(), 1);
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.filter((w) => w.method === 'DELETE').length, 0);
  assert.equal(s.motions.length, 1);
  await ctx.close();
});

await test('a plain member can add and confirm a motion, and is not offered Remove on a saved one', async () => {
  const { page, ctx, s } = await openMinutes({ role: 'member', motions: [DONE_MOTION] });
  assert.equal(await motions(page, 1).first().getByRole('button', { name: 'Remove this motion', exact: true }).count(), 0);
  const block = await addMotion(page, 2, { text: 'Adjourn', mover: 'Cara Chen', seconder: 'Ben Brooks', result: 'carried' });
  assert.equal(await block.getByRole('button', { name: 'Remove this motion', exact: true }).count(), 1, 'an unsaved one can still be taken back');
  await block.locator('.blk-confirm').click();
  await saved(page);
  assert.equal(s.motions.length, 2);
  assert.equal(await block.getByRole('button', { name: 'Remove this motion', exact: true }).count(), 0, 'saved, so now it is not offered');
  await ctx.close();
});

console.log('Action items');
await test('an action item needs wording and an owner, and the due date is optional', async () => {
  const { page, ctx, s } = await openMinutes();
  const block = await addAction(page, 1, { text: 'Get three roof quotes' });
  assert.equal(await noteOf(block), 'Still needed: who will do it.');
  assert.equal(await block.locator('.blk-confirm').isDisabled(), true);
  await label(block, 'Who').selectOption({ label: 'Ben Brooks' });
  assert.equal(await block.locator('.blk-confirm').isEnabled(), true);
  await label(block, 'Due').fill('2026-11-04');
  await block.locator('.blk-confirm').click();
  await saved(page);
  assert.equal(s.actions.length, 1);
  const row = s.actions[0];
  assert.deepEqual(
    { description: row.description, responsible_party: row.responsible_party, owner_roster_id: row.owner_roster_id,
      due_date_text: row.due_date_text, due_date_parsed: row.due_date_parsed, confirmed: row.confirmed, agenda_item_id: row.agenda_item_id },
    { description: 'Get three roof quotes', responsible_party: 'Ben Brooks', owner_roster_id: 'r2',
      due_date_text: 'November 4, 2026', due_date_parsed: '2026-11-04', confirmed: true, agenda_item_id: 'ag2' },
  );
  await ctx.close();
});

await test('an action item with no due date is saved without one', async () => {
  const { page, ctx, s } = await openMinutes();
  const block = await addAction(page, 0, { text: 'Send the notice', who: 'Cara Chen' });
  await block.locator('.blk-confirm').click();
  await saved(page);
  assert.equal(s.actions[0].due_date_parsed, null);
  assert.equal(s.actions[0].due_date_text, null);
  await ctx.close();
});

await test('an older action item with only a due-date text keeps it, shows it, and is not rewritten on open', async () => {
  const { page, ctx, seen } = await openMinutes({
    actions: [{ id: 'ac1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Follow up', responsible_party: 'Someone Else', due_date_text: 'next meeting', sort_order: 0 }],
  });
  const block = actions(page, 1).first();
  assert.match(await block.locator('.blk-hint').innerText(), /Due: next meeting/);
  assert.match(await block.locator('select').first().locator('option:checked').innerText(), /Someone Else \(not on the roster\)/);
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.length, 0);
  await ctx.close();
});

console.log('Opening meetings that already have motions');
await test('existing motions and action items appear under the right item, in the order they were added, and opening writes nothing', async () => {
  const { page, ctx, seen } = await openMinutes({
    motions: [{ ...DONE_MOTION, id: 'mo1', description: 'First motion', sort_order: 0 },
              { ...DONE_MOTION, id: 'mo2', description: 'Third thing', agenda_item_id: 'ag2', sort_order: 2 },
              { ...DONE_MOTION, id: 'mo3', description: 'Adjourn', agenda_item_id: 'ag3', sort_order: 3 }],
    actions: [{ id: 'ac1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Second thing', responsible_party: 'Ben Brooks', owner_roster_id: 'r2', sort_order: 1 }],
  });
  const order = await section(page, 1).locator('.blk .blk-text').allInnerTexts();
  assert.deepEqual(order, ['First motion', 'Second thing', 'Third thing']);
  assert.deepEqual(await section(page, 2).locator('.blk .blk-text').allInnerTexts(), ['Adjourn']);
  assert.equal(await section(page, 0).locator('.blk').count(), 0);
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.length, 0, 'nothing was changed just by looking');
  await ctx.close();
});

await test('a motion with an older description and names that are not on the roster is shown faithfully and left alone', async () => {
  const { page, ctx, seen } = await openMinutes({
    motions: [{ id: 'mo1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Approve\nthe   budget', moved_by: 'Dana', seconded_by: 'Lee',
                result: 'carried', confirmed: true, sort_order: 0 }],
  });
  const block = motions(page, 1).first();
  assert.equal(await block.locator('.blk-text').innerText(), 'Approve the budget');
  assert.match(await label(block, 'Moved by').locator('option:checked').innerText(), /Dana \(not on the roster\)/);
  assert.match(await label(block, 'Seconded by').locator('option:checked').innerText(), /Lee \(not on the roster\)/);
  assert.equal(await block.evaluate((e) => e.classList.contains('is-confirmed')), true);
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.length, 0);
  await ctx.close();
});

await test('a mover who has since left the roster is shown as a former member', async () => {
  const { page, ctx } = await openMinutes({ motions: [{ ...DONE_MOTION, mover_roster_id: 'gone', moved_by: 'Old Timer' }] });
  assert.match(await label(motions(page, 1).first(), 'Moved by').locator('option:checked').innerText(), /Old Timer \(former member\)/);
  await ctx.close();
});

await test('motions whose agenda item was removed are still shown, under Other items, with no way to add more there', async () => {
  const { page, ctx, seen } = await openMinutes({ motions: [{ ...DONE_MOTION, agenda_item_id: null, description: 'Left over' }] });
  const last = section(page, 3);
  assert.equal(await last.locator('.doc-section-title').innerText(), 'Other items');
  assert.equal(await last.locator('.blk-text').innerText(), 'Left over');
  assert.equal(await last.getByRole('button', { name: 'Add a motion', exact: true }).isVisible(), false);
  assert.equal(await last.locator('.doc-section-body > p').first().isVisible(), false, 'no notes box for it');
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.length, 0);
  await ctx.close();
});

console.log('Order of new rows, undo and warnings');
await test('motions and action items added in turn keep that order after a reload', async () => {
  const { page, ctx } = await openMinutes();
  await addAction(page, 1, { text: 'Action first' });
  await addMotion(page, 1, { text: 'Motion second' });
  await addAction(page, 1, { text: 'Action third' });
  await saved(page);
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.blk');
  assert.deepEqual(await section(page, 1).locator('.blk .blk-text').allInnerTexts(), ['Action first', 'Motion second', 'Action third']);
  await ctx.close();
});

await test('Undo takes back typing in a motion, but not the motion itself or its dropdowns', async () => {
  const { page, ctx } = await openMinutes();
  const block = await addMotion(page, 1, { text: 'Oops', mover: 'Alice Adams' });
  await page.locator('.blk-motion .blk-text').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!!');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(await motions(page, 1).count(), 1);
  assert.equal(await label(block, 'Moved by').inputValue(), 'r1');
  await ctx.close();
});

await test('a warning appears when the mover or seconder is recorded as absent, and goes when that changes', async () => {
  const { page, ctx } = await openMinutes({ motions: [DONE_MOTION] });
  const block = motions(page, 1).first();
  assert.equal(await block.locator('.blk-warn').isVisible(), false);
  await page.getByLabel('Attendance for Alice Adams').selectOption('absent');
  await page.waitForFunction(() => /absent/.test(document.querySelector('.blk-warn')?.textContent ?? ''));
  assert.equal(await block.locator('.blk-warn').innerText(), 'Alice Adams is recorded as absent.');
  await page.getByLabel('Attendance for Ben Brooks').selectOption('regrets');
  await page.waitForFunction(() => /regrets/.test(document.querySelector('.blk-warn')?.textContent ?? ''));
  assert.match(await block.locator('.blk-warn').innerText(), /Ben Brooks is recorded as sending regrets\./);
  await page.getByLabel('Attendance for Alice Adams').selectOption('present');
  await page.getByLabel('Attendance for Ben Brooks').selectOption('present');
  await page.waitForFunction(() => document.querySelector('.blk-warn')?.classList.contains('hidden'));
  await ctx.close();
});

console.log('When saving goes wrong');
await test('unsaved motions are offered back after a reload, and putting them back never deletes what others saved', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { motions: 'network' } });
  await addMotion(page, 1, { text: 'Typed while offline', mover: 'Alice Adams', seconder: 'Ben Brooks', result: 'carried' });
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'error');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-workspace-draft:')));
  s.fail.motions = null;
  // meanwhile someone else saved a motion in the same item
  s.motions.push({ ...DONE_MOTION, id: 'mo-other', description: 'Saved elsewhere', sort_order: 5, org_id: 'org-1', created_at: '2026-02-01T00:03:09Z' });
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('#minutes-draft:visible');
  await btn(page, 'Put them back').click();
  await saved(page);
  assert.deepEqual((await section(page, 1).locator('.blk .blk-text').allInnerTexts()).sort(), ['Saved elsewhere', 'Typed while offline']);
  assert.equal(s.motions.length, 2, 'both are in the database; nothing was deleted');
  assert.ok(s.motions.some((m) => m.description === 'Typed while offline' && m.confirmed === false));
  await ctx.close();
});

await test('a permission error on a motion is explained, not retried over and over, and the motion stays on screen', async () => {
  const { page, ctx, seen } = await openMinutes({ fail: { motions: 'permission' } });
  await addMotion(page, 1, { text: 'Cannot be saved' });
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'blocked');
  const count = seen.writes.filter((w) => w.table === 'motions').length;
  await page.waitForTimeout(2500);
  assert.equal(seen.writes.filter((w) => w.table === 'motions').length, count);
  assert.equal(await motions(page, 1).count(), 1);
  await ctx.close();
});

await test('names and wording with HTML in them are shown as text and run nothing', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const { page, ctx } = await openMinutes({
    roster: [{ id: 'r1', name: `${evil}Mallory`, role: 'Boss' }, ROSTER[1]],
    motions: [{ ...DONE_MOTION, description: `${evil}Motion`, moved_by: `${evil}Mallory` }],
    actions: [{ id: 'ac1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: `${evil}Action`, responsible_party: `${evil}Someone`, sort_order: 1 }],
  });
  assert.match(await motions(page, 1).first().locator('.blk-text').innerText(), /<img src=x/);
  assert.match(await actions(page, 1).first().locator('.blk-text').innerText(), /<img src=x/);
  assert.equal(await page.locator('#editor img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});

console.log('On a phone');
await test('motions and action items fit a phone and can be used there', async () => {
  const { page, ctx, s } = await openMinutes({ motions: [DONE_MOTION] }, { viewport: { width: 390, height: 780 } });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(await overflow() <= 1, `fits with a motion (${await overflow()}px over)`);
  const block = await addMotion(page, 2, { text: 'Adjourn the meeting at the end of the evening', mover: 'Cara Chen', seconder: 'Ben Brooks', result: 'carried' });
  await block.locator('.blk-confirm').click();
  await addAction(page, 2, { text: 'Lock up', who: 'Alice Adams', due: '2026-10-22' });
  await saved(page);
  assert.equal(s.motions.length, 2);
  assert.equal(s.actions.length, 1);
  assert.ok(await overflow() <= 1, `still fits (${await overflow()}px over)`);
  await ctx.close();
});

await finish('MOTIONS');
