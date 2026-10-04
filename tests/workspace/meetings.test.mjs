// Browser tests for meetings and agendas (step 4).
// Run with: cd tests/workspace && npm install && npm run test:meetings
import assert from 'node:assert/strict';
import { browser, open, test, finish, visible } from './harness.mjs';

const STRATA_AGENDA = [
  'Call to order', 'Approval of the agenda', 'Approval of the previous minutes',
  'Business arising from the previous minutes', 'Financial report', "Manager's report",
  'Correspondence', 'New business', 'Next meeting', 'Adjournment',
];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'planned' };
const THREE_ITEMS = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Budget' },
  { meeting_id: 'mt-oct', title: 'Adjournment' },
];

const btn = (page, name) => page.getByRole('button', { name, exact: true });
const items = (page) => page.locator('#agenda-list .agenda-title').allInnerTexts();
const listed = (page) => page.locator('#meetings-list .meeting-link').allInnerTexts();

async function start(scenario = {}, opts) {
  const t = await open(browser, scenario, opts);
  await t.page.waitForSelector('#app:visible');
  await t.page.waitForFunction(() => document.getElementById('meetings-count').textContent !== '');
  return t;
}
async function openOct(scenario = {}, opts) {
  const t = await start({ meetings: [OCT], agenda: THREE_ITEMS, ...scenario }, opts);
  await t.page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await t.page.waitForSelector('#agenda-list li');
  return t;
}
async function createMeeting(page, { date = '2026-10-21', time = '19:00', place = 'Amenity room', title } = {}) {
  await page.click('#meeting-new');
  if (title !== undefined) await page.fill('#mf-title', title);
  await page.fill('#mf-date', date);
  if (time) await page.fill('#mf-time', time);
  if (place) await page.fill('#mf-place', place);
}

console.log('The list');
await test('the meetings list is the first screen, and says what to do when empty', async () => {
  const { page, ctx } = await start();
  assert.equal(await page.locator('#meetings-count').innerText(), '0 meetings');
  assert.match(await page.locator('#meetings-empty').innerText(), /No meetings yet\. Create one/);
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Meetings');
  assert.equal(await page.locator('#view-meetings a[href="board.html"]').count(), 1, 'points to the original generator minutes');
  await ctx.close();
});

await test('only meetings made in the workspace are listed, newest date first', async () => {
  const { page, ctx } = await start({ meetings: [
    { id: 'old', title: 'Old generator minutes', status: 'approved', meeting_date: '2026-01-10' },
    { ...OCT },
    { id: 'mt-sep', title: 'September Meeting', status: 'planned', meeting_date: '2026-09-16' },
    { id: 'mt-live', title: 'Has an agenda', status: 'draft', meeting_date: '2026-08-01' },
  ], agenda: [{ meeting_id: 'mt-live', title: 'Call to order' }] });
  assert.deepEqual(await listed(page), ['October Council Meeting', 'September Meeting', 'Has an agenda']);
  assert.equal(await page.locator('#meetings-count').innerText(), '3 meetings');
  assert.match(await page.locator('#meetings-list li').first().innerText(), /Planned/);
  assert.match(await page.locator('#meetings-list li').first().innerText(), /October 21, 2026 · 7:00 PM · Amenity room/);
  await ctx.close();
});

console.log('Creating a meeting');
await test('a new meeting gets the standard agenda and the right details saved', async () => {
  const { page, ctx, seen } = await start();
  await page.click('#meeting-new');
  assert.equal(await page.inputValue('#mf-title'), 'Council Meeting');
  assert.match(await page.inputValue('#mf-date'), /^\d{4}-\d{2}-\d{2}$/, 'the date starts as today');
  await page.fill('#mf-date', '2026-10-21');
  await page.fill('#mf-time', '19:00');
  await page.fill('#mf-place', '  Amenity   room ');
  await page.click('#meeting-create');
  await page.waitForSelector('#view-meeting:visible');
  await page.waitForSelector('#agenda-list li');
  assert.equal(await page.locator('#meeting-heading').innerText(), 'Council Meeting');
  assert.equal(await page.locator('#meeting-summary').innerText(), 'Wednesday, October 21, 2026 · 7:00 PM · Amenity room');
  assert.equal(await page.locator('#meeting-badge').innerText(), 'Planned');
  assert.deepEqual(await items(page), STRATA_AGENDA);
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Meeting');

  const meeting = seen.writes.find((w) => w.table === 'meetings' && w.method === 'POST').body;
  assert.equal(meeting.org_id, 'org-1');
  assert.equal(meeting.user_id, 'user-1');
  assert.equal(meeting.template, 'STRATA');
  assert.equal(meeting.status, 'planned');
  assert.equal(meeting.meeting_date, '2026-10-21');
  assert.equal(meeting.location, 'Amenity room');
  assert.equal(meeting.start_time, '2026-10-21T19:00:00.000Z');
  const rows = seen.writes.find((w) => w.table === 'agenda_items' && w.method === 'POST').body;
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => r.sort_order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(rows.every((r) => r.source === 'template' && r.org_id === 'org-1' && r.meeting_id.startsWith('meetings-')));
  await ctx.close();
});

await test('each kind of organization gets its own standard agenda, and an unknown kind still gets one', async () => {
  const cases = [
    ['HOA_GENERIC', 'Board Meeting', 10], ['NONPROFIT_BOARD', 'Board Meeting', 10],
    ['TEAM_INFORMAL', 'Team Meeting', 6], ['SOMETHING_NEW', 'Council Meeting', 10],
  ];
  for (const [type, title, count] of cases) {
    const { page, ctx } = await start({ org: { id: 'org-1', name: 'Org', org_type: type } });
    await createMeeting(page, { time: '', place: '' });
    assert.equal(await page.inputValue('#mf-title'), title, `${type} title`);
    await page.click('#meeting-create');
    await page.waitForSelector('#agenda-list li');
    assert.equal(await page.locator('#agenda-list li').count(), count, `${type} agenda length`);
    await ctx.close();
  }
});

await test('a meeting needs a date, and a blank title falls back to the standard one', async () => {
  const { page, ctx, seen } = await start();
  await page.click('#meeting-new');
  await page.fill('#mf-date', '');
  await page.click('#meeting-create');
  await page.waitForSelector('#meeting-form-error:visible');
  assert.equal(await page.locator('#meeting-form-error').innerText(), 'Pick a date for the meeting.');
  assert.equal(seen.writes.length, 0);
  await page.fill('#mf-date', '2026-11-04');
  await page.fill('#mf-title', '   ');
  await page.click('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  assert.equal(await page.locator('#meeting-heading').innerText(), 'Council Meeting');
  await ctx.close();
});

await test('the time and place can be remembered for next time, and are offered back', async () => {
  const { page, ctx, seen, s } = await start();
  await createMeeting(page);
  assert.equal(await page.isChecked('#mf-remember'), true, 'offered by default when nothing is remembered yet');
  await page.click('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  const saved = seen.writes.find((w) => w.table === 'organizations');
  assert.deepEqual(saved.body, { default_meeting_time: '19:00', default_location: 'Amenity room' });
  await page.click('#meeting-back');
  await page.waitForSelector('#meetings-list li');
  await page.click('#meeting-new');
  assert.equal(await page.inputValue('#mf-time'), '19:00');
  assert.equal(await page.inputValue('#mf-place'), 'Amenity room');
  assert.equal(await page.isChecked('#mf-remember'), false, 'not pre-ticked once something is remembered');
  await ctx.close();
});

await test('remembered time and place are filled in from the start, and nothing is saved unless asked', async () => {
  const { page, ctx, seen } = await start({ orgDefaults: { default_meeting_time: '19:30:00', default_location: 'Clubhouse' } });
  await page.click('#meeting-new');
  assert.equal(await page.inputValue('#mf-time'), '19:30');
  assert.equal(await page.inputValue('#mf-place'), 'Clubhouse');
  await page.fill('#mf-date', '2026-10-21');
  await page.click('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  assert.equal(seen.writes.filter((w) => w.table === 'organizations').length, 0);
  await ctx.close();
});

await test('if the standard agenda cannot be added, the meeting still opens and can be fixed', async () => {
  const { page, ctx, s } = await start({ fail: { agenda_items: 'server' } });
  await createMeeting(page, { time: '', place: '' });
  await page.click('#meeting-create');
  await page.waitForSelector('#view-meeting:visible');
  await page.waitForFunction(() => /could not be added/.test(document.getElementById('meeting-status').textContent));
  assert.match(await page.locator('#meeting-status').innerText(), /meeting was created, but the standard agenda could not be added/);
  assert.equal(await visible(page, '#agenda-empty'), true);
  s.fail.agenda_items = null;
  await btn(page, 'Use the standard agenda').click();
  await page.waitForFunction(() => document.querySelectorAll('#agenda-list li').length === 10);
  assert.equal(await visible(page, '#agenda-empty'), false);
  await ctx.close();
});

await test('if the meeting cannot be saved, the form stays open with a plain message, and trying again works', async () => {
  const { page, ctx, s } = await start({ fail: { meetings: 'network' } });
  await createMeeting(page, { place: 'Amenity room' });
  await page.click('#meeting-create');
  await page.waitForSelector('#meeting-form-error:visible');
  const text = await page.locator('#meeting-form-error').innerText();
  assert.match(text, /could not save the meeting\. Check that you are online/);
  assert.doesNotMatch(text, /TypeError|Failed to fetch/);
  assert.equal(await page.inputValue('#mf-place'), 'Amenity room', 'what was typed is kept');
  assert.equal(await visible(page, '#view-meeting'), false);
  s.fail.meetings = null;
  await page.click('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  await ctx.close();
});

await test('double-clicking Create makes one meeting', async () => {
  const { page, ctx, seen } = await start();
  await createMeeting(page, { time: '', place: '' });
  await page.dblclick('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  assert.equal(seen.writes.filter((w) => w.table === 'meetings' && w.method === 'POST').length, 1);
  await ctx.close();
});

await test('Cancel closes the new meeting form without saving', async () => {
  const { page, ctx, seen } = await start();
  await page.click('#meeting-new');
  await page.click('#meeting-form-cancel');
  assert.equal(await visible(page, '#meeting-form'), false);
  assert.equal(seen.writes.length, 0);
  await ctx.close();
});

console.log('Opening a meeting, and it surviving a reload');
await test('a meeting and its agenda are still there after the page is reloaded', async () => {
  const { page, ctx } = await start();
  await createMeeting(page, { title: 'Reload test meeting' });
  await page.click('#meeting-create');
  await page.waitForSelector('#agenda-list li');
  await btn(page, 'Rename Financial report').click();
  await page.fill('#agenda-list input', 'Financial report and budget');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Financial report and budget/.test(document.getElementById('agenda-list').textContent));
  await btn(page, 'Move Adjournment up').click();
  await page.waitForFunction(() => document.querySelectorAll('#agenda-list .agenda-title')[8].textContent === 'Adjournment');
  const before = await items(page);

  await page.reload();
  await page.waitForSelector('#app:visible');
  await page.waitForSelector('#meetings-list li');
  assert.deepEqual(await listed(page), ['Reload test meeting']);
  await page.getByRole('button', { name: 'Open Reload test meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  assert.deepEqual(await items(page), before);
  assert.equal(await page.locator('#meeting-heading').innerText(), 'Reload test meeting');
  assert.match(await page.locator('#meeting-summary').innerText(), /October 21, 2026 · 7:00 PM · Amenity room/);
  await ctx.close();
});

await test('Back returns to the list, which shows any change', async () => {
  const { page, ctx } = await openOct();
  await page.click('#meeting-edit');
  await page.fill('#me-title', 'Renamed meeting');
  await page.click('#meeting-edit-save');
  await page.waitForFunction(() => document.getElementById('meeting-heading').textContent === 'Renamed meeting');
  await page.click('#meeting-back');
  await page.waitForSelector('#view-meetings:visible');
  await page.waitForFunction(() => /Renamed meeting/.test(document.getElementById('meetings-list').textContent));
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Meetings');
  await ctx.close();
});

await test('a meeting that has been deleted elsewhere says so instead of showing a broken page', async () => {
  const { page, ctx, s } = await start({ meetings: [OCT], agenda: THREE_ITEMS });
  s.meetings = [];
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#meeting-status:visible');
  await page.waitForFunction(() => /no longer there/.test(document.getElementById('meeting-status').textContent));
  assert.equal(await visible(page, '.agenda'), false);
  assert.equal(await visible(page, '#meeting-edit'), false);
  assert.equal(await visible(page, '#meeting-back'), true);
  await ctx.close();
});

console.log('Changing the agenda');
await test('adding an item puts it at the end, once, and an empty item is refused', async () => {
  const { page, ctx, seen } = await openOct();
  await page.click('#agenda-add-btn');
  assert.equal(await page.locator('#agenda-error').innerText(), 'Type the agenda item first.');
  assert.equal(seen.writes.length, 0);
  await page.fill('#agenda-add-input', '  Roof   repair quotes ');
  await page.dblclick('#agenda-add-btn');
  await page.waitForFunction(() => document.querySelectorAll('#agenda-list li').length === 4);
  assert.deepEqual(await items(page), ['Call to order', 'Budget', 'Adjournment', 'Roof repair quotes']);
  const writes = seen.writes.filter((w) => w.table === 'agenda_items' && w.method === 'POST');
  assert.equal(writes.length, 1, 'double click adds once');
  assert.equal(writes[0].body.source, 'added');
  assert.equal(writes[0].body.sort_order, 3);
  assert.equal(await page.inputValue('#agenda-add-input'), '');
  assert.equal(await visible(page, '#agenda-error'), false);
  await ctx.close();
});

await test('renaming keeps the order, and Escape or an empty name changes nothing', async () => {
  const { page, ctx, seen } = await openOct();
  await btn(page, 'Rename Budget').click();
  assert.equal(await page.inputValue('#agenda-list input'), 'Budget');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#agenda-list input').count(), 0);
  await btn(page, 'Rename Budget').click();
  await page.fill('#agenda-list input', '   ');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#agenda-error').innerText(), 'Type a name for the item.');
  assert.equal(seen.writes.length, 0);
  await page.fill('#agenda-list input', 'Budget for next year');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#agenda-list input').length === 0);
  assert.deepEqual(await items(page), ['Call to order', 'Budget for next year', 'Adjournment']);
  const [write] = seen.writes;
  assert.equal(write.method, 'PATCH');
  assert.deepEqual(write.body, { title: 'Budget for next year' });
  await ctx.close();
});

await test('Up and Down reorder, the ends cannot move off, and shared order numbers are tidied', async () => {
  const same = THREE_ITEMS.map((a) => ({ ...a, sort_order: 0 }));
  const { page, ctx } = await openOct({ agenda: same });
  assert.equal(await btn(page, 'Move Call to order up').isDisabled(), true);
  assert.equal(await btn(page, 'Move Adjournment down').isDisabled(), true);
  const before = await items(page);
  await btn(page, `Move ${before[0]} down`).click();
  await page.waitForFunction((first) => document.querySelector('#agenda-list .agenda-title').textContent !== first, before[0]);
  assert.deepEqual(await items(page), [before[1], before[0], before[2]]);
  await ctx.close();
});

await test('removing an item takes two clicks, and Keep backs out', async () => {
  const { page, ctx, seen } = await openOct();
  await btn(page, 'Remove Budget').click();
  assert.match(await page.locator('#agenda-list').innerText(), /Remove this item\?/);
  await btn(page, 'Keep Budget').click();
  assert.equal(seen.writes.length, 0);
  await btn(page, 'Remove Budget').click();
  await btn(page, 'Yes, remove Budget').click();
  await page.waitForFunction(() => document.querySelectorAll('#agenda-list li').length === 2);
  assert.deepEqual(await items(page), ['Call to order', 'Adjournment']);
  assert.deepEqual(seen.writes.map((w) => w.method), ['DELETE']);
  await ctx.close();
});

await test('a plain member can add, rename and reorder but is not offered Remove or Delete', async () => {
  const { page, ctx } = await openOct({ role: 'member' });
  assert.equal(await page.getByRole('button', { name: /^Remove / }).count(), 0);
  assert.equal(await btn(page, 'Delete this meeting').count(), 0);
  assert.equal(await btn(page, 'Rename Budget').count(), 1);
  assert.equal(await btn(page, 'Move Budget up').count(), 1);
  assert.equal(await visible(page, '#agenda-add-form'), true);
  await ctx.close();
});

console.log('Meeting details, and deleting');
await test('editing the details shows what is saved, and saves only what changed on screen', async () => {
  const { page, ctx, seen } = await openOct();
  await page.click('#meeting-edit');
  assert.equal(await page.inputValue('#me-title'), 'October Council Meeting');
  assert.equal(await page.inputValue('#me-date'), '2026-10-21');
  assert.equal(await page.inputValue('#me-time'), '19:00');
  assert.equal(await page.inputValue('#me-place'), 'Amenity room');
  await page.fill('#me-date', '');
  await page.click('#meeting-edit-save');
  assert.equal(await page.locator('#meeting-edit-error').innerText(), 'Pick a date for the meeting.');
  assert.equal(seen.writes.length, 0);
  await page.fill('#me-date', '2026-10-28');
  await page.fill('#me-time', '18:30');
  await page.fill('#me-place', 'Clubhouse');
  await page.click('#meeting-edit-save');
  await page.waitForSelector('#meeting-edit-form', { state: 'hidden' });
  assert.equal(await page.locator('#meeting-summary').innerText(), 'Wednesday, October 28, 2026 · 6:30 PM · Clubhouse');
  assert.match(await page.locator('#meeting-status').innerText(), /Saved the meeting details\./);
  const [write] = seen.writes;
  assert.equal(write.method, 'PATCH');
  assert.equal(write.body.meeting_date, '2026-10-28');
  assert.equal(write.body.location, 'Clubhouse');
  await ctx.close();
});

await test('deleting a planned meeting takes two clicks, removes its agenda, and returns to the list', async () => {
  const { page, ctx, s } = await openOct();
  await btn(page, 'Delete this meeting').click();
  assert.match(await page.locator('#meeting-delete-area').innerText(), /Delete this meeting and its agenda for good\?/);
  await btn(page, 'Keep this meeting').click();
  assert.equal(s.meetings.length, 1);
  await btn(page, 'Delete this meeting').click();
  await btn(page, 'Yes, delete this meeting').click();
  await page.waitForSelector('#view-meetings:visible');
  await page.waitForFunction(() => document.getElementById('meetings-count').textContent === '0 meetings');
  assert.match(await page.locator('#meetings-status').innerText(), /October Council Meeting was deleted\./);
  assert.equal(s.meetings.length, 0);
  assert.equal(s.agenda.length, 0, 'the agenda went with it');
  await ctx.close();
});

await test('a meeting that has been run is not offered Delete', async () => {
  const { page, ctx } = await openOct({ meetings: [{ ...OCT, status: 'in_progress' }] });
  assert.equal(await btn(page, 'Delete this meeting').count(), 0);
  assert.equal(await page.locator('#meeting-badge').innerText(), 'In progress');
  await ctx.close();
});

console.log('Things going wrong');
await test('failed changes say what happened in plain words, and the screen shows what is really saved', async () => {
  const { page, ctx, s } = await openOct();
  s.fail.agenda_items = 'network';
  await page.fill('#agenda-add-input', 'Something');
  await page.click('#agenda-add-btn');
  await page.waitForSelector('#agenda-error:visible');
  let text = await page.locator('#agenda-error').innerText();
  assert.match(text, /could not save that change\. Check that you are online/);
  assert.doesNotMatch(text, /TypeError|Failed to fetch/);
  assert.deepEqual(await items(page), ['Call to order', 'Budget', 'Adjournment']);
  s.fail.agenda_items = 'permission';
  await btn(page, 'Remove Budget').click();
  await btn(page, 'Yes, remove Budget').click();
  await page.waitForFunction(() => /permission/.test(document.getElementById('agenda-error').textContent));
  assert.equal(await page.locator('#agenda-error').innerText(), 'You do not have permission to do that. Ask an admin.');
  s.fail.agenda_items = 'server';
  await btn(page, 'Move Budget up').click();
  await page.waitForFunction(() => /could not save/.test(document.getElementById('agenda-error').textContent));
  text = await page.locator('#agenda-error').innerText();
  assert.doesNotMatch(text, /XX000|internal error|500/);
  assert.deepEqual(await items(page), ['Call to order', 'Budget', 'Adjournment']);
  await ctx.close();
});

await test('if the meetings cannot be loaded, Try again recovers', async () => {
  const { page, ctx, s } = await open(browser, { meetings: [OCT], agenda: THREE_ITEMS, readFail: { meetings: true } });
  await page.waitForSelector('#meetings-status:visible', { timeout: 40000 });
  assert.match(await page.locator('#meetings-status').innerText(), /could not load your meetings/);
  s.readFail.meetings = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => document.getElementById('meetings-count').textContent === '1 meeting');
  await ctx.close();
});

await test('titles and agenda items with HTML in them are shown as text and run nothing', async () => {
  const evil = '<img src=x onerror="window.__xss=1">Evil';
  const { page, ctx } = await start({
    meetings: [{ ...OCT, title: evil, location: '<b>Room</b>' }],
    agenda: [{ meeting_id: 'mt-oct', title: evil }],
  });
  assert.deepEqual(await listed(page), [evil]);
  await page.getByRole('button', { name: `Open ${evil}` }).click();
  await page.waitForSelector('#agenda-list li');
  assert.equal(await page.locator('#meeting-heading').innerText(), evil);
  assert.match(await page.locator('#meeting-summary').innerText(), /<b>Room<\/b>/);
  assert.deepEqual(await items(page), [evil]);
  assert.equal(await page.locator('#view-meetings img, #view-meeting img').count(), 0);
  assert.equal(await page.locator('#view-meeting b').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});

console.log('On a phone');
await test('creating a meeting and working the agenda fit a phone, with no sideways scroll', async () => {
  const long = 'A very long agenda item about the repair and replacement of the underground parkade membrane and drainage system';
  const { page, ctx } = await open(browser, { meetings: [{ ...OCT, location: 'The amenity room on the second floor of the north tower, 4820 Oak Street' }], agenda: [...THREE_ITEMS, { meeting_id: 'mt-oct', title: long }] },
    { viewport: { width: 390, height: 780 } });
  await page.waitForSelector('#app:visible');
  await page.waitForSelector('#meetings-list li');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(await overflow() <= 1, 'list fits');
  await page.click('#meeting-new');
  const box = await page.locator('#mf-time').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'form fields fit');
  assert.ok(await overflow() <= 1, 'new meeting form fits');
  await page.click('#meeting-form-cancel');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Meeting');
  assert.ok(await overflow() <= 1, `agenda fits (${await overflow()}px over)`);
  await btn(page, `Rename ${long}`).click();
  assert.ok(await overflow() <= 1, 'rename fits');
  await ctx.close();
});

await finish('MEETINGS');
