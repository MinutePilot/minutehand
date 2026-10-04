// Browser tests for the chat assistant (step 6). The chat-entry function is pretended: each test
// says what it would answer, and checks what the page does with that. How well the real model
// reads sentences is checked separately, in tests/chat/live.mjs.
// Run with: cd tests/workspace && npm install && npm run test:chat
import assert from 'node:assert/strict';
import { browser, open, test, finish } from './harness.mjs';

const ROSTER = [
  { id: 'r1', name: 'Alice Adams', role: 'President' },
  { id: 'r2', name: 'Ben Brooks', role: 'Treasurer' },
  { id: 'r3', name: 'Cara Chen', role: 'Director' },
];
const OCT = { id: 'mt-oct', title: 'October Council Meeting', meeting_date: '2026-10-21', start_time: '2026-10-21T19:00:00.000Z', location: 'Amenity room', status: 'in_progress' };
const NOV = { id: 'mt-nov', title: 'November Council Meeting', meeting_date: '2026-11-18', status: 'planned' };
const AGENDA = [
  { meeting_id: 'mt-oct', title: 'Call to order' },
  { meeting_id: 'mt-oct', title: 'Budget' },
  { meeting_id: 'mt-oct', title: 'Adjournment' },
  { meeting_id: 'mt-nov', title: 'Call to order' },
];

const section = (page, n) => page.locator('.doc-section').nth(n);
const motions = (page, n) => section(page, n).locator('.blk-motion');
const actions = (page, n) => section(page, n).locator('.blk-action');
const noteParas = (page, n) => section(page, n).locator('.doc-section-body > p');
const saved = (page) => page.waitForFunction(() => document.getElementById('minutes-saved').dataset.state === 'saved'
  && document.getElementById('minutes-saved').textContent.includes('Saved'), null, { timeout: 15000 });
const label = (block, caption) => block.locator('.blk-field', { hasText: caption }).locator('select, input');
const bubbles = (page) => page.locator('#chat-log .bubble').allInnerTexts();
const lastBubble = async (page) => (await bubbles(page)).at(-1);
const isUnconfirmed = (block) => block.evaluate((e) => e.classList.contains('is-unconfirmed'));

async function openMinutes(scenario = {}, opts) {
  const t = await open(browser, { meetings: [OCT, NOV], agenda: AGENDA, roster: ROSTER, ...scenario }, opts);
  await t.page.waitForSelector('#meetings-list li');
  await t.page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await t.page.waitForSelector('#agenda-list li');
  await t.page.click('#meeting-run');
  await t.page.waitForSelector('#view-minutes:visible');
  await t.page.waitForSelector('.doc-section');
  return t;
}
async function say(page, text) {
  await page.fill('#chat-input', text);
  await page.click('#chat-send');
}
const settle = (page) => page.waitForFunction(() => !document.querySelector('#chat-log .wait') && !document.getElementById('chat-send').disabled, null, { timeout: 10000 });

const MOTION = { kind: 'motion', text: 'Approve the 2027 budget', mover: 'r1', seconder: 'r2', result: 'carried', votes: '5 for, 1 against' };

console.log('Before and after the minutes are open');
await test('the chat is switched off until a meeting’s minutes are open, and says why', async () => {
  const { page, ctx } = await open(browser, { meetings: [OCT], agenda: AGENDA, roster: ROSTER });
  await page.waitForSelector('#meetings-list li');
  assert.equal(await page.locator('#chat-input').isDisabled(), true);
  assert.equal(await page.locator('#chat-send').isDisabled(), true);
  assert.match(await page.locator('#chat-input').getAttribute('placeholder'), /Open the minutes/);
  assert.match((await bubbles(page))[0], /Open a meeting/);
  assert.ok(!(await page.locator('#chat-log').innerText()).includes('still being built'));
  await ctx.close();
});

await test('with the minutes open it is on, lists the agenda items, and follows the cursor', async () => {
  const { page, ctx } = await openMinutes();
  assert.equal(await page.locator('#chat-input').isDisabled(), false);
  assert.deepEqual(await page.locator('#chat-target option').allInnerTexts(), ['1. Call to order', '2. Budget', '3. Adjournment']);
  assert.equal(await page.locator('#chat-target').inputValue(), 'ag1');
  await noteParas(page, 2).first().click();
  await page.waitForFunction(() => document.getElementById('chat-target').value === 'ag3');
  await noteParas(page, 1).first().click();
  await page.waitForFunction(() => document.getElementById('chat-target').value === 'ag2');
  assert.match((await bubbles(page))[0], /Tell me what happens/);
  await ctx.close();
});

await test('a meeting with no agenda items says to add one first', async () => {
  const { page, ctx } = await open(browser, { meetings: [OCT], agenda: [], roster: ROSTER });
  await page.waitForSelector('#meetings-list li');
  await page.getByRole('button', { name: 'Open October Council Meeting' }).click();
  await page.waitForSelector('#meeting-run');
  await page.click('#meeting-run');
  await page.waitForSelector('#view-minutes:visible');
  await page.waitForSelector('.minutes-header, #editor .ProseMirror');
  await page.waitForFunction(() => document.getElementById('chat-input').placeholder.includes('agenda item'));
  assert.equal(await page.locator('#chat-input').isDisabled(), true);
  assert.match(await page.locator('#chat-input').getAttribute('placeholder'), /agenda item/);
  await ctx.close();
});

await test('going back to the meeting switches the chat off again, and coming back keeps the conversation', async () => {
  const { page, ctx } = await openMinutes({ chat: () => ({ body: { entries: [{ kind: 'note', text: 'Quorum confirmed' }], unmatched: [] } }) });
  await say(page, 'quorum is here');
  await settle(page);
  await page.click('#minutes-back');
  await page.waitForSelector('#view-meeting:visible');
  assert.equal(await page.locator('#chat-input').isDisabled(), true);
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  assert.equal(await page.locator('#chat-input').isDisabled(), false);
  const log = (await bubbles(page)).join('\n');
  assert.ok(log.includes('quorum is here') && log.includes('Added to'), 'the conversation is still there');
  await ctx.close();
});

console.log('Turning a message into entries');
await test('a complete motion lands in the chosen item, filled in and still unconfirmed', async () => {
  const { page, ctx, seen } = await openMinutes({ chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await noteParas(page, 1).first().click();
  await page.waitForFunction(() => document.getElementById('chat-target').value === 'ag2');
  await say(page, 'Alice moved to approve the 2027 budget, Ben seconded, carried 5-1');
  await settle(page);
  assert.equal(seen.chatCalls.length, 1);
  assert.deepEqual(seen.chatCalls[0].body, { meeting_id: 'mt-oct', agenda_item_id: 'ag2', message: 'Alice moved to approve the 2027 budget, Ben seconded, carried 5-1' });
  assert.match(seen.chatCalls[0].authorization, /^Bearer /);
  assert.equal(await motions(page, 1).count(), 1);
  assert.equal(await motions(page, 0).count() + await motions(page, 2).count(), 0);
  const block = motions(page, 1).first();
  assert.equal(await isUnconfirmed(block), true);
  assert.equal(await block.locator('.blk-text').innerText(), 'Approve the 2027 budget');
  assert.equal(await label(block, 'Moved by').evaluate((e) => e.selectedOptions[0].textContent.startsWith('Alice Adams')), true);
  assert.equal(await label(block, 'Seconded by').inputValue(), 'r2');
  assert.equal(await label(block, 'Result').inputValue(), 'carried');
  assert.equal(await label(block, 'Votes').inputValue(), '5 for, 1 against');
  assert.equal(await block.locator('.blk-confirm').isDisabled(), false, 'complete, so it can be confirmed, but only by the secretary');
  assert.equal(await page.inputValue('#chat-input'), '', 'the box is cleared');
  assert.match(await lastBubble(page), /Added to “Budget”: 1 motion\. Check each one/);
  await ctx.close();
});

await test('it saves as a normal motion row, unconfirmed, through the usual autosave', async () => {
  const { page, ctx, s } = await openMinutes({ chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await noteParas(page, 1).first().click();
  await page.waitForFunction(() => document.getElementById('chat-target').value === 'ag2');
  await say(page, 'budget motion');
  await settle(page);
  await saved(page);
  assert.equal(s.motions.length, 1);
  const r = s.motions[0];
  assert.deepEqual({ d: r.description, m: r.mover_roster_id, sc: r.seconder_roster_id, res: r.result, v: r.vote_tally, c: r.confirmed, a: r.agenda_item_id },
                   { d: 'Approve the 2027 budget', m: 'r1', sc: 'r2', res: 'carried', v: '5 for, 1 against', c: false, a: 'ag2' });
  await ctx.close();
});

await test('an action item gets its owner and due date; a note goes into the notes above the blocks', async () => {
  const entries = [
    { kind: 'note', text: 'Owners asked about parking' },
    { kind: 'action', text: 'Get three roof quotes', owner: 'r2', due: '2026-10-23' },
    { kind: 'note', text: 'Second note' },
  ];
  const { page, ctx, s } = await openMinutes({ chat: () => ({ body: { entries, unmatched: [] } }) });
  await say(page, 'parking talk, Ben to get roof quotes by Friday');
  await settle(page);
  assert.deepEqual(await noteParas(page, 0).allInnerTexts(), ['Owners asked about parking', 'Second note']);
  const block = actions(page, 0).first();
  assert.equal(await isUnconfirmed(block), true);
  assert.equal(await label(block, 'Who').inputValue(), 'r2');
  assert.equal(await label(block, 'Due').inputValue(), '2026-10-23');
  assert.match(await lastBubble(page), /1 action item, 2 notes/);
  await saved(page);
  assert.equal(s.agenda.find((a) => a.id === 'ag1').notes, 'Owners asked about parking\nSecond note');
  assert.equal(s.actions[0].owner_roster_id, 'r2');
  assert.equal(s.actions[0].due_date_parsed, '2026-10-23');
  assert.equal(s.actions[0].confirmed, false);
  await ctx.close();
});

await test('a note is added after notes already typed, and into an empty first line when there are none', async () => {
  const { page, ctx } = await openMinutes({ agenda: [{ meeting_id: 'mt-oct', title: 'Call to order', notes: 'Meeting opened at 7:00' }, { meeting_id: 'mt-oct', title: 'Budget' }],
    chat: (b) => ({ body: { entries: [{ kind: 'note', text: `n:${b.agenda_item_id}` }], unmatched: [] } }) });
  await say(page, 'one');
  await settle(page);
  assert.deepEqual(await noteParas(page, 0).allInnerTexts(), ['Meeting opened at 7:00', 'n:ag1']);
  await page.selectOption('#chat-target', 'ag2');
  await say(page, 'two');
  await settle(page);
  assert.deepEqual((await noteParas(page, 1).allInnerTexts()).map((t) => t.trim()), ['n:ag2']);
  await ctx.close();
});

await test('several entries keep their order and the notes stay above the blocks', async () => {
  const entries = [
    { kind: 'motion', text: 'First motion' }, { kind: 'action', text: 'First action' },
    { kind: 'note', text: 'A note' }, { kind: 'motion', text: 'Second motion' },
  ];
  const { page, ctx, s } = await openMinutes({ chat: () => ({ body: { entries, unmatched: [] } }) });
  await say(page, 'lots');
  await settle(page);
  assert.deepEqual(await motions(page, 0).locator('.blk-text').allInnerTexts(), ['First motion', 'Second motion']);
  assert.equal(await actions(page, 0).count(), 1);
  assert.deepEqual(await noteParas(page, 0).allInnerTexts(), ['A note']);
  await saved(page);
  assert.deepEqual(s.motions.map((m) => m.description).sort(), ['First motion', 'Second motion']);
  await ctx.close();
});

await test('names it could not match are said out loud and the field is left blank', async () => {
  const entries = [{ kind: 'motion', text: 'Hire a gardener', mover: null, seconder: 'r2', result: null, votes: null }];
  const { page, ctx } = await openMinutes({ chat: () => ({ body: { entries, unmatched: ['Pat'] } }) });
  await say(page, 'Pat moved to hire a gardener, Ben seconded');
  await settle(page);
  const log = await bubbles(page);
  assert.match(log.at(-1), /could not find “Pat” on the roster, so I left that blank/);
  const block = motions(page, 0).first();
  assert.equal(await label(block, 'Moved by').inputValue(), '');
  assert.equal(await label(block, 'Seconded by').inputValue(), 'r2');
  assert.equal(await label(block, 'Result').inputValue(), '');
  assert.equal(await block.locator('.blk-confirm').isDisabled(), true);
  await ctx.close();
});

await test('a message with nothing for the minutes adds nothing and says so', async () => {
  const { page, ctx, s } = await openMinutes({ chat: () => ({ body: { entries: [], unmatched: [] } }) });
  await say(page, 'we all had coffee');
  await settle(page);
  assert.match(await lastBubble(page), /did not find anything to add/);
  assert.equal(await page.locator('.blk').count(), 0);
  await page.waitForTimeout(1200);
  assert.equal(s.motions.length + s.actions.length, 0);
  await ctx.close();
});

await test('whatever the function sends, nothing arrives confirmed', async () => {
  const entries = [{ ...MOTION, confirmed: true }, { kind: 'action', text: 'Do it', owner: 'r1', confirmed: true }];
  const { page, ctx } = await openMinutes({ chat: () => ({ body: { entries, unmatched: [] } }) });
  await say(page, 'x');
  await settle(page);
  assert.equal(await page.locator('.blk.is-confirmed').count(), 0);
  assert.equal(await page.locator('.blk.is-unconfirmed').count(), 2);
  await ctx.close();
});

await test('what was added can be removed like anything else, and Undo does not take it away by accident', async () => {
  const { page, ctx } = await openMinutes({ chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await say(page, 'x');
  await settle(page);
  await page.locator('.doc-section-body > p').first().click();
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.blk-motion').count(), 1);
  await page.locator('.blk-motion').first().getByRole('button', { name: /Remove/ }).click();
  await page.locator('.blk-motion').first().getByRole('button', { name: /Yes, remove/ }).click();
  assert.equal(await page.locator('.blk-motion').count(), 0);
  await ctx.close();
});

console.log('When it goes wrong');
for (const [name, answer, expected] of [
  ['signed out', { status: 401, body: { code: 'NOT_SIGNED_IN' } }, /signed out/],
  ['over the daily cap', { status: 429, body: { code: 'LIMIT' } }, /limit for the assistant.*type straight into the minutes/],
  ['not switched on', { status: 403, body: { code: 'NO_ACCESS' } }, /not switched on/],
  ['the model is down', { status: 502, body: { code: 'UNAVAILABLE' } }, /not available right now.*type straight into them/],
  ['an error with no code', { status: 500, body: { message: 'boom' } }, /not available right now/],
  ['a message that is too long', { status: 400, body: { code: 'TOO_LONG' } }, /too long.*shorter pieces/],
]) {
  await test(`${name}: a plain sentence, the words stay in the box, nothing is added`, async () => {
    const { page, ctx } = await openMinutes({ chat: () => answer });
    await say(page, 'Alice moved to buy chairs');
    await settle(page);
    const said = await lastBubble(page);
    assert.match(said, expected);
    assert.ok(!/FunctionsHttpError|Edge Function|status code|non-2xx|undefined|Error:|\b(4|5)\d\d\b/.test(said), `no technical wording: ${said}`);
    assert.equal(await page.inputValue('#chat-input'), 'Alice moved to buy chairs');
    assert.equal(await page.locator('.blk').count(), 0);
    assert.equal(await page.locator('#chat-send').isDisabled(), false, 'can try again');
    await ctx.close();
  });
}

await test('no connection: a plain sentence, and it works again once the connection is back', async () => {
  const { page, ctx, s } = await openMinutes({ chat: 'network' });
  await say(page, 'Alice moved to buy chairs');
  await settle(page);
  assert.match(await lastBubble(page), /not available right now/);
  assert.equal(await page.inputValue('#chat-input'), 'Alice moved to buy chairs');
  s.chat = () => ({ body: { entries: [{ kind: 'motion', text: 'Buy chairs' }], unmatched: [] } });
  await page.click('#chat-send');
  await settle(page);
  assert.equal(await motions(page, 0).count(), 1);
  await ctx.close();
});

await test('pressing Send twice, or Enter twice, asks once and adds once', async () => {
  const { page, ctx, seen } = await openMinutes({ chatDelay: 600, chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await page.fill('#chat-input', 'x');
  await page.click('#chat-send');
  assert.equal(await page.locator('#chat-send').isDisabled(), true, 'locked while waiting');
  assert.equal(await page.locator('#chat-log .wait').count(), 1);
  await page.locator('#chat-send').click({ force: true, timeout: 500 }).catch(() => {});
  await page.keyboard.press('Enter');
  await settle(page);
  assert.equal(seen.chatCalls.length, 1);
  assert.equal(await page.locator('.blk-motion').count(), 1);
  await ctx.close();
});

await test('leaving the meeting before the answer arrives adds nothing to anything', async () => {
  const { page, ctx, s } = await openMinutes({ chatDelay: 700, chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await say(page, 'x');
  await page.click('#minutes-back');
  await page.waitForSelector('#view-meeting:visible');
  await page.waitForTimeout(1200);
  await page.click('#meeting-run');
  await page.waitForSelector('.doc-section');
  assert.equal(await page.locator('.blk').count(), 0);
  assert.match((await bubbles(page)).join('\n'), /came in after you left this meeting, so nothing was added/);
  assert.equal(s.motions.length, 0);
  await ctx.close();
});

await test('text with HTML in it is shown as text, in the chat and in the minutes', async () => {
  const evil = '<img src=x onerror="window.__owned=1">';
  const { page, ctx, seen } = await openMinutes({ chat: () => ({ body: { entries: [{ kind: 'motion', text: evil }, { kind: 'note', text: evil }], unmatched: ['<b>Pat</b>'] } }) });
  await say(page, evil);
  await settle(page);
  assert.equal(await page.locator('#chat-log img, .doc-section img').count(), 0);
  assert.equal(await page.evaluate(() => window.__owned ?? null), null);
  assert.ok((await bubbles(page)).join('\n').includes(evil));
  assert.equal(await motions(page, 0).locator('.blk-text').innerText(), evil);
  assert.deepEqual(seen.pageErrors, []);
  await ctx.close();
});

await test('a plain member can use it too', async () => {
  const { page, ctx } = await openMinutes({ role: 'member', chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) });
  await say(page, 'x');
  await settle(page);
  assert.equal(await page.locator('.blk-motion').count(), 1);
  await ctx.close();
});

console.log('On a phone');
await test('on a phone the chat is a tab, and what it adds is waiting in the Minutes tab', async () => {
  const { page, ctx } = await openMinutes({ chat: () => ({ body: { entries: [MOTION], unmatched: [] } }) }, { viewport: { width: 390, height: 780 } });
  await page.getByRole('tab', { name: 'Chat' }).click();
  assert.equal(await page.locator('#chat-input').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
  await say(page, 'Alice moved to approve the 2027 budget');
  await settle(page);
  await page.getByRole('tab', { name: /Minutes|October/ }).click();
  assert.equal(await page.locator('.blk-motion').count(), 1);
  await ctx.close();
});

await finish('CHAT');
