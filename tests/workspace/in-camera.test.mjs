// Browser tests for the in-camera switch (step 7).
// Run with: cd tests/workspace && npm install && npm run test:in-camera
import assert from 'node:assert/strict';
import { browser, open, test, finish } from './harness.mjs';

const ROSTER = [
  { id: 'r1', name: 'Alice Adams', role: 'President' },
  { id: 'r2', name: 'Ben Brooks', role: 'Treasurer' },
];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'in_progress' };
const AGENDA = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Dispute with Lot 12' },
  { meeting_id: 'mt-oct', title: 'Adjournment' },
];

const section = (page, n) => page.locator('.doc-section').nth(n);
const toggle = (page, n) => section(page, n).locator('.doc-section-buttons button[aria-pressed]');
const panel = (page, n) => section(page, n).locator('.camera-panel');
const badge = (page, n) => section(page, n).locator('.camera-badge');
const motions = (page, n) => section(page, n).locator('.blk-motion');
const row = (s, id) => s.agenda.find((a) => a.id === id);
const saved = (page) => page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'saved'
  && document.getElementById('minutes-saved').textContent.includes('Saved'), null, { timeout: 15000 });
const marked = (page, n) => section(page, n).evaluate((e) => e.classList.contains('is-in-camera'));

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
// Build the owner copy, in the page, from what the pretend database now holds.
const ownerCopy = (page, s) => page.evaluate((d) => JSON.parse(JSON.stringify(OwnerCopy.build(d))), {
  meeting: s.meetings[0], agenda: s.agenda, attendance: s.attendance, motions: s.motions, actions: s.actions });

console.log('Switching an item to in camera');
await test('every item offers the switch, off by default, with no panel and no badge', async () => {
  const { page, ctx } = await openMinutes();
  for (const n of [0, 1, 2]) {
    assert.equal(await toggle(page, n).innerText(), 'Mark as in camera');
    assert.equal(await toggle(page, n).getAttribute('aria-pressed'), 'false');
    assert.equal(await badge(page, n).isVisible(), false);
    assert.equal(await panel(page, n).isVisible(), false);
    assert.equal(await marked(page, n), false);
  }
  await ctx.close();
});

await test('switching it on marks that item clearly and explains what owners will see', async () => {
  const { page, ctx } = await openMinutes();
  await toggle(page, 1).click();
  assert.equal(await marked(page, 1), true);
  assert.equal(await badge(page, 1).isVisible(), true);
  assert.equal(await badge(page, 1).textContent(), 'In camera');
  assert.equal(await toggle(page, 1).getAttribute('aria-pressed'), 'true');
  assert.match(await panel(page, 1).innerText(), /This item is in camera\. It stays in the council record, and owners will see only the title and summary below\./);
  assert.equal(await marked(page, 0), false, 'only that item');
  assert.equal(await marked(page, 2), false);
  await ctx.close();
});

await test('it saves through the usual autosave, with the public text blank until the secretary writes some', async () => {
  const { page, ctx, s, seen } = await openMinutes();
  await toggle(page, 1).click();
  await saved(page);
  assert.deepEqual({ c: row(s, 'ag2').is_in_camera, t: row(s, 'ag2').public_title ?? null, u: row(s, 'ag2').public_summary ?? null }, { c: true, t: null, u: null });
  assert.equal(row(s, 'ag1').is_in_camera, false);
  assert.equal(seen.writes.filter((w) => w.table === 'agenda_items' && w.method === 'PATCH').length, 1);
  await ctx.close();
});

await test('the public title and summary can be typed, save, and come back after a reload', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  await section(page, 1).getByLabel('Short summary owners will see (optional)').fill('Advice was received.');
  await saved(page);
  assert.deepEqual({ c: row(s, 'ag2').is_in_camera, t: row(s, 'ag2').public_title, u: row(s, 'ag2').public_summary }, { c: true, t: 'Legal matter', u: 'Advice was received.' });

  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  assert.equal(await marked(page, 1), true);
  assert.equal(await section(page, 1).getByLabel('Title owners will see').inputValue(), 'Legal matter');
  assert.equal(await section(page, 1).getByLabel('Short summary owners will see (optional)').inputValue(), 'Advice was received.');
  await ctx.close();
});

await test('typing in the public fields keeps the cursor in the box, one character at a time', async () => {
  const { page, ctx } = await openMinutes();
  await toggle(page, 1).click();
  const box = section(page, 1).getByLabel('Title owners will see');
  await box.click();
  await page.keyboard.type('Personnel matter', { delay: 20 });
  assert.equal(await box.inputValue(), 'Personnel matter');
  assert.equal(await box.evaluate((e) => e === document.activeElement), true);
  await ctx.close();
});

await test('switching it off hides the panel but keeps what was written, and on again brings it back', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  await toggle(page, 1).click();
  assert.equal(await marked(page, 1), false);
  assert.equal(await panel(page, 1).isVisible(), false);
  await saved(page);
  assert.equal(row(s, 'ag2').is_in_camera, false);
  assert.equal(row(s, 'ag2').public_title, 'Legal matter');
  await toggle(page, 1).click();
  assert.equal(await section(page, 1).getByLabel('Title owners will see').inputValue(), 'Legal matter');
  await ctx.close();
});

await test('two quick clicks end up off, and Undo does not flip it', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).dblclick();
  assert.equal(await marked(page, 1), false);
  await saved(page).catch(() => {});
  await page.locator('.doc-section-body > p').first().click();
  await toggle(page, 2).click();
  await page.locator('.doc-section-body > p').first().click();
  await page.keyboard.press('Control+z');
  assert.equal(await marked(page, 2), true, 'Undo is for typing');
  await saved(page);
  assert.equal(row(s, 'ag2').is_in_camera ?? false, false);
  assert.equal(row(s, 'ag3').is_in_camera, true);
  await ctx.close();
});

await test('two items can be in camera at once, each with its own public text', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal');
  await toggle(page, 2).click();
  await section(page, 2).getByLabel('Title owners will see').fill('Personnel');
  await saved(page);
  assert.deepEqual([row(s, 'ag2').public_title, row(s, 'ag3').public_title], ['Legal', 'Personnel']);
  assert.equal(row(s, 'ag1').is_in_camera, false);
  await ctx.close();
});

console.log('Working inside an in-camera item');
await test('notes, motions and action items still work, and are saved against the item', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Lawyer advised us');
  await section(page, 1).getByRole('button', { name: 'Add a motion', exact: true }).click();
  await page.keyboard.type('Settle the claim');
  await saved(page);
  assert.equal(row(s, 'ag2').notes, 'Lawyer advised us');
  assert.equal(s.motions[0].agenda_item_id, 'ag2');
  assert.equal(await motions(page, 1).count(), 1);
  await ctx.close();
});

await test('what the assistant adds to an in-camera item is labelled in the list, and goes to that item', async () => {
  const entries = [{ kind: 'note', text: 'Lawyer advised us' }];
  const { page, ctx, s } = await openMinutes({ chat: () => ({ body: { entries, unmatched: [] } }) });
  await toggle(page, 1).click();
  assert.deepEqual(await page.locator('#chat-target option').allInnerTexts(), ['1. Call to order', '2. Dispute with Lot 12 (in camera)', '3. Adjournment']);
  await page.selectOption('#chat-target', 'ag2');
  await page.fill('#chat-input', 'the lawyer advised us');
  await page.click('#chat-send');
  await page.waitForFunction(() => !document.querySelector('#chat-log .wait') && !document.getElementById('chat-send').disabled);
  assert.match(await page.locator('#chat-log .bubble').last().innerText(), /Added to “Dispute with Lot 12”: 1 note\./);
  await saved(page);
  assert.equal(row(s, 'ag2').notes, 'Lawyer advised us');
  await ctx.close();
});

console.log('Opening meetings that already have an in-camera item');
await test('it appears marked, with its public text, and opening it writes nothing', async () => {
  const agenda = AGENDA.map((a, i) => (i === 1 ? { ...a, is_in_camera: true, public_title: 'Legal matter', public_summary: 'Advice was received.' } : a));
  const { page, ctx, seen } = await openMinutes({ agenda });
  assert.equal(await marked(page, 1), true);
  assert.equal(await marked(page, 0), false);
  assert.equal(await section(page, 1).getByLabel('Title owners will see').inputValue(), 'Legal matter');
  await page.waitForTimeout(1500);
  assert.equal(seen.writes.filter((w) => w.table === 'agenda_items').length, 0);
  await ctx.close();
});

await test('an item saved before this existed, with the new columns empty, opens as an ordinary item', async () => {
  const { page, ctx } = await openMinutes({ agenda: AGENDA.map((a) => ({ ...a, is_in_camera: null, public_title: null, public_summary: null })) });
  for (const n of [0, 1, 2]) assert.equal(await marked(page, n), false);
  await ctx.close();
});

console.log('The owner copy');
await test('after switching an item on and typing in it, the owner copy has none of it, only the public title and summary', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  await section(page, 1).getByLabel('Short summary owners will see (optional)').fill('Advice was received.');
  await section(page, 1).locator('.doc-section-body > p').first().click();
  await page.keyboard.type('SECRET lawyer advised us');
  await section(page, 1).getByRole('button', { name: 'Add a motion', exact: true }).click();
  await page.keyboard.type('SECRET settle the claim');
  await section(page, 2).locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Meeting adjourned');
  await saved(page);

  const copy = await ownerCopy(page, s);
  const all = JSON.stringify(copy);
  assert.ok(!all.includes('SECRET'), 'no secret text');
  assert.ok(!all.includes('Dispute with Lot 12'), 'not even its real title');
  assert.deepEqual(copy.sections[1], { number: 2, inCamera: true, title: 'Legal matter', summary: 'Advice was received.' });
  assert.equal(copy.sections[2].notes, 'Meeting adjourned');
  assert.deepEqual(copy.heldBack, { motions: 0, actions: 0 });
  await ctx.close();
});

await test('switching it off again puts the item back into the owner copy', async () => {
  const { page, ctx, s } = await openMinutes();
  await toggle(page, 1).click();
  await saved(page);
  assert.equal((await ownerCopy(page, s)).sections[1].inCamera, true);
  await toggle(page, 1).click();
  await saved(page);
  const copy = await ownerCopy(page, s);
  assert.deepEqual([copy.sections[1].inCamera, copy.sections[1].title], [false, 'Dispute with Lot 12']);
  await ctx.close();
});

console.log('When saving goes wrong');
await test('a dropped connection keeps the switch and the text, and saves when it comes back', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { agenda_items: 'network' } });
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'error');
  assert.equal(await marked(page, 1), true);
  s.fail.agenda_items = null;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saved(page);
  assert.deepEqual([row(s, 'ag2').is_in_camera, row(s, 'ag2').public_title], [true, 'Legal matter']);
  await ctx.close();
});

await test('an unsaved in-camera switch is offered back after a reload, with its text', async () => {
  const { page, ctx, s } = await openMinutes({ fail: { agenda_items: 'network' } });
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'error');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-workspace-draft:')));
  s.fail.agenda_items = null;
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('#minutes-draft:visible');
  assert.equal(await marked(page, 1), false, 'not applied until asked');
  await page.getByRole('button', { name: 'Put them back', exact: true }).click();
  assert.equal(await marked(page, 1), true);
  assert.equal(await section(page, 1).getByLabel('Title owners will see').inputValue(), 'Legal matter');
  await saved(page);
  assert.deepEqual([row(s, 'ag2').is_in_camera, row(s, 'ag2').public_title], [true, 'Legal matter']);
  await ctx.close();
});

await test('a permission error is explained and the switch stays on screen', async () => {
  const { page, ctx } = await openMinutes({ fail: { agenda_items: 'permission' } });
  await toggle(page, 1).click();
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'blocked');
  assert.match(await page.locator('#minutes-saved').innerText(), /do not have permission to change this meeting/);
  assert.equal(await marked(page, 1), true);
  await ctx.close();
});

await test('HTML typed into the public fields is kept as text and runs nothing', async () => {
  const evil = '<img src=x onerror="window.__owned=1">';
  const { page, ctx, s, seen } = await openMinutes();
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill(evil);
  await saved(page);
  assert.equal(row(s, 'ag2').public_title, evil);
  assert.equal(await page.evaluate(() => window.__owned ?? null), null);
  assert.equal(await page.locator('.doc-section img').count(), 0);
  assert.deepEqual(seen.pageErrors, []);
  await ctx.close();
});

console.log('On a phone');
await test('on a phone the switch and the public fields fit and can be used', async () => {
  const { page, ctx, s } = await openMinutes({}, { viewport: { width: 390, height: 780 } });
  await toggle(page, 1).click();
  await section(page, 1).getByLabel('Title owners will see').fill('Legal matter');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
  assert.equal(await badge(page, 1).isVisible(), true);
  await saved(page);
  assert.equal(row(s, 'ag2').public_title, 'Legal matter');
  await ctx.close();
});

await finish('IN-CAMERA');
