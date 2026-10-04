// Browser tests for the draft, review and approval screens (step 8). The draft-minutes function is
// pretended: each test says what it answers and checks what the page does with that. The function's own
// rules are tested in tests/draft, and how the real model writes in tests/draft/live.mjs.
// Run with: cd tests/workspace && npm install && npm run test:draft
import assert from 'node:assert/strict';
import { browser, open, test, finish } from './harness.mjs';

const ROSTER = [{ id: 'r1', name: 'Alice Adams', role: 'President' }, { id: 'r2', name: 'Ben Brooks', role: 'Treasurer' }];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'in_progress' };
const AGENDA = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Budget' },
  { meeting_id: 'mt-oct', title: 'Dispute with Lot 12', is_in_camera: true, public_title: 'Legal matter', public_summary: 'Advice was received.' },
];
const MOTION = { id: 'mo1', meeting_id: 'mt-oct', agenda_item_id: 'ag2', description: 'Approve the budget', moved_by: 'Alice Adams', seconded_by: 'Ben Brooks',
                 mover_roster_id: 'r1', seconder_roster_id: 'r2', result: 'carried', vote_tally: '5-1', confirmed: true, sort_order: 0 };

const snapshot = () => ({
  orgName: 'Parkview Terrace Strata',
  meeting: { title: 'October Council Meeting', meeting_date: '2026-10-21', location: 'Amenity room' },
  agenda: [
    { id: 'ag1', title: 'Call to order', sort_order: 0, is_in_camera: false },
    { id: 'ag2', title: 'Budget', sort_order: 1, is_in_camera: false },
    { id: 'ag3', title: 'Dispute with Lot 12', sort_order: 2, is_in_camera: true, public_title: 'Legal matter', public_summary: 'Advice was received.' },
  ],
  attendance: [{ display_name: 'Alice Adams', status: 'present', proxy_for_lot: null }, { display_name: 'Ben Brooks', status: 'present', proxy_for_lot: null }, { display_name: 'Cara Chen', status: 'absent', proxy_for_lot: null }],
});
const sections = () => [
  { agenda_item_id: 'ag1', narrative: 'The meeting was called to order at 7:02.', motions: [], actions: [] },
  { agenda_item_id: 'ag2', narrative: 'The council reviewed the budget.', motions: [{ id: 'mo1', text: 'MOVED by Alice Adams, SECONDED by Ben Brooks: that the budget be approved. CARRIED 5-1.' }], actions: [] },
  { agenda_item_id: 'ag3', narrative: 'The lawyer gave advice on the claim.', motions: [], actions: [] },
];
const drafted = (over = {}) => ({ draft: { sections: sections(), closing: 'The meeting was adjourned.' }, snapshot: snapshot(), blocking: [], notes: ['Nothing is recorded under “Call to order”.'], ...over });

// What the pretend function does for each action unless a test says otherwise.
const fn = (over = {}) => (body, s) => {
  const meeting = s.meetings[0];
  const handler = {
    draft: () => ({ body: drafted() }),
    check: () => ({ body: { blocking: [], notes: [], snapshot: snapshot(), problems: [] } }),
    approve: () => {
      meeting.status = 'approved';
      (s.versions ??= []).push({ meeting_id: meeting.id, saved_at: '2026-10-21T21:00:00.000Z', draft: { kind: 'workspace-draft', draft: body.draft, snapshot: snapshot() } });
      return { body: { approved: true } };
    },
    reopen: () => { meeting.status = 'review'; return { body: { reopened: true, unpublished: false } }; },
    ...over,
  }[body.action];
  return handler(body, s);
};

const btn = (page, name) => page.getByRole('button', { name, exact: true });
const field = (page, label, n = 0) => page.locator('#draft-doc .draft-field', { hasText: label }).nth(n).locator('textarea');
const saved = (page) => page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'saved'
  && document.getElementById('minutes-saved').textContent.includes('Saved'), null, { timeout: 15000 });

async function openMinutes(scenario = {}, opts) {
  const t = await open(browser, { meetings: [OCT], agenda: AGENDA, roster: ROSTER, motions: [MOTION], draftFn: fn(), ...scenario }, opts);
  await t.page.waitForSelector('#meetings-list li');
  await t.page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await t.page.waitForSelector('#agenda-list li');
  await t.page.click('#meeting-run');
  await t.page.waitForSelector('#view-minutes:visible');
  await t.page.waitForSelector('.doc-section');
  return t;
}
async function openDraft(scenario = {}, opts) {
  const t = await openMinutes(scenario, opts);
  await t.page.click('#minutes-draft-btn');
  await t.page.waitForSelector('#view-draft:visible');
  return t;
}
const ready = (page) => page.waitForSelector('#draft-body:visible');
const draftCalls = (seen, action) => seen.draftCalls.filter((c) => c.body.action === action);
const statusHas = (page, text) => page.waitForFunction((t) => document.getElementById('draft-status').textContent.includes(t), text, { timeout: 10000 });
const TECH = /FunctionsHttpError|Edge Function|non-2xx|status code|undefined|Error:|\b(4|5)\d\d\b/;

console.log('Getting to the draft');
await test('the Draft button is there for an admin and not for a plain member', async () => {
  const a = await openMinutes();
  assert.equal(await a.page.locator('#minutes-draft-btn').isVisible(), true);
  assert.equal(await a.page.locator('#minutes-draft-btn').innerText(), 'Draft the minutes');
  await a.ctx.close();
  const m = await openMinutes({ role: 'member' });
  assert.equal(await m.page.locator('#minutes-draft-btn').isVisible(), false);
  await m.ctx.close();
});

await test('it saves what was just typed first, then asks for the draft, with the person’s sign-in', async () => {
  let notesAtCall = null;
  const { page, ctx, seen } = await openMinutes({ draftFn: fn({ draft: (b, s) => { notesAtCall = s.agenda.find((a) => a.id === 'ag1').notes; return { body: drafted() }; } }) });
  await page.locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Quorum was present');
  await page.click('#minutes-draft-btn');
  await ready(page);
  assert.equal(notesAtCall, 'Quorum was present', 'saved before the function was called');
  assert.deepEqual(draftCalls(seen, 'draft')[0].body, { action: 'draft', meeting_id: 'mt-oct' });
  assert.match(draftCalls(seen, 'draft')[0].authorization, /^Bearer /);
  await ctx.close();
});

await test('while the draft is being written it says so, and nothing can be approved yet', async () => {
  const { page, ctx } = await openDraft({ draftDelay: 800 });
  await page.waitForFunction(() => document.getElementById('draft-status').textContent.includes('Writing the draft'));
  assert.equal(await page.locator('#draft-body').isVisible(), false);
  await ready(page);
  assert.equal(await page.locator('#draft-status').isVisible(), false);
  await ctx.close();
});

await test('if the minutes could not be saved, it says so and does not ask for a draft', async () => {
  const { page, ctx, seen } = await openMinutes({ fail: { agenda_items: 'permission' } });
  await page.locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Cannot save this');
  await page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'blocked');
  await page.click('#minutes-draft-btn');
  await page.waitForFunction(() => document.getElementById('draft-status').textContent.includes('not saved yet'));
  assert.match(await page.locator('#draft-status').innerText(), /latest changes in the minutes are not saved yet/);
  assert.equal(seen.draftCalls.length, 0);
  await ctx.close();
});

console.log('Reading the draft');
await test('it shows the heading, who was there, each item with its text in boxes that can be edited, and the closing', async () => {
  const { page, ctx } = await openDraft();
  await ready(page);
  assert.equal(await page.locator('.draft-title').innerText(), 'October Council Meeting');
  const meta = await page.locator('.draft-meta').allInnerTexts();
  assert.match(meta[0], /Parkview Terrace Strata · Wednesday, October 21, 2026 · Amenity room/);
  assert.equal(meta[1], 'Present: Alice Adams, Ben Brooks. Absent: Cara Chen');
  assert.deepEqual(await page.locator('.draft-section h3').evaluateAll((hs) => hs.map((h) => h.textContent)), ['1. Call to order', '2. Budget', '3. Dispute with Lot 12 In camera']);
  assert.equal(await field(page, 'Motion').inputValue(), 'MOVED by Alice Adams, SECONDED by Ben Brooks: that the budget be approved. CARRIED 5-1.');
  assert.equal(await field(page, 'Closing').inputValue(), 'The meeting was adjourned.');
  assert.equal(await field(page, 'What was discussed', 1).inputValue(), 'The council reviewed the budget.');
  await ctx.close();
});

await test('an in-camera item is marked, and says what owners will see instead', async () => {
  const { page, ctx } = await openDraft();
  await ready(page);
  const box = page.locator('.draft-section.is-in-camera');
  assert.equal(await box.count(), 1);
  assert.match(await box.innerText(), /in camera/i);
  assert.match(await box.locator('.camera-note').innerText(), /Owners will see only “Legal matter” and its short summary, not this text\./);
  await ctx.close();
});

await test('what the draft says is shown as text, never run', async () => {
  const evil = '<img src=x onerror="window.__owned=1">';
  const body = drafted(); body.draft.sections[1].narrative = evil; body.snapshot.meeting.title = evil;
  const { page, ctx, seen } = await openDraft({ draftFn: fn({ draft: () => ({ body }) }) });
  await ready(page);
  assert.equal(await page.locator('#view-draft img').count(), 0);
  assert.equal(await page.evaluate(() => window.__owned ?? null), null);
  assert.equal(await field(page, 'What was discussed', 1).inputValue(), evil);
  assert.equal(await page.locator('.draft-title').innerText(), evil);
  assert.deepEqual(seen.pageErrors, []);
  await ctx.close();
});

console.log('What stands in the way of approving');
await test('entries that still need attention are listed, Approve is off and says why, and there is a way back to fix them', async () => {
  const blocking = [{ kind: 'motion', id: 'mo1', message: 'The motion “Approve the budget” (under “Budget”) has not been confirmed.' }];
  const { page, ctx } = await openDraft({ draftFn: fn({ draft: () => ({ body: drafted({ blocking }) }) }) });
  await ready(page);
  assert.match(await page.locator('.draft-gaps-box.is-blocking').innerText(), /Before you can approve[\s\S]*has not been confirmed[\s\S]*Fix these in the minutes, then draft again\./);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), true);
  assert.equal(await page.locator('#draft-why').innerText(), 'To approve: 1 entry in the minutes still needs attention.');
  await btn(page, 'Go to the minutes').click();
  await page.waitForSelector('#view-minutes:visible');
  await ctx.close();
});

await test('notes worth a look are shown without blocking anything', async () => {
  const { page, ctx } = await openDraft();
  await ready(page);
  assert.match(await page.locator('.draft-gaps-box.is-note').innerText(), /Worth a look[\s\S]*Nothing is recorded under “Call to order”\./);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), false);
  assert.equal(await page.locator('#draft-why').innerText(), 'Read it through, change any wording, then approve.');
  await ctx.close();
});

await test('a [MISSING …] note is highlighted and blocks Approve until it is dealt with', async () => {
  const body = drafted(); body.draft.sections[1].motions[0].text = 'MOVED by Alice Adams, SECONDED by [MISSING: who seconded it]. CARRIED 5-1.';
  const { page, ctx } = await openDraft({ draftFn: fn({ draft: () => ({ body }) }) });
  await ready(page);
  const box = field(page, 'Motion');
  assert.equal(await box.evaluate((e) => e.classList.contains('is-gap')), true);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), true);
  assert.equal(await page.locator('#draft-why').innerText(), 'To approve: 1 note marked [MISSING …] is still in the text.');
  await box.fill('MOVED by Alice Adams, SECONDED by Ben Brooks. CARRIED 5-1.');
  assert.equal(await box.evaluate((e) => e.classList.contains('is-gap')), false);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), false);
  await ctx.close();
});

console.log('Approving');
await test('approving sends the draft as edited, shows it approved and locked, and the minutes are locked too', async () => {
  const { page, ctx, seen, s } = await openDraft();
  await ready(page);
  await field(page, 'What was discussed', 1).fill('The council reviewed and discussed the budget.');
  await btn(page, 'Approve the minutes').click();
  await page.waitForSelector('#draft-approved:visible');
  const sent = draftCalls(seen, 'approve');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.draft.sections[1].narrative, 'The council reviewed and discussed the budget.');
  assert.equal(sent[0].body.draft.sections[1].motions[0].id, 'mo1');
  assert.match(await page.locator('#draft-approved-text').innerText(), /These minutes were approved on .* This is the council’s full record, including any in camera items\. Owners see only the owner copy\./);
  assert.equal(await field(page, 'Motion').isDisabled(), true);
  assert.equal(await btn(page, 'Approve the minutes').isVisible(), false);
  assert.equal(s.meetings[0].status, 'approved');
  await page.click('#draft-back');
  await page.waitForSelector('#view-minutes:visible');
  await page.waitForSelector('#minutes-approved:visible');
  assert.equal(await page.locator('#editor').evaluate((e) => e.inert), true);
  assert.equal(await page.locator('#minutes-draft-btn').innerText(), 'See the approved minutes');
  assert.equal(await page.locator('#chat-input').isDisabled(), true);
  assert.match(await page.locator('#chat-input').getAttribute('placeholder'), /approved\. Reopen them/);
  await ctx.close();
});

await test('a double click approves once', async () => {
  const { page, ctx, seen } = await openDraft({ draftDelay: 0 });
  await ready(page);
  await btn(page, 'Approve the minutes').dblclick();
  await page.waitForSelector('#draft-approved:visible');
  assert.equal(draftCalls(seen, 'approve').length, 1);
  await ctx.close();
});

await test('if the function finds entries that still need attention, the list is refreshed and nothing is approved', async () => {
  const blocking = [{ kind: 'action', id: 'ac1', message: 'The action item “Get quotes” still needs who will do it.' }];
  const { page, ctx, s } = await openDraft({ draftFn: fn({ approve: () => ({ status: 409, body: { code: 'NOT_READY', blocking } }) }) });
  await ready(page);
  await btn(page, 'Approve the minutes').click();
  await page.waitForSelector('.draft-gaps-box.is-blocking');
  assert.match(await page.locator('#draft-status').innerText(), /Some entries in the minutes still need attention/);
  assert.match(await page.locator('.draft-gaps-box.is-blocking').innerText(), /still needs who will do it/);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), true);
  assert.equal(s.meetings[0].status, 'in_progress');
  await ctx.close();
});

await test('if the draft no longer matches the minutes, it says in plain words what is wrong and nothing is approved', async () => {
  const problems = [{ code: 'MISSING_ENTRY', message: 'A motion is missing from the draft: “Approve the budget”.' }];
  const { page, ctx } = await openDraft({ draftFn: fn({ approve: () => ({ status: 422, body: { code: 'DRAFT_INVALID', problems } }) }) });
  await ready(page);
  await btn(page, 'Approve the minutes').click();
  await page.waitForSelector('.draft-gaps-box.is-blocking');
  const text = await page.locator('#view-draft').innerText();
  assert.match(text, /This draft no longer matches the minutes[\s\S]*A motion is missing from the draft: “Approve the budget”\.[\s\S]*Draft again to write a fresh one/);
  assert.match(await page.locator('#draft-status').innerText(), /was not approved\. Nothing was changed\./);
  assert.equal(await btn(page, 'Approve the minutes').isDisabled(), true);
  await ctx.close();
});

for (const [name, answer, expected] of [
  ['the service is down', { status: 502, body: { code: 'UNAVAILABLE' } }, /drafting service is not available right now\. Your minutes are safe/],
  ['signed out', { status: 401, body: { code: 'NOT_SIGNED_IN' } }, /signed out/],
  ['not an admin', { status: 403, body: { code: 'NOT_ALLOWED' } }, /Only an organization owner or admin can draft and approve minutes/],
  ['an unexpected error', { status: 500, body: { message: 'boom' } }, /not available right now/],
]) {
  await test(`approving when ${name}: a plain sentence, and the draft stays so it can be tried again`, async () => {
    const { page, ctx, s } = await openDraft({ draftFn: fn({ approve: () => answer }) });
    await ready(page);
    await field(page, 'Closing').fill('Edited closing');
    await btn(page, 'Approve the minutes').click();
    await page.waitForSelector('#draft-status:visible');
    const said = await page.locator('#draft-status').innerText();
    assert.match(said, expected);
    assert.ok(!TECH.test(said), `no technical wording: ${said}`);
    assert.equal(await field(page, 'Closing').inputValue(), 'Edited closing');
    assert.equal(await btn(page, 'Approve the minutes').isDisabled(), false);
    assert.equal(s.meetings[0].status, 'in_progress');
    await ctx.close();
  });
}

console.log('Writing the draft again, and when drafting fails');
await test('a draft the function could not write is explained and can be retried; nothing half-written is shown', async () => {
  let n = 0;
  const { page, ctx } = await openDraft({ draftFn: fn({ draft: () => (n++ === 0 ? { status: 502, body: { code: 'DRAFT_REJECTED' } } : { body: drafted() }) }) });
  await statusHas(page, 'did not show one');
  const said = await page.locator('#draft-status').innerText();
  assert.match(said, /could not write a draft that matched your entries exactly, so I did not show one\. Nothing was changed\./);
  assert.ok(!TECH.test(said));
  assert.equal(await page.locator('#draft-body').isVisible(), false);
  await btn(page, 'Try again').click();
  await ready(page);
  assert.equal(await field(page, 'Closing').inputValue(), 'The meeting was adjourned.');
  await ctx.close();
});

await test('the daily limit is explained and offers no pointless retry', async () => {
  const { page, ctx } = await openDraft({ draftFn: fn({ draft: () => ({ status: 429, body: { code: 'LIMIT' } }) }) });
  await statusHas(page, 'reached today');
  assert.match(await page.locator('#draft-status').innerText(), /reached today’s limit for drafting/);
  assert.equal(await page.getByRole('button', { name: 'Try again' }).count(), 0);
  await ctx.close();
});

await test('no connection: a plain sentence and a Try again that works once it is back', async () => {
  const { page, ctx, s } = await openDraft({ draftFn: 'network' });
  await page.waitForFunction(() => document.getElementById('draft-status').textContent.includes('not available'));
  assert.match(await page.locator('#draft-status').innerText(), /not available right now/);
  s.draftFn = fn();
  await btn(page, 'Try again').click();
  await ready(page);
  await ctx.close();
});

await test('Draft again with no edits writes a new one straight away; with edits it asks first', async () => {
  let n = 0;
  const { page, ctx, seen } = await openDraft({ draftFn: fn({ draft: () => ({ body: (() => { const d = drafted(); d.draft.closing = `Closing ${++n}`; return d; })() }) }) });
  await ready(page);
  await btn(page, 'Draft again').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#draft-doc textarea')].at(-1)?.value === 'Closing 2');
  await field(page, 'Closing').fill('My own closing');
  await btn(page, 'Draft again').click();
  assert.equal(await page.locator('#draft-again').innerText(), 'Yes, replace my edits');
  assert.equal(draftCalls(seen, 'draft').length, 2, 'not yet');
  await btn(page, 'Yes, replace my edits').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#draft-doc textarea')].at(-1)?.value === 'Closing 3');
  assert.equal(draftCalls(seen, 'draft').length, 3);
  await ctx.close();
});

console.log('Keeping edits');
await test('edits survive a reload and are offered back, and carrying on keeps them', async () => {
  const { page, ctx } = await openDraft();
  await ready(page);
  await field(page, 'Closing').fill('Edited and kept');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-draft:') && localStorage.getItem(k).includes('Edited and kept')));
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  await page.click('#minutes-draft-btn');
  await page.waitForSelector('#draft-recover:visible');
  assert.match(await page.locator('#draft-recover').innerText(), /draft you were working on/);
  await btn(page, 'Carry on with it').click();
  assert.equal(await field(page, 'Closing').inputValue(), 'Edited and kept');
  await ctx.close();
});

await test('a kept draft that no longer matches the minutes is not offered for use, only a new one', async () => {
  const { page, ctx, s } = await openDraft();
  await ready(page);
  await field(page, 'Closing').fill('Stale edit');
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('mh-draft:') && localStorage.getItem(k).includes('Stale edit')));
  s.draftFn = fn({ check: () => ({ body: { blocking: [], notes: [], snapshot: snapshot(), problems: [{ code: 'MISSING_ENTRY', message: 'x' }] } }) });
  await page.reload();
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#agenda-list li');
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  await page.click('#minutes-draft-btn');
  await page.waitForSelector('#draft-recover:visible');
  assert.match(await page.locator('#draft-recover').innerText(), /the minutes have changed since, so it no longer matches/);
  assert.equal(await page.getByRole('button', { name: 'Carry on with it' }).count(), 0);
  await btn(page, 'Write a new draft').click();
  await ready(page);
  assert.equal(await field(page, 'Closing').inputValue(), 'The meeting was adjourned.');
  await ctx.close();
});

await test('a draft that arrives after the person has gone back is kept for later, not forced on the screen', async () => {
  const { page, ctx } = await openDraft({ draftDelay: 700 });
  await page.click('#draft-back');
  await page.waitForSelector('#view-minutes:visible');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#view-draft').isVisible(), false);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mh-draft:'))), true);
  await ctx.close();
});

console.log('Approved minutes');
const approvedWorld = (extra = {}) => ({
  meetings: [{ ...OCT, status: 'approved' }],
  versions: [{ meeting_id: 'mt-oct', saved_at: '2026-10-21T21:00:00.000Z', draft: { kind: 'workspace-draft', draft: { sections: sections(), closing: 'Done.' }, snapshot: snapshot() } }],
  ...extra,
});
await test('an approved meeting’s draft screen shows the approved record, read-only, with the way to reopen it', async () => {
  const { page, ctx, seen } = await openDraft(approvedWorld());
  await ready(page);
  assert.equal(await page.locator('#draft-approved').isVisible(), true);
  assert.match(await page.locator('#draft-approved-text').innerText(), /These minutes were approved on /);
  assert.equal(await field(page, 'Closing').inputValue(), 'Done.');
  assert.equal(await field(page, 'Closing').isDisabled(), true);
  assert.equal(await btn(page, 'Approve the minutes').isVisible(), false);
  assert.equal(await page.locator('#draft-gaps').innerText(), '');
  assert.equal(seen.draftCalls.length, 0, 'nothing asked of the function');
  await ctx.close();
});

await test('reopening from the draft screen unlocks the minutes', async () => {
  const { page, ctx, s, seen } = await openDraft(approvedWorld());
  await ready(page);
  await btn(page, 'Reopen to make changes').click();
  await page.waitForSelector('#view-minutes:visible');
  await page.waitForFunction(() => document.getElementById('minutes-approved').classList.contains('hidden'));
  assert.equal(s.meetings[0].status, 'review');
  assert.equal(await page.locator('#editor').evaluate((e) => e.inert), false);
  assert.equal(draftCalls(seen, 'reopen').length, 1);
  assert.equal(await page.locator('#minutes-draft-btn').innerText(), 'Draft the minutes');
  await page.locator('.doc-section-body > p').first().click();
  await page.keyboard.type('Now editable');
  await saved(page);
  await ctx.close();
});

await test('reopening from the locked minutes works the same, and a plain member sees no way to reopen', async () => {
  const a = await openMinutes(approvedWorld());
  await a.page.waitForSelector('#minutes-approved:visible');
  assert.equal(await a.page.locator('#editor').evaluate((e) => e.inert), true);
  await a.page.click('#minutes-reopen');
  await a.page.waitForFunction(() => document.getElementById('minutes-approved').classList.contains('hidden'));
  assert.equal(a.s.meetings[0].status, 'review');
  await a.ctx.close();
  const m = await openMinutes(approvedWorld({ role: 'member' }));
  await m.page.waitForSelector('#minutes-approved:visible');
  assert.equal(await m.page.locator('#minutes-reopen').isVisible(), false);
  assert.equal(await m.page.locator('#minutes-draft-btn').isVisible(), false);
  await m.ctx.close();
});

await test('reopening that fails says so in plain words and leaves the minutes locked', async () => {
  const { page, ctx } = await openMinutes(approvedWorld({ draftFn: fn({ reopen: () => ({ status: 502, body: { code: 'UNAVAILABLE' } }) }) }));
  await page.waitForSelector('#minutes-approved:visible');
  await page.click('#minutes-reopen');
  await page.waitForSelector('#minutes-status:visible');
  assert.match(await page.locator('#minutes-status').innerText(), /not available right now/);
  assert.equal(await page.locator('#editor').evaluate((e) => e.inert), true);
  await ctx.close();
});

console.log('On a phone');
await test('on a phone the draft fits, can be read, edited and approved', async () => {
  const { page, ctx } = await openDraft({}, { viewport: { width: 390, height: 780 } });
  await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
  await field(page, 'Closing').fill('Edited on a phone');
  await btn(page, 'Approve the minutes').click();
  await page.waitForSelector('#draft-approved:visible');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await ctx.close();
});

await finish('DRAFT');
