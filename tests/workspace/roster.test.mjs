// Browser tests for the roster screen (step 3).
// Run with: cd tests/workspace && npm install && npm run test:roster
import assert from 'node:assert/strict';
import { browser, open, test, finish, visible } from './harness.mjs';

const THREE = [
  { name: 'Alice Adams', role: 'President' },
  { name: 'Ben Brooks', role: 'Treasurer' },
  { name: 'Cara Chen', role: 'Director' },
];

async function openRoster(scenario = {}, opts) {
  const t = await open(browser, scenario, opts);
  await t.page.waitForSelector('#app:visible');
  await t.page.click('.menu-item[data-view=roster]');
  await t.page.waitForSelector('#view-roster:visible');
  await t.page.waitForFunction(() => document.getElementById('roster-count').textContent !== '');
  return t;
}
const names = (page) => page.locator('#roster-list .roster-info strong').allInnerTexts();
const btn = (page, name) => page.getByRole('button', { name, exact: true });
async function fillForm(page, v) {
  if (v.name !== undefined) await page.fill('#rf-name', v.name);
  if (v.role !== undefined) await page.fill('#rf-role', v.role);
  if (v.lot !== undefined) await page.fill('#rf-lot', v.lot);
  if (v.email !== undefined) await page.fill('#rf-email', v.email);
  if (v.start !== undefined) await page.fill('#rf-term-start', v.start);
  if (v.end !== undefined) await page.fill('#rf-term-end', v.end);
}

console.log('Getting there');
await test('the menu opens the roster and the meetings come back from All meetings', async () => {
  const { page, ctx } = await openRoster();
  assert.equal(await visible(page, '#view-meetings'), false);
  assert.equal(await page.locator('.menu-item[data-view=roster]').getAttribute('aria-current'), 'page');
  await page.click('.menu-item[data-view=meetings]');
  assert.equal(await visible(page, '#view-meetings'), true);
  assert.equal(await visible(page, '#view-roster'), false);
  await ctx.close();
});

await test('an empty roster explains what it is for', async () => {
  const { page, ctx } = await openRoster();
  assert.equal(await page.locator('#roster-count').innerText(), '0 active members');
  assert.match(await page.locator('#roster-empty').innerText(), /who moved, who seconded and who attended/);
  await ctx.close();
});

console.log('Adding and editing');
await test('adding a member shows them in the list and saves the right row', async () => {
  const { page, ctx, seen } = await openRoster();
  await page.click('#roster-add');
  await fillForm(page, { name: '  Dana   Whitfield ', role: 'President', lot: 'SL 205', email: 'dana@example.test' });
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  assert.deepEqual(await names(page), ['Dana Whitfield']);
  assert.match(await page.locator('#roster-list .roster-meta').innerText(), /President · Lot SL 205 · dana@example\.test/);
  assert.equal(await page.locator('#roster-count').innerText(), '1 active member');
  assert.match(await page.locator('#roster-status').innerText(), /Added Dana Whitfield\./);
  const [write] = seen.rosterWrites;
  assert.equal(write.method, 'POST');
  assert.equal(write.body.org_id, 'org-1');
  assert.equal(write.body.name, 'Dana Whitfield', 'extra spaces are tidied');
  assert.equal(write.body.sort_order, 0);
  await ctx.close();
});

await test('a blank role becomes Director, and new members go to the end of the list', async () => {
  const { page, ctx, seen } = await openRoster({ roster: THREE });
  await page.click('#roster-add');
  await fillForm(page, { name: 'Dev Dhillon' });
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  assert.equal(seen.rosterWrites[0].body.role, 'Director');
  assert.equal(seen.rosterWrites[0].body.sort_order, 3);
  assert.deepEqual(await names(page), ['Alice Adams', 'Ben Brooks', 'Cara Chen', 'Dev Dhillon']);
  await ctx.close();
});

await test('bad input is stopped with a plain sentence and nothing is sent', async () => {
  const { page, ctx, seen } = await openRoster({ roster: THREE });
  const tryIt = async (values, expected) => {
    await page.click('#roster-add');
    await fillForm(page, { name: '', role: '', lot: '', email: '', start: '', end: '', ...values });
    await page.click('#roster-save');
    await page.waitForSelector('#roster-form-error:visible');
    assert.match(await page.locator('#roster-form-error').innerText(), expected);
  };
  await tryIt({}, /^Enter a name\.$/);
  await tryIt({ name: 'Eve Evans', email: 'not-an-email' }, /email address does not look right/);
  await tryIt({ name: 'Eve Evans', start: '2026-06-01', end: '2026-01-01' }, /term end date is before the start date/);
  await tryIt({ name: 'alice  ADAMS' }, /Alice Adams is already on the roster\. Add a last name or an initial/);
  assert.equal(seen.rosterWrites.length, 0);
  assert.equal((await names(page)).length, 3);
  await ctx.close();
});

await test('editing fills the form with what is saved, and saves only that member', async () => {
  const { page, ctx, seen } = await openRoster({ roster: THREE });
  await btn(page, 'Edit Ben Brooks').click();
  assert.equal(await page.locator('#roster-form-title').innerText(), 'Edit Ben Brooks');
  assert.equal(await page.inputValue('#rf-name'), 'Ben Brooks');
  assert.equal(await page.inputValue('#rf-role'), 'Treasurer');
  await page.fill('#rf-role', 'Vice President');
  await page.fill('#rf-lot', 'SL 12');
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  const [write] = seen.rosterWrites;
  assert.equal(write.method, 'PATCH');
  assert.equal(write.id, 'm2');
  assert.equal(write.body.role, 'Vice President');
  assert.equal(write.body.strata_lot, 'SL 12');
  assert.match(await page.locator('#roster-list .roster-item').nth(1).innerText(), /Vice President · Lot SL 12/);
  await ctx.close();
});

await test('keeping the same name when editing is not flagged as a duplicate', async () => {
  const { page, ctx } = await openRoster({ roster: THREE });
  await btn(page, 'Edit Alice Adams').click();
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  await ctx.close();
});

await test('Cancel closes the form without saving', async () => {
  const { page, ctx, seen } = await openRoster();
  await page.click('#roster-add');
  await fillForm(page, { name: 'Nobody' });
  await page.click('#roster-cancel');
  assert.equal(await visible(page, '#roster-form'), false);
  assert.equal(seen.rosterWrites.length, 0);
  await ctx.close();
});

console.log('Order, retiring and removing');
await test('Up and Down reorder the list, and the ends cannot move off it', async () => {
  const { page, ctx } = await openRoster({ roster: THREE });
  assert.equal(await btn(page, 'Move Alice Adams up').isDisabled(), true);
  assert.equal(await btn(page, 'Move Cara Chen down').isDisabled(), true);
  await btn(page, 'Move Alice Adams down').click();
  await page.waitForFunction(() => document.querySelector('#roster-list .roster-info strong').textContent === 'Ben Brooks');
  assert.deepEqual(await names(page), ['Ben Brooks', 'Alice Adams', 'Cara Chen']);
  await btn(page, 'Move Cara Chen up').click();
  await page.waitForFunction(() => document.querySelectorAll('#roster-list .roster-info strong')[1].textContent === 'Cara Chen');
  assert.deepEqual(await names(page), ['Ben Brooks', 'Cara Chen', 'Alice Adams']);
  await ctx.close();
});

await test('members who all share the same order number can still be reordered', async () => {
  const same = THREE.map((m) => ({ ...m, sort_order: 0 }));
  const { page, ctx } = await openRoster({ roster: same });
  const before = await names(page);
  await btn(page, `Move ${before[0]} down`).click();
  await page.waitForFunction((first) => document.querySelector('#roster-list .roster-info strong').textContent !== first, before[0]);
  const after = await names(page);
  assert.deepEqual(after, [before[1], before[0], before[2]]);
  await ctx.close();
});

await test('retiring moves someone to Former members, and bringing them back restores them', async () => {
  const { page, ctx } = await openRoster({ roster: THREE });
  await btn(page, 'Retire Ben Brooks').click();
  await page.waitForFunction(() => document.getElementById('roster-count').textContent === '2 active members');
  assert.deepEqual(await names(page), ['Alice Adams', 'Cara Chen']);
  assert.match(await page.locator('#roster-status').innerText(), /Ben Brooks is now a former member\. They stay in past minutes\./);
  assert.equal(await page.locator('#roster-former-count').innerText(), '1');
  await page.click('#roster-former summary');
  await btn(page, 'Bring Ben Brooks back').click();
  await page.waitForFunction(() => document.getElementById('roster-count').textContent === '3 active members');
  assert.equal(await visible(page, '#roster-former'), false);
  await ctx.close();
});

await test('bringing back someone whose name is now taken is stopped', async () => {
  const { page, ctx, seen } = await openRoster({ roster: [...THREE, { name: 'Ben Brooks', role: 'Director', status: 'former' }] });
  await page.click('#roster-former summary');
  await btn(page, 'Bring Ben Brooks back').click();
  assert.match(await page.locator('#roster-status').innerText(), /Ben Brooks is already on the roster/);
  assert.equal(seen.rosterWrites.length, 0);
  await ctx.close();
});

await test('removing for good takes two clicks, and Keep backs out', async () => {
  const { page, ctx, seen } = await openRoster({ roster: [...THREE, { name: 'Old Timer', status: 'former' }] });
  await page.click('#roster-former summary');
  await btn(page, 'Remove Old Timer permanently').click();
  assert.match(await page.locator('#roster-former-list').innerText(), /Remove Old Timer for good\?/);
  await btn(page, 'Keep Old Timer').click();
  assert.equal(seen.rosterWrites.length, 0, 'nothing deleted yet');
  await btn(page, 'Remove Old Timer permanently').click();
  await btn(page, 'Yes, remove Old Timer permanently').click();
  await page.waitForFunction(() => document.getElementById('roster-former').classList.contains('hidden'));
  assert.deepEqual(seen.rosterWrites.map((w) => w.method), ['DELETE']);
  await ctx.close();
});

console.log('Who can change it');
await test('a plain member can read the roster but sees no way to change it', async () => {
  const { page, ctx } = await openRoster({ role: 'member', roster: THREE });
  assert.deepEqual(await names(page), ['Alice Adams', 'Ben Brooks', 'Cara Chen']);
  assert.equal(await visible(page, '#roster-add'), false);
  assert.equal(await page.locator('#roster-list button').count(), 0);
  assert.match(await page.locator('#roster-readonly').innerText(), /Only admins can change the roster/);
  assert.equal(await visible(page, '#roster-empty'), false);
  await ctx.close();
});

await test('an admin can change it', async () => {
  const { page, ctx } = await openRoster({ role: 'admin', roster: THREE });
  assert.equal(await visible(page, '#roster-add'), true);
  assert.equal(await visible(page, '#roster-readonly'), false);
  await ctx.close();
});

console.log('Careless clicking and things going wrong');
await test('double-clicking Save adds the member once', async () => {
  const { page, ctx, seen } = await openRoster();
  await page.click('#roster-add');
  await fillForm(page, { name: 'Dana Whitfield' });
  await page.dblclick('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  assert.equal(seen.rosterWrites.length, 1);
  assert.deepEqual(await names(page), ['Dana Whitfield']);
  await ctx.close();
});

await test('a dropped connection keeps the form open with a plain message, and saving again works', async () => {
  const { page, ctx, s } = await openRoster();
  s.rosterFail = 'network';
  await page.click('#roster-add');
  await fillForm(page, { name: 'Dana Whitfield' });
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form-error:visible');
  const text = await page.locator('#roster-form-error').innerText();
  assert.match(text, /could not save that\. Check that you are online/);
  assert.doesNotMatch(text, /TypeError|Failed to fetch|NetworkError/);
  assert.equal(await visible(page, '#roster-form'), true, 'what was typed is not lost');
  assert.equal(await page.inputValue('#rf-name'), 'Dana Whitfield');
  s.rosterFail = null;
  await page.click('#roster-save');
  await page.waitForSelector('#roster-form', { state: 'hidden' });
  assert.deepEqual(await names(page), ['Dana Whitfield']);
  await ctx.close();
});

await test('a permission error says so, and a server error stays plain', async () => {
  const { page, ctx, s } = await openRoster({ roster: THREE });
  s.rosterFail = 'permission';
  await btn(page, 'Retire Ben Brooks').click();
  await page.waitForSelector('#roster-status:visible');
  assert.match(await page.locator('#roster-status').innerText(), /do not have permission to change the roster\. Ask an admin\./);
  assert.equal((await names(page)).length, 3, 'the screen still shows what is really saved');
  s.rosterFail = 'server';
  await btn(page, 'Retire Ben Brooks').click();
  await page.waitForFunction(() => /could not save that/.test(document.getElementById('roster-status').textContent));
  const text = await page.locator('#roster-status').innerText();
  assert.doesNotMatch(text, /XX000|internal error|500/);
  await ctx.close();
});

await test('if the roster cannot be loaded, Try again recovers', async () => {
  const { page, ctx, s } = await open(browser, { roster: THREE, rosterReadFail: true }).then(async (t) => {
    await t.page.waitForSelector('#app:visible');
    return t;
  });
  await page.click('.menu-item[data-view=roster]');
  await page.waitForSelector('#roster-status:visible', { timeout: 40000 });
  assert.match(await page.locator('#roster-status').innerText(), /could not load the roster/);
  s.rosterReadFail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => document.getElementById('roster-count').textContent === '3 active members');
  await ctx.close();
});

await test('a name with HTML in it is shown as text and runs nothing', async () => {
  const evil = '<img src=x onerror="window.__xss=1">Mallory';
  const { page, ctx } = await openRoster({ roster: [{ name: evil, role: '<b>Boss</b>' }] });
  assert.deepEqual(await names(page), [evil]);
  assert.match(await page.locator('#roster-list .roster-meta').innerText(), /<b>Boss<\/b>/);
  assert.equal(await page.locator('#view-roster img[src="x"]').count(), 0);
  assert.equal(await page.locator('#roster-list b').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await ctx.close();
});

console.log('For the steps that come next');
await test('Roster.active() hands later steps only current members, as copies', async () => {
  const { page, ctx } = await openRoster({ roster: [...THREE, { name: 'Old Timer', status: 'former' }] });
  const list = await page.evaluate(() => {
    const first = Roster.active();
    first[0].name = 'TAMPERED';
    return { names: Roster.active().map((m) => m.name), ids: Roster.active().map((m) => m.id) };
  });
  assert.deepEqual(list.names, ['Alice Adams', 'Ben Brooks', 'Cara Chen']);
  assert.ok(list.ids.every(Boolean));
  await ctx.close();
});

console.log('On a phone');
await test('the roster fits a phone: Menu leads to it, nothing scrolls sideways, buttons can be reached', async () => {
  const long = { name: 'Bartholomew Montgomery-Featherstonehaugh', role: 'Vice President of Landscaping', email: 'bartholomew.montgomery-featherstonehaugh@example-strata-corporation.test' };
  const { page, ctx } = await open(browser, { roster: [long, ...THREE] }, { viewport: { width: 390, height: 780 } });
  await page.waitForSelector('#app:visible');
  await page.click('.pane-tabs [data-pane=menu]');
  await page.click('.menu-item[data-view=roster]');
  await page.waitForSelector('#view-roster:visible');
  assert.equal(await page.locator('.pane-tabs [data-pane=doc]').innerText(), 'Roster');
  assert.equal(await visible(page, '#pane-menu'), false, 'it jumps to the main area');
  await page.click('#roster-add');
  assert.equal(await visible(page, '#rf-name'), true);
  const box = await page.locator('#rf-term-end').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'form fields fit the screen');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `no sideways scroll (${overflow}px over)`);
  await ctx.close();
});

await finish('ROSTER');
