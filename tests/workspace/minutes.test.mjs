// Browser tests for the minutes document: attendance, notes and autosave (step 5, first half).
// Run with: cd tests/workspace && npm install && npm run test:minutes
import assert from 'node:assert/strict';
import { browser, open, test, finish, visible } from './harness.mjs';

const ROSTER = [
  { id: 'r1', name: 'Alice Adams', role: 'President' },
  { id: 'r2', name: 'Ben Brooks', role: 'Treasurer' },
  { id: 'r3', name: 'Cara Chen', role: 'Director' },
];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'planned' };
const AGENDA = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Budget' },
  { meeting_id: 'mt-oct', title: 'Adjournment' },
];

const btn = (page, name) => page.getByRole('button', { name, exact: true });
const sectionTitles = (page) => page.locator('.doc-section-title').allInnerTexts();
const notesOf = (s, id) => s.agenda.find((a) => a.id === id).notes;
const saved = (page) => page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'saved'
  && document.getElementById('minutes-saved').textContent.includes('Saved'), null, { timeout: 15000 });
const state = (page) => page.locator('#minutes-saved').getAttribute('data-state');

// Open the minutes by going through the meeting screen, as a person would.
async function openMinutes(scenario = {}, opts, { firstInList = false } = {}) {
  const t = await open(browser, { meetings: [OCT], agenda: AGENDA, roster: ROSTER, ...scenario }, opts);
  await t.page.waitForSelector('#meetings-list li');
  await (firstInList ? t.page.locator('#meetings-list .meeting-link').first() : t.page.getByRole('button', { name: 'Open October Council Meeting' })).click();
  await t.page.waitForSelector('#agenda-list li');
  await t.page.click('#meeting-run');
  await t.page.waitForSelector('#view-minutes:visible');
  await t.page.waitForSelector('.doc-section');
  return t;
}
const section = (page, n) => page.locator('.doc-section').nth(n);
const noteParas = (page, n) => section(page, n).locator('.doc-section-body > p');
const notes = (page, n) => noteParas(page, n).first();                      // where to click to type
const noteText = async (page, n) => (await noteParas(page, n).allInnerTexts()).join('\n').trim();   // an empty paragraph reads as a line break
async function typeNotes(page, n, text) {
  await notes(page, n).click();
  await page.keyboard.type(text);
}

console.log('Starting the meeting');
await test('Start the meeting moves it to in progress and opens the minutes with every part in place', async () => {
  const { page, ctx, seen } = await openMinutes();
  const patch = seen.writes.find((w) => w.table === 'meetings' && w.method === 'PATCH');
  assert.deepEqual(patch.body, { status: 'in_progress' });
  assert.equal(patch.id, 'mt-oct');
  assert.equal(await page.locator('.doc-header h1').innerText(), 'October Council Meeting');
  assert.match(await page.locator('.doc-meta').innerText(), /October 21, 2026 · 7:00 PM · Amenity room/);
  assert.deepEqual(await sectionTitles(page), ['1. Call to order', '2. Budget', '3. Adjournment']);
  assert.deepEqual(await page.locator('.att-item strong').allInnerTexts(), ['Alice Adams', 'Ben Brooks', 'Cara Chen']);
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Minutes');
  assert.equal(await state(page), 'saved');
  await ctx.close();
});

await test('opening the minutes of a meeting that is already running does not change its status again', async () => {
  const { page, ctx, seen } = await openMinutes({ meetings: [{ ...OCT, status: 'in_progress' }] });
  assert.equal(seen.writes.filter((w) => w.table === 'meetings').length, 0);
  await ctx.close();
});

await test('notes already saved are shown, one paragraph per line', async () => {
  const { page, ctx } = await openMinutes({ agenda: AGENDA.map((a, i) => (i === 1 ? { ...a, notes: 'First line\nSecond line' } : a)) });
  assert.deepEqual(await noteParas(page, 1).allInnerTexts(), ['First line', 'Second line']);
  assert.equal(await noteParas(page, 0).count(), 1);
  await ctx.close();
});

console.log('Notes save by themselves');
await test('typing notes saves them, and Enter makes a new line', async () => {
  const { page, ctx, s, seen } = await openMinutes();
  await typeNotes(page, 1, 'Budget approved in principle');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dana to confirm numbers');
  assert.equal(await state(page), 'dirty', 'it says so straight away');
  await saved(page);
  assert.equal(notesOf(s, 'ag2'), 'Budget approved in principle\nDana to confirm numbers');
  assert.equal(notesOf(s, 'ag1'), '', 'other items untouched');
  const writes = seen.writes.filter((w) => w.table === 'agenda_items');
  assert.equal(writes.length, 1, 'typing is saved in one go, not letter by letter');
  await ctx.close();
});

await test('what was typed is still there after the page is reloaded', async () => {
  const { page, ctx } = await openMinutes();
  await typeNotes(page, 0, 'Called to order at 7:02 PM');
  await saved(page);
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  assert.equal(await noteText(page, 0), 'Called to order at 7:02 PM');
  assert.equal(await page.locator('#minutes-draft').isVisible(), false, 'nothing left over to restore');
  await ctx.close();
});

await test('Undo takes back typing but not an attendance change', async () => {
  const { page, ctx } = await openMinutes();
  await page.getByLabel('Attendance for Alice Adams').selectOption('present');
  await typeNotes(page, 0, 'oops');
  await page.keyboard.press('Control+z');
  assert.equal(await noteText(page, 0), '');
  assert.equal(await page.getByLabel('Attendance for Alice Adams').inputValue(), 'present');
  await saved(page);
  await ctx.close();
});

await test('Select All and Delete cannot remove the header, attendance or agenda sections', async () => {
  const { page, ctx, s, seen } = await openMinutes({ agenda: AGENDA.map((a, i) => (i === 0 ? { ...a, notes: 'Keep me' } : a)) });
  await notes(page, 0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.doc-header').count(), 1);
  assert.equal(await page.locator('.att').count(), 1);
  assert.deepEqual(await sectionTitles(page), ['1. Call to order', '2. Budget', '3. Adjournment']);
  await page.waitForTimeout(1500);
  assert.equal(s.agenda.length, 3);
  assert.equal(seen.writes.filter((w) => w.method === 'DELETE').length, 0);
  await ctx.close();
});

console.log('Attendance');
await test('marking someone present saves one attendance row, and changes update it', async () => {
  const { page, ctx, s, seen } = await openMinutes();
  await page.getByLabel('Attendance for Alice Adams').selectOption('present');
  await saved(page);
  assert.equal(s.attendance.length, 1);
  assert.deepEqual(
    { ...s.attendance[0] },
    { ...s.attendance[0], meeting_id: 'mt-oct', org_id: 'org-1', roster_id: 'r1', display_name: 'Alice Adams', status: 'present', proxy_for_lot: null },
  );
  await page.getByLabel('Attendance for Alice Adams').selectOption('regrets');
  await saved(page);
  assert.equal(s.attendance.length, 1, 'updated, not added again');
  assert.equal(s.attendance[0].status, 'regrets');
  assert.deepEqual(seen.writes.filter((w) => w.table === 'attendance').map((w) => w.method), ['POST', 'PATCH']);
  await ctx.close();
});

await test('Everyone on the roster is here marks the unrecorded, once, and then goes away', async () => {
  const { page, ctx, s } = await openMinutes();
  await page.getByLabel('Attendance for Ben Brooks').selectOption('absent');
  await saved(page);
  await btn(page, 'Everyone on the roster is here').click();
  await saved(page);
  const byName = Object.fromEntries(s.attendance.map((a) => [a.display_name, a.status]));
  assert.deepEqual(byName, { 'Alice Adams': 'present', 'Ben Brooks': 'absent', 'Cara Chen': 'present' }, 'someone already recorded is left alone');
  assert.equal(await btn(page, 'Everyone on the roster is here').isVisible(), false);
  await ctx.close();
});

await test('clearing a record deletes its row, and a clean choice is not saved at all', async () => {
  const { page, ctx, s, seen } = await openMinutes();
  await page.getByLabel('Attendance for Cara Chen').selectOption('present');
  await page.getByLabel('Attendance for Cara Chen').selectOption('');
  await saved(page);
  assert.equal(s.attendance.length, 0);
  assert.equal(seen.writes.filter((w) => w.table === 'attendance').length, 0, 'changed back before saving, so nothing was sent');
  await page.getByLabel('Attendance for Cara Chen').selectOption('absent');
  await saved(page);
  await page.getByLabel('Attendance for Cara Chen').selectOption('');
  await saved(page);
  assert.equal(s.attendance.length, 0);
  assert.equal(seen.writes.filter((w) => w.table === 'attendance' && w.method === 'DELETE').length, 1);
  await ctx.close();
});

await test('a guest, and a proxy with the lot they represent, can be added and removed', async () => {
  const { page, ctx, s } = await openMinutes();
  await page.getByRole('button', { name: 'Add guest', exact: true }).click();
  assert.equal(await page.locator('.att .error').innerText(), 'Type the guest’s name first.');
  await page.fill('input[aria-label="Guest name"]', '  Pat   Lee ');
  await page.fill('input[aria-label="Lot the guest represents, if they are a proxy"]', 'Lot 14');
  await page.getByRole('button', { name: 'Add guest', exact: true }).click();
  await saved(page);
  assert.equal(s.attendance.length, 1);
  assert.equal(s.attendance[0].roster_id, null);
  assert.equal(s.attendance[0].display_name, 'Pat Lee');
  assert.equal(s.attendance[0].proxy_for_lot, 'Lot 14');
  assert.equal(s.attendance[0].status, 'present');
  assert.match(await page.locator('.att-item').last().innerText(), /Pat Lee[\s\S]*guest, proxy for Lot 14/);
  await btn(page, 'Remove Pat Lee').click();
  await saved(page);
  assert.equal(s.attendance.length, 0);
  await ctx.close();
});

await test('what was recorded before is shown: roster members, a former member and a guest', async () => {
  const { page, ctx } = await openMinutes({
    roster: ROSTER,
    attendance: [
      { meeting_id: 'mt-oct', roster_id: 'r1', display_name: 'Alice Adams', status: 'present' },
      { meeting_id: 'mt-oct', roster_id: 'r2', display_name: 'Ben Brooks', status: 'regrets' },
      { meeting_id: 'mt-oct', roster_id: 'gone', display_name: 'Old Timer', status: 'present' },
      { meeting_id: 'mt-oct', roster_id: null, display_name: 'Pat Lee', status: 'present', proxy_for_lot: 'Lot 14' },
    ],
  });
  assert.equal(await page.getByLabel('Attendance for Alice Adams').inputValue(), 'present');
  assert.equal(await page.getByLabel('Attendance for Ben Brooks').inputValue(), 'regrets');
  assert.equal(await page.getByLabel('Attendance for Cara Chen').inputValue(), '');
  assert.match(await page.locator('.att-list').innerText(), /Old Timer[\s\S]*former member/);
  assert.match(await page.locator('.att-list').innerText(), /Pat Lee[\s\S]*guest, proxy for Lot 14/);
  assert.equal(await state(page), 'saved');
  await ctx.close();
});

await test('with an empty roster the attendance block says where to add people', async () => {
  const { page, ctx } = await openMinutes({ roster: [] });
  assert.match(await page.locator('.att-empty').innerText(), /No one is on the roster yet/);
  await ctx.close();
});

await test('a plain member can record attendance but cannot clear a saved record or remove a saved guest', async () => {
  const { page, ctx } = await openMinutes({
    role: 'member',
    attendance: [
      { meeting_id: 'mt-oct', roster_id: 'r1', display_name: 'Alice Adams', status: 'present' },
      { meeting_id: 'mt-oct', roster_id: null, display_name: 'Pat Lee', status: 'present' },
    ],
  });
  const options = await page.getByLabel('Attendance for Alice Adams').locator('option').allInnerTexts();
  assert.deepEqual(options, ['Present', 'Regrets', 'Absent'], 'no way to clear a saved record');
  assert.equal(await btn(page, 'Remove Pat Lee').count(), 0);
  const fresh = await page.getByLabel('Attendance for Ben Brooks').locator('option').allInnerTexts();
  assert.equal(fresh[0], 'Not recorded', 'an unsaved choice can still be taken back');
  await page.getByLabel('Attendance for Ben Brooks').selectOption('present');
  await saved(page);
  await ctx.close();
});

console.log('When saving goes wrong');
await test('a dropped connection says so, keeps the typing, and saves by itself when it comes back', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { agenda_items: 'network' } });
  await typeNotes(page, 1, 'Typed while offline');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'error');
  const text = await page.locator('#minutes-saved').innerText();
  assert.match(text, /Not saved yet\. Trying again\. Your changes are kept in this browser\./);
  assert.doesNotMatch(text, /TypeError|Failed to fetch/);
  assert.equal(await noteText(page, 1), 'Typed while offline');
  s.fail.agenda_items = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saved(page);
  assert.equal(notesOf(s, 'ag2'), 'Typed while offline');
  await ctx.close();
});

await test('a permission error is explained and not retried over and over', async () => {
  const { page, ctx, s, seen } = await openMinutes({ fail: { agenda_items: 'permission' } });
  await typeNotes(page, 0, 'Cannot save this');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'blocked');
  assert.match(await page.locator('#minutes-saved').innerText(), /do not have permission to change this meeting\. Ask an admin\./);
  const count = seen.writes.filter((w) => w.table === 'agenda_items').length;
  await page.waitForTimeout(2500);
  assert.equal(seen.writes.filter((w) => w.table === 'agenda_items').length, count, 'no retry storm');
  assert.equal(notesOf(s, 'ag1'), '');
  await ctx.close();
});

await test('unsaved typing survives a reload and is offered back, and putting it back saves it', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { agenda_items: 'network' } });
  await typeNotes(page, 2, 'Meeting adjourned at 8:40');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'error');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-workspace-draft:')));
  s.fail.agenda_items = null;
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('#minutes-draft:visible');
  assert.match(await page.locator('#minutes-draft').innerText(), /not saved/);
  assert.equal(await noteText(page, 2), '', 'not applied until asked');
  await btn(page, 'Put them back').click();
  assert.equal(await noteText(page, 2), 'Meeting adjourned at 8:40');
  await saved(page);
  assert.equal(notesOf(s, 'ag3'), 'Meeting adjourned at 8:40');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mh-workspace-draft:')).length), 0);
  await ctx.close();
});

await test('unsaved typing can be thrown away instead', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { agenda_items: 'network' } });
  await typeNotes(page, 0, 'Not wanted');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-workspace-draft:')));
  s.fail.agenda_items = null;
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('#minutes-draft:visible');
  await btn(page, 'Throw them away').click();
  assert.equal(await page.locator('#minutes-draft').isVisible(), false);
  assert.equal(await noteText(page, 0), '');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mh-workspace-draft:')).length), 0);
  await ctx.close();
});

console.log('Moving around');
await test('going back to the meeting does not lose notes that have not saved yet', async () => {
  const { page, ctx, s } = await openMinutes();
  await typeNotes(page, 0, 'Quick note');
  await page.click('#minutes-back');
  await page.waitForSelector('#view-meeting:visible');
  await page.waitForFunction(() => document.getElementById('meeting-heading').textContent !== '');
  await page.waitForTimeout(1500);
  assert.equal(notesOf(s, 'ag1'), 'Quick note');
  assert.equal(await page.locator('#meeting-run').innerText(), 'Open the minutes');
  await ctx.close();
});

await test('opening another meeting saves the first one’s notes before switching', async () => {
  const OTHER = { id: 'mt-nov', title: 'November Council Meeting', meeting_date: '2026-11-18', status: 'planned' };
  const { page, ctx, s } = await openMinutes({
    meetings: [OCT, OTHER],
    agenda: [...AGENDA, { meeting_id: 'mt-nov', title: 'Call to order' }],
  });
  await typeNotes(page, 0, 'Written just now');
  await page.click('#minutes-back');
  await page.waitForSelector('#view-meeting:visible');
  await page.click('.menu-item[data-view=meetings]');
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open November Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('#minutes-draft', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.doc-header h1')?.textContent === 'November Council Meeting');
  assert.equal(notesOf(s, 'ag1'), 'Written just now');
  assert.equal(await noteText(page, 0), '', 'the other meeting starts clean');
  await ctx.close();
});

await test('signing out saves what can be saved first', async () => {
  const { page, ctx, s } = await openMinutes();
  await typeNotes(page, 1, 'Last words');
  await page.click('#signout-btn');
  await page.waitForSelector('#signin-form:visible');
  assert.equal(notesOf(s, 'ag2'), 'Last words');
  await ctx.close();
});

await test('a meeting deleted elsewhere says so, and a failed load can be retried', async () => {
  let t = await openMinutes();
  await t.page.click('#minutes-back');
  await t.page.waitForSelector('#view-meeting:visible');
  t.s.meetings = [];
  await t.page.click('#meeting-run');
  await t.page.waitForFunction(() => /no longer there/.test(document.getElementById('minutes-status').textContent));
  assert.equal(await t.page.locator('.doc-header').count(), 0);
  await t.ctx.close();

  t = await open(browser, { meetings: [OCT], agenda: AGENDA, roster: ROSTER });
  await t.page.waitForSelector('#meetings-list li');
  await t.page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await t.page.waitForSelector('#agenda-list li');
  t.s.readFail = { attendance: true };
  await t.page.click('#meeting-run');
  await t.page.waitForFunction(() => /could not load the minutes/.test(document.getElementById('minutes-status').textContent), null, { timeout: 40000 });
  t.s.readFail.attendance = false;
  await t.page.getByRole('button', { name: 'Try again' }).click();
  await t.page.waitForSelector('.doc-section');
  await t.ctx.close();
});

await test('names and notes with HTML in them are shown as text and run nothing', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const { page, ctx } = await openMinutes({
    meetings: [{ ...OCT, title: `${evil}Title` }],
    roster: [{ id: 'r1', name: `${evil}Mallory`, role: '<b>Boss</b>' }],
    agenda: [{ meeting_id: 'mt-oct', title: `${evil}Item`, notes: `${evil}note` }],
  }, undefined, { firstInList: true });
  assert.match(await page.locator('.doc-header h1').innerText(), /<img src=x/);
  assert.match(await page.locator('.att-item').first().innerText(), /<img src=x[\s\S]*<b>Boss<\/b>/);
  assert.match(await page.locator('.doc-section-title').innerText(), /<img src=x/);
  assert.match(await noteText(page, 0), /<img src=x/);
  assert.equal(await page.locator('#editor img').count(), 0);
  assert.equal(await page.locator('#editor b').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});

console.log('On a phone');
await test('the minutes fit a phone, and notes and attendance can be used', async () => {
  const { page, ctx, s } = await openMinutes({
    roster: [{ id: 'r1', name: 'Bartholomew Montgomery-Featherstonehaugh', role: 'Vice President of Landscaping' }, ...ROSTER.slice(1)],
  }, { viewport: { width: 390, height: 780 } });
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Minutes');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(await overflow() <= 1, `fits (${await overflow()}px over)`);
  await page.getByLabel('Attendance for Cara Chen').selectOption('present');
  await typeNotes(page, 0, 'A note typed on a phone');
  await saved(page);
  assert.equal(notesOf(s, 'ag1'), 'A note typed on a phone');
  assert.equal(s.attendance.length, 1);
  assert.ok(await overflow() <= 1, 'still fits after use');
  await ctx.close();
});

await finish('MINUTES');
